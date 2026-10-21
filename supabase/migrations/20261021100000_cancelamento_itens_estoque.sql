-- Fase 2, etapa 2 (spec-fase2.md, seções 3 e 5): cancelamento item por item e
-- controle de estoque por item do cardápio.
--
-- * order_items ganha cancelled_at/cancelled_by/cancel_reason; o total do pedido
--   passa a ser a soma dos itens não cancelados (recalculado por trigger) e o
--   pedido vira "cancelado" quando o último item é cancelado.
-- * menu_items ganha estoque opcional (stock_enabled, stock_quantity,
--   low_stock_threshold). Cada item pedido baixa o saldo na transação do pedido;
--   cancelar devolve. Saldo zero marca "esgotado" automaticamente
--   (sold_out_auto) e a reposição desmarca.
-- * stock_movements registra entradas, vendas, cancelamentos e ajustes.

-- ---------------------------------------------------------------------------
-- Colunas
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column cancelled_at timestamptz,
  add column cancelled_by uuid,
  add column cancel_reason text check (char_length(cancel_reason) <= 200);
create index order_items_cancelled_idx on public.order_items (order_id) where cancelled_at is null;

alter table public.orders
  add column cancelled_by uuid,
  add column cancel_reason text check (char_length(cancel_reason) <= 200);

alter table public.menu_items
  add column stock_enabled boolean not null default false,
  add column stock_quantity integer check (stock_quantity >= 0),
  add column low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  -- "esgotado" marcado pelo estoque chegar a zero; a reposição desmarca.
  add column sold_out_auto boolean not null default false,
  add constraint menu_items_stock_quantity_when_enabled check (not stock_enabled or stock_quantity is not null);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  kind text not null check (kind in ('entrada', 'venda', 'cancelamento', 'ajuste')),
  -- Variação do saldo (negativa na venda).
  quantity integer not null,
  balance_after integer not null check (balance_after >= 0),
  order_item_id uuid references public.order_items (id) on delete set null,
  created_by uuid,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index stock_movements_item_idx on public.stock_movements (menu_item_id, created_at desc);
create index stock_movements_restaurant_idx on public.stock_movements (restaurant_id, created_at desc);
alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to authenticated;
grant select, insert on public.stock_movements to service_role;
create policy "stock_movements: equipe lê" on public.stock_movements
  for select to authenticated using (private.can_read(restaurant_id));

-- ---------------------------------------------------------------------------
-- Estoque: funções internas
-- ---------------------------------------------------------------------------

-- Aplica uma variação de saldo e registra o movimento. Chamada por RPCs e
-- triggers (security definer). Não confere permissão: quem chama confere.
create function private.move_stock(p_item uuid, p_kind text, p_delta integer, p_order_item uuid, p_note text, p_actor uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare item public.menu_items; balance integer;
begin
  select * into item from public.menu_items where id = p_item for update;
  if item.id is null or not item.stock_enabled then return null; end if;
  balance := item.stock_quantity + p_delta;
  if balance < 0 then
    raise exception 'Restam % unidades de %', item.stock_quantity, item.name using errcode = 'P0001';
  end if;
  -- O garçom que cancela um item não pode editar o cardápio; o motor de
  -- estoque sinaliza ao guard que esta escrita é dele.
  perform set_config('app.stock', '1', true);
  update public.menu_items set
    stock_quantity = balance,
    sold_out = case when balance = 0 then true when sold_out_auto then false else sold_out end,
    sold_out_auto = case when balance = 0 then true else false end
    where id = p_item;
  perform set_config('app.stock', '', true);
  insert into public.stock_movements (restaurant_id, menu_item_id, kind, quantity, balance_after, order_item_id, created_by, note)
    values (item.restaurant_id, p_item, p_kind, p_delta, balance, p_order_item, p_actor, p_note);
  return balance;
end;
$$;
revoke all on function private.move_stock(uuid, text, integer, uuid, text, uuid) from public;
grant execute on function private.move_stock(uuid, text, integer, uuid, text, uuid) to authenticated, service_role;

-- Movimento registrado pelo editor do item (que roda como o usuário e não
-- escreve direto em stock_movements).
create function private.log_stock(p_item uuid, p_kind text, p_delta integer, p_balance integer, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.stock_movements (restaurant_id, menu_item_id, kind, quantity, balance_after, created_by, note)
    select restaurant_id, id, p_kind, p_delta, p_balance, (select auth.uid()), p_note from public.menu_items where id = p_item;
end;
$$;
revoke all on function private.log_stock(uuid, text, integer, integer, text) from public;
grant execute on function private.log_stock(uuid, text, integer, integer, text) to authenticated, service_role;

-- Gestor (ou quem tem manage_stock) repõe ou ajusta o saldo.
create function public.adjust_stock(p_item uuid, p_kind text, p_quantity integer, p_note text default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare item public.menu_items; delta integer;
begin
  select * into item from public.menu_items where id = p_item;
  if item.id is null then raise exception 'Item indisponível'; end if;
  if not private.has_permission(item.restaurant_id, 'manage_stock') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not item.stock_enabled then raise exception 'Este item não controla estoque'; end if;
  if p_kind = 'entrada' then
    if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then raise exception 'Informe a quantidade recebida'; end if;
    delta := p_quantity;
  elsif p_kind = 'ajuste' then
    if p_quantity is null or p_quantity < 0 or p_quantity > 100000 then raise exception 'Informe o saldo correto'; end if;
    delta := p_quantity - item.stock_quantity;
  else
    raise exception 'Movimento inválido';
  end if;
  perform private.audit(item.restaurant_id, case when p_kind = 'entrada' then 'estoque_reposto' else 'estoque_ajustado' end,
    'menu_item', item.id, null, jsonb_build_object('name', item.name, 'quantity', p_quantity, 'note', p_note));
  return private.move_stock(p_item, p_kind, delta, null, p_note, (select auth.uid()));
end;
$$;
revoke all on function public.adjust_stock(uuid, text, integer, text) from public, anon;
grant execute on function public.adjust_stock(uuid, text, integer, text) to authenticated;

-- Cozinha e bar continuam marcando esgotado à mão; isso desliga o automático.
create or replace function private.guard_menu_item_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and coalesce(current_setting('app.stock', true), '') <> '1'
     and not private.can_edit_menu(old.restaurant_id)
     and (to_jsonb(new) - array['sold_out', 'sold_out_auto']) is distinct from (to_jsonb(old) - array['sold_out', 'sold_out_auto']) then
    raise exception 'A cozinha e o bar só podem marcar itens como esgotados' using errcode = '42501';
  end if;
  if new.sold_out is distinct from old.sold_out and new.sold_out_auto = old.sold_out_auto then
    new.sold_out_auto := false;
  end if;
  if new.stock_enabled and new.stock_quantity is null then new.stock_quantity := 0; end if;
  return new;
end;
$$;

-- O editor do item liga o estoque e define saldo inicial e limite de alerta.
create or replace function public.save_menu_item(p_restaurant uuid,p_item uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare iid uuid; gid uuid; grp jsonb; modifier jsonb; previous public.menu_items; enable boolean; qty integer; threshold integer;
begin
  if not private.can_edit_menu(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.categories where id=(p_data->>'category_id')::uuid and restaurant_id=p_restaurant) then raise exception 'Categoria inválida'; end if;
  enable := coalesce((p_data->>'stock_enabled')::boolean, false);
  qty := nullif(p_data->>'stock_quantity','')::integer;
  threshold := coalesce(nullif(p_data->>'low_stock_threshold','')::integer, 5);
  if enable and (qty is null or qty < 0) then raise exception 'Informe a quantidade em estoque'; end if;
  if p_item is null then
    insert into public.menu_items(restaurant_id,category_id,name,description,price_cents,photo_url,prep_minutes,active,featured,position,stock_enabled,stock_quantity,low_stock_threshold,sold_out,sold_out_auto)
    values(p_restaurant,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',(p_data->>'price_cents')::integer,p_data->>'photo_url',(p_data->>'prep_minutes')::integer,(p_data->>'active')::boolean,(p_data->>'featured')::boolean,coalesce((p_data->>'position')::integer,0),enable,case when enable then qty else null end,threshold,enable and qty = 0,enable and qty = 0) returning id into iid;
    if enable then
      perform private.log_stock(iid,'ajuste',qty,qty,'Estoque inicial');
    end if;
  else
    select * into previous from public.menu_items where id=p_item and restaurant_id=p_restaurant for update;
    if previous.id is null then raise exception 'Item indisponível'; end if;
    update public.menu_items set category_id=(p_data->>'category_id')::uuid,name=p_data->>'name',description=p_data->>'description',price_cents=(p_data->>'price_cents')::integer,photo_url=p_data->>'photo_url',prep_minutes=(p_data->>'prep_minutes')::integer,active=(p_data->>'active')::boolean,featured=(p_data->>'featured')::boolean,
      stock_enabled=enable,low_stock_threshold=threshold,
      stock_quantity=case when enable then qty else null end,
      sold_out=case when enable and qty = 0 then true when enable and previous.sold_out_auto then false when not enable and previous.sold_out_auto then false else sold_out end,
      sold_out_auto=enable and qty = 0
      where id=p_item returning id into iid;
    if enable and (not previous.stock_enabled or previous.stock_quantity is distinct from qty) then
      perform private.log_stock(iid,'ajuste',qty-coalesce(case when previous.stock_enabled then previous.stock_quantity end,0),qty,case when previous.stock_enabled then 'Ajuste pelo editor do item' else 'Estoque inicial' end);
    end if;
    delete from public.modifier_groups where menu_item_id=iid;
  end if;
  for grp in select value from jsonb_array_elements(p_data->'groups') loop
    insert into public.modifier_groups(menu_item_id,name,required,min_select,max_select,position)
    values(iid,grp->>'name',(grp->>'required')::boolean,(grp->>'min_select')::integer,(grp->>'max_select')::integer,(grp->>'position')::integer) returning id into gid;
    for modifier in select value from jsonb_array_elements(grp->'modifiers') loop
      insert into public.modifiers(group_id,name,price_cents,position) values(gid,modifier->>'name',(modifier->>'price_cents')::integer,(modifier->>'position')::integer);
    end loop;
  end loop;
  return iid;
end $$;

-- ---------------------------------------------------------------------------
-- Cancelamento por item
-- ---------------------------------------------------------------------------

-- Total do pedido = soma dos itens não cancelados. Pedido sem item ativo vira
-- cancelado. Item cancelado devolve o estoque.
create function private.after_order_item_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare remaining integer; total integer; o public.orders;
begin
  select * into o from public.orders where id = new.order_id for update;
  if new.menu_item_id is not null and o.status <> 'cancelado' then
    perform private.move_stock(new.menu_item_id, 'cancelamento', new.quantity, new.id, null, new.cancelled_by);
  end if;
  select count(*), coalesce(sum(unit_price_cents * quantity), 0) into remaining, total
    from public.order_items where order_id = new.order_id and cancelled_at is null;
  if remaining = 0 and o.status <> 'cancelado' then
    update public.orders set status = 'cancelado', total_cents = 0, cancel_reason = coalesce(cancel_reason, new.cancel_reason), cancelled_by = coalesce(cancelled_by, new.cancelled_by)
      where id = new.order_id;
  elsif o.total_cents <> total then
    update public.orders set total_cents = total where id = new.order_id;
  end if;
  return null;
end;
$$;
create trigger order_items_after_cancel after update of cancelled_at on public.order_items
for each row when (new.cancelled_at is not null and old.cancelled_at is null)
execute function private.after_order_item_cancel();

-- Pedido cancelado inteiro: os itens ainda ativos ficam cancelados também e o
-- estoque volta.
create function private.after_order_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare line public.order_items;
begin
  for line in select * from public.order_items where order_id = new.id and cancelled_at is null loop
    update public.order_items set cancelled_at = new.cancelled_at, cancelled_by = new.cancelled_by, cancel_reason = new.cancel_reason where id = line.id;
    if line.menu_item_id is not null then
      perform private.move_stock(line.menu_item_id, 'cancelamento', line.quantity, line.id, null, new.cancelled_by);
    end if;
  end loop;
  return null;
end;
$$;
create trigger orders_after_cancel after update of status on public.orders
for each row when (new.status = 'cancelado' and old.status <> 'cancelado')
execute function private.after_order_cancel();

-- O total só muda para a soma dos itens ativos; quem cancela fica registrado.
create or replace function private.guard_order_update()
returns trigger
language plpgsql set search_path = ''
as $$
declare expected integer;
begin
  if (to_jsonb(new) - array['status', 'pinned', 'started_at', 'ready_at', 'delivered_at', 'cancelled_at', 'total_cents', 'cancelled_by', 'cancel_reason'])
     is distinct from
     (to_jsonb(old) - array['status', 'pinned', 'started_at', 'ready_at', 'delivered_at', 'cancelled_at', 'total_cents', 'cancelled_by', 'cancel_reason']) then
    raise exception 'Só o status e a fixação do pedido podem ser alterados' using errcode = '42501';
  end if;
  if new.total_cents <> old.total_cents then
    select coalesce(sum(unit_price_cents * quantity), 0) into expected from public.order_items where order_id = new.id and cancelled_at is null;
    if new.total_cents <> expected and not (new.status = 'cancelado' and new.total_cents = 0) then
      raise exception 'O total do pedido é calculado pelos itens' using errcode = '42501';
    end if;
  end if;
  if (new.cancelled_by is distinct from old.cancelled_by or new.cancel_reason is distinct from old.cancel_reason) and new.status <> 'cancelado' then
    raise exception 'Motivo de cancelamento só em pedido cancelado' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'recebido' and new.status in ('em_preparo', 'cancelado'))
      or (old.status = 'em_preparo' and new.status in ('pronto', 'cancelado'))
      or (old.status = 'pronto' and new.status in ('entregue', 'cancelado'))
    ) then
      raise exception 'Transição de status inválida: % → %', old.status, new.status
        using errcode = '23514';
    end if;

    case new.status
      when 'em_preparo' then new.started_at := now();
      when 'pronto' then new.ready_at := now();
      when 'entregue' then new.delivered_at := now();
      when 'cancelado' then
        new.cancelled_at := now();
        new.cancelled_by := coalesce(new.cancelled_by, (select auth.uid()));
        new.total_cents := 0;
      else null;
    end case;
  end if;

  return new;
end;
$$;

-- Garçom ou gestor cancela um item (recebido, em preparo ou pronto), com motivo.
create function public.cancel_order_item(p_item uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare line public.order_items; o public.orders;
begin
  select * into line from public.order_items where id = p_item for update;
  if line.id is null then raise exception 'Item indisponível'; end if;
  select * into o from public.orders where id = line.order_id for update;
  if not private.has_permission(o.restaurant_id, 'cancel_items') then raise exception 'Você não tem permissão para cancelar itens' using errcode = '42501'; end if;
  if o.status not in ('recebido', 'em_preparo', 'pronto') then raise exception 'Este pedido não pode mais ser alterado'; end if;
  if line.cancelled_at is not null then return jsonb_build_object('ok', true); end if;
  if char_length(coalesce(p_reason, '')) > 200 then raise exception 'Motivo muito longo'; end if;
  perform private.audit(o.restaurant_id, 'item_cancelado', 'order_item', line.id, o.tab_id,
    jsonb_build_object('order_id', o.id, 'name', line.name_snapshot, 'quantity', line.quantity, 'reason', p_reason, 'status', o.status));
  update public.order_items set cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = nullif(btrim(p_reason), '') where id = p_item;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.cancel_order_item(uuid, text) from public, anon;
grant execute on function public.cancel_order_item(uuid, text) to authenticated;

-- Cliente cancela um item do próprio pedido enquanto ele está "recebido".
create function public.cancel_table_order_item(p_slug text, p_qr text, p_hash text, p_item uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; gid uuid; tab public.tabs; line public.order_items; o public.orders;
begin
  perform set_config('app.actor', 'customer', true);
  select s.tab_id,s.guest_id into bid,gid from public.tab_sessions s join public.tabs b on b.id=s.tab_id join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
  where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if bid is null then raise exception 'Sessão inválida' using errcode='28000'; end if;
  select * into tab from public.tabs where id=bid for update;
  if tab.status<>'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  select * into line from public.order_items where id=p_item for update;
  if line.id is null then return false; end if;
  select * into o from public.orders where id=line.order_id for update;
  if o.tab_id <> bid or o.status <> 'recebido' or o.guest_id is distinct from gid or line.cancelled_at is not null then return false; end if;
  perform private.audit(o.restaurant_id, 'item_cancelado', 'order_item', line.id, o.tab_id,
    jsonb_build_object('order_id', o.id, 'name', line.name_snapshot, 'quantity', line.quantity, 'status', o.status));
  update public.order_items set cancelled_at=now() where id=p_item;
  return true;
end $$;
revoke all on function public.cancel_table_order_item(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_table_order_item(text,text,text,uuid) to service_role;

-- O pedido inteiro cancelado pelo cliente também registra o motivo padrão.
create or replace function public.cancel_table_order(p_slug text,p_qr text,p_hash text,p_order uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; gid uuid; tab public.tabs;
begin
  perform set_config('app.actor', 'customer', true);
  select s.tab_id,s.guest_id into bid,gid from public.tab_sessions s join public.tabs b on b.id=s.tab_id join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
  where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if bid is null then raise exception 'Sessão inválida' using errcode='28000'; end if;
  select * into tab from public.tabs where id=bid for update;
  if tab.status<>'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  update public.orders set status='cancelado', cancel_reason='Cancelado pelo cliente' where id=p_order and tab_id=bid and status='recebido' and guest_id is not distinct from gid;
  return found;
end $$;

-- Pedido: baixa o estoque na mesma transação e recusa quantidade acima do saldo.
create or replace function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; session_guest uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; total integer:=0; prep integer:=1; lines jsonb:='[]'; line_id uuid;
begin
  perform set_config('app.actor', 'customer', true);
  select t.restaurant_id,s.tab_id,s.guest_id into rid,session_tab,session_guest from public.tab_sessions s join public.tabs b on b.id=s.tab_id
    join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
    where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if session_tab is null then raise exception 'Sessão inválida. Digite o código da mesa' using errcode='28000'; end if;
  select * into tab from public.tabs where id=session_tab for update;
  if tab.status <> 'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  select id into oid from public.orders where request_id=p_request and tab_id=tab.id;
  if oid is not null then return jsonb_build_object('id',oid); end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Pedido inválido'; end if;
  for line in select value from jsonb_array_elements(p_items) loop
    qty := (line->>'quantity')::integer;
    if qty not between 1 and 99 or length(coalesce(line->>'note',''))>200 then raise exception 'Quantidade ou observação inválida'; end if;
    if jsonb_typeof(coalesce(line->'shared','false'::jsonb))<>'boolean' then raise exception 'Pedido inválido'; end if;
    -- Itens com estoque são travados para a baixa; os demais só compartilhados.
    select mi.* into item from public.menu_items mi join public.categories c on c.id=mi.category_id
      where mi.id=(line->>'item_id')::uuid and mi.restaurant_id=rid and mi.active and not mi.sold_out and c.active for update of mi;
    if item.id is null then raise exception 'Um item ficou indisponível. Revise o carrinho'; end if;
    if item.stock_enabled and item.stock_quantity < qty then
      raise exception 'Restam % unidades de %', item.stock_quantity, item.name;
    end if;
    selected := coalesce(line->'modifier_ids','[]'::jsonb);
    if jsonb_typeof(selected)<>'array' then raise exception 'Adicionais inválidos'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(selected)) <> jsonb_array_length(selected) then raise exception 'Adicional duplicado'; end if;
    if exists(select 1 from jsonb_array_elements_text(selected) v where not exists(select 1 from public.modifiers m join public.modifier_groups g on g.id=m.group_id where m.id=v.value::uuid and g.menu_item_id=item.id)) then raise exception 'Adicional inválido'; end if;
    for grp in select * from public.modifier_groups where menu_item_id=item.id for share loop
      select count(*) into count_selected from public.modifiers m where m.group_id=grp.id and selected ? m.id::text;
      if count_selected < grp.min_select or count_selected > grp.max_select then raise exception 'Revise os adicionais de %',grp.name; end if;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('group',g.name,'name',m.name,'price_cents',m.price_cents)),'[]'::jsonb),item.price_cents+coalesce(sum(m.price_cents),0)
      into snapshot,unit from public.modifiers m join public.modifier_groups g on g.id=m.group_id where g.menu_item_id=item.id and selected ? m.id::text;
    total:=total+unit*qty; prep:=greatest(prep,item.prep_minutes);
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot,'shared',coalesce((line->>'shared')::boolean,false),'stock',item.stock_enabled));
  end loop;
  insert into public.orders(restaurant_id,tab_id,guest_id,prep_minutes,total_cents,request_id) values(rid,tab.id,session_guest,prep,total,p_request) returning id into oid;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared)
      values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers',(line->>'shared')::boolean) returning id into line_id;
    if (line->>'stock')::boolean then
      perform private.move_stock((line->>'item_id')::uuid, 'venda', -((line->>'qty')::integer), line_id, null, null);
    end if;
  end loop;
  return jsonb_build_object('id',oid,'prep_minutes',prep,'total_cents',total);
end $$;
