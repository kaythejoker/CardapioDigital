-- Fase 2, etapa 5 (spec-fase2.md, seção 4): unir mesas.
-- tab_tables guarda as mesas unidas a uma comanda (a principal continua em
-- tabs.table_id). Uma mesa só pode estar em uma comanda aberta, principal ou
-- unida. O QR de qualquer mesa da comanda leva à mesma comanda e aceita o mesmo
-- PIN. Unir duas comandas abertas move pedidos, pessoas e chamadas para a
-- primeira; a segunda fecha como "unida" e os celulares dela digitam o PIN de
-- novo. Fechar a comanda libera todas as mesas.

create table public.tab_tables (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  tab_id uuid not null,
  table_id uuid not null,
  added_at timestamptz not null default now(),
  added_by uuid,
  released_at timestamptz,
  foreign key (tab_id, restaurant_id) references public.tabs (id, restaurant_id) on delete cascade,
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade
);
-- Mesa unida só pode estar em uma comanda por vez.
create unique index tab_tables_active_table on public.tab_tables (table_id) where released_at is null;
create index tab_tables_tab_idx on public.tab_tables (tab_id) where released_at is null;

alter table public.tabs add column merged_into uuid references public.tabs (id) on delete set null;

alter table public.tab_tables enable row level security;
revoke all on public.tab_tables from anon, authenticated;
grant select on public.tab_tables to authenticated;
grant select, insert, update on public.tab_tables to service_role;
create policy "tab_tables: equipe lê" on public.tab_tables
  for select to authenticated using (private.can_read(restaurant_id));

-- Comanda aberta de uma mesa, seja principal ou unida.
create function public.tab_for_table(p_table uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select t.id from public.tabs t where t.table_id = p_table and t.status = 'open'
  union all
  select tt.tab_id from public.tab_tables tt join public.tabs t on t.id = tt.tab_id
    where tt.table_id = p_table and tt.released_at is null and t.status = 'open'
  limit 1;
$$;
revoke all on function public.tab_for_table(uuid) from public, anon;
grant execute on function public.tab_for_table(uuid) to authenticated, service_role;

-- Uma mesa unida não pode ser aberta como comanda própria.
create or replace function public.open_table(p_table uuid)
returns public.tabs language plpgsql security invoker set search_path='' as $$
declare t public.tables; result public.tabs; candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_table::text, 1));
  select * into t from public.tables where id=p_table and active;
  if t.id is null then raise exception 'Mesa indisponível'; end if;
  if not private.is_member(t.restaurant_id,array['waiter','manager']::public.member_role[]) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if public.tab_for_table(t.id) is not null then raise exception 'A mesa já está aberta'; end if;
  for i in 1..100 loop
    candidate:=lpad(floor(random()*10000)::integer::text,4,'0');
    begin
      insert into public.tabs(restaurant_id,table_id,pin,opened_by) values(t.restaurant_id,t.id,candidate,auth.uid()) returning * into result;
      return result;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Não foi possível gerar um código. Tente novamente';
end $$;

-- Mover pedidos e pessoas entre comandas exige passar pelos guards.
create or replace function private.guard_order_update()
returns trigger
language plpgsql set search_path = ''
as $$
declare expected integer;
begin
  if coalesce(current_setting('app.merge', true), '') = '1' then return new; end if;
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

create or replace function private.guard_tab_guest_update() returns trigger language plpgsql set search_path='' as $$
begin
  if coalesce(current_setting('app.merge', true), '') = '1' then return new; end if;
  if (to_jsonb(new) - array['paid_cents','paid_at']) is distinct from (to_jsonb(old) - array['paid_cents','paid_at']) then
    raise exception 'Só o pagamento da pessoa pode ser alterado' using errcode='42501';
  end if;
  if not exists(select 1 from public.tabs where id=old.tab_id and status='open') then
    raise exception 'A comanda foi fechada' using errcode='23514';
  end if;
  if new.paid_cents is distinct from old.paid_cents then
    if (select auth.uid()) is not null and not private.has_permission(old.restaurant_id,'register_payment') then
      raise exception 'Você não tem permissão para registrar pagamentos' using errcode='42501';
    end if;
    new.paid_at := case when new.paid_cents is null then null else now() end;
  end if;
  return new;
end $$;

create or replace function private.guard_service_call_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.merge', true), '') = '1' then return new; end if;
  if (select auth.uid()) is not null and coalesce(current_setting('app.actor', true), '') <> 'system' then
    if (to_jsonb(new) - array['status', 'attended_by', 'attended_at']) is distinct from (to_jsonb(old) - array['status', 'attended_by', 'attended_at'])
       or old.status <> 'aberta' or new.status <> 'atendida' then
      raise exception 'A chamada só pode ser marcada como atendida' using errcode = '42501';
    end if;
    new.attended_by := (select auth.uid());
    new.attended_at := now();
  end if;
  if new.status = 'atendida' and new.attended_at is null then new.attended_at := now(); end if;
  return new;
end;
$$;

-- A chave (guest_id, tab_id) dos pedidos precisa esperar a pessoa mudar de comanda.
alter table public.orders drop constraint orders_guest_fkey;
alter table public.orders add constraint orders_guest_fkey foreign key (guest_id, tab_id)
  references public.tab_guests (id, tab_id) deferrable initially immediate;

-- Fechar a comanda libera as mesas unidas.
create or replace function private.revoke_tab_sessions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tab_sessions where tab_id = new.id;
  update public.service_calls set status = 'atendida', attended_at = now() where tab_id = new.id and status = 'aberta';
  update public.tab_tables set released_at = now() where tab_id = new.id and released_at is null;
  return null;
end;
$$;

-- Garçom ou gestor une uma mesa (livre ou com comanda aberta) a uma comanda.
create function public.merge_table(p_tab uuid, p_table uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target public.tabs; t public.tables; other public.tabs; g record; new_name text; moved_orders integer := 0; moved_guests integer := 0; other_label text; tt record;
begin
  select * into target from public.tabs where id = p_tab for update;
  if target.id is null or target.status <> 'open' then raise exception 'A comanda não está aberta'; end if;
  if not private.has_permission(target.restaurant_id, 'merge_tables') then raise exception 'Você não tem permissão para unir mesas' using errcode = '42501'; end if;
  select * into t from public.tables where id = p_table and restaurant_id = target.restaurant_id and active;
  if t.id is null then raise exception 'Mesa indisponível'; end if;
  if t.id = target.table_id or exists (select 1 from public.tab_tables where tab_id = target.id and table_id = t.id and released_at is null) then
    raise exception 'Essa mesa já faz parte desta comanda';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(t.id::text, 1));
  perform set_config('app.merge', '1', true);
  set constraints public.orders_guest_fkey deferred;
  -- Mesa com comanda própria aberta: tudo dela passa para a comanda alvo.
  select * into other from public.tabs where table_id = t.id and status = 'open' for update;
  if other.id is not null then
    -- Chamadas primeiro: fechar a segunda comanda encerra as que ainda estiverem nela.
    update public.service_calls set tab_id = target.id where tab_id = other.id and status = 'aberta';
    update public.tabs set status = 'closed', merged_into = target.id where id = other.id;
    for g in select * from public.tab_guests where tab_id = other.id loop
      new_name := g.name;
      if exists (select 1 from public.tab_guests where tab_id = target.id and lower(btrim(name)) = lower(btrim(new_name))) then
        new_name := left(g.name, 40 - char_length(' (mesa ' || t.label || ')')) || ' (mesa ' || t.label || ')';
      end if;
      update public.tab_guests set tab_id = target.id, name = new_name where id = g.id;
      moved_guests := moved_guests + 1;
    end loop;
    update public.orders set tab_id = target.id where tab_id = other.id;
    get diagnostics moved_orders = row_count;
    -- Mesas que já estavam unidas à segunda comanda passam junto.
    for tt in select * from public.tab_tables where tab_id = other.id and released_at is null loop
      update public.tab_tables set released_at = now() where id = tt.id;
      insert into public.tab_tables (restaurant_id, tab_id, table_id, added_by) values (target.restaurant_id, target.id, tt.table_id, (select auth.uid()));
    end loop;
    perform private.audit(target.restaurant_id, 'comandas_unidas', 'tab', target.id, target.id,
      jsonb_build_object('from_tab', other.id, 'table_id', t.id, 'orders', moved_orders, 'guests', moved_guests));
  elsif exists (select 1 from public.tab_tables where table_id = t.id and released_at is null) then
    raise exception 'Essa mesa já está unida a outra comanda';
  end if;
  insert into public.tab_tables (restaurant_id, tab_id, table_id, added_by) values (target.restaurant_id, target.id, t.id, (select auth.uid()));
  perform private.audit(target.restaurant_id, 'mesa_unida', 'tab', target.id, target.id, jsonb_build_object('table_id', t.id, 'label', t.label));
  perform set_config('app.merge', '', true);
  return jsonb_build_object('ok', true, 'moved_orders', moved_orders, 'moved_guests', moved_guests);
end;
$$;
revoke all on function public.merge_table(uuid, uuid) from public, anon;
grant execute on function public.merge_table(uuid, uuid) to authenticated;

-- Separar: a mesa volta a ficar livre; os pedidos ficam todos na comanda.
create function public.split_table(p_tab uuid, p_table uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare target public.tabs; t public.tables;
begin
  select * into target from public.tabs where id = p_tab for update;
  if target.id is null or target.status <> 'open' then raise exception 'A comanda não está aberta'; end if;
  if not private.has_permission(target.restaurant_id, 'merge_tables') then raise exception 'Você não tem permissão para unir mesas' using errcode = '42501'; end if;
  if target.table_id = p_table then raise exception 'A mesa principal não pode ser separada'; end if;
  update public.tab_tables set released_at = now() where tab_id = target.id and table_id = p_table and released_at is null;
  if not found then return false; end if;
  select * into t from public.tables where id = p_table;
  perform private.audit(target.restaurant_id, 'mesa_separada', 'tab', target.id, target.id, jsonb_build_object('table_id', p_table, 'label', t.label));
  return true;
end;
$$;
revoke all on function public.split_table(uuid, uuid) from public, anon;
grant execute on function public.split_table(uuid, uuid) to authenticated;

-- As RPCs do cliente aceitam o QR de qualquer mesa da comanda.
create or replace function public.verify_table_pin(p_slug text, p_qr text, p_pin text, p_device text, p_hash text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; tab public.tabs; attempt public.pin_attempts; failures integer; v_name text; gid uuid;
begin
  v_name := nullif(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'), '');
  if char_length(v_name) > 40 then return jsonb_build_object('error','Nome muito longo','status',400); end if;
  select t.restaurant_id, t.id into rid, tid from public.tables t join public.restaurants r on r.id=t.restaurant_id
    where r.slug=p_slug and r.status='active' and t.qr_token=p_qr and t.active;
  if tid is null then return jsonb_build_object('error','Mesa indisponível','status',404); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device || rid::text, 0));
  insert into public.pin_attempts(device_id,restaurant_id) values(p_device,rid) on conflict do nothing;
  select * into attempt from public.pin_attempts where device_id=p_device and restaurant_id=rid for update;
  if attempt.locked_until > now() then return jsonb_build_object('error','Aguarde 5 minutos para tentar novamente','status',429); end if;
  select * into tab from public.tabs where id = public.tab_for_table(tid) and status='open' for update;
  if tab.id is null then return jsonb_build_object('error','Chame o garçom para abrir a mesa','status',409); end if;
  if tab.pin <> p_pin then
    failures := case when attempt.locked_until is not null then 1 else attempt.failed_count+1 end;
    update public.pin_attempts set failed_count=failures,locked_until=case when failures>=5 then now()+interval '5 minutes' else null end,updated_at=now()
      where device_id=p_device and restaurant_id=rid;
    return jsonb_build_object('error',case when failures>=5 then 'Aguarde 5 minutos para tentar novamente' else 'Código incorreto' end,'status',case when failures>=5 then 429 else 401 end);
  end if;
  update public.pin_attempts set failed_count=0,locked_until=null,updated_at=now() where device_id=p_device and restaurant_id=rid;
  if v_name is not null then
    insert into public.tab_guests(restaurant_id,tab_id,name) values(rid,tab.id,v_name) on conflict do nothing returning id into gid;
    if gid is null then
      select id into gid from public.tab_guests where tab_id=tab.id and lower(btrim(name))=lower(v_name);
    end if;
  end if;
  insert into public.tab_sessions(tab_id,token_hash,guest_id) values(tab.id,p_hash,gid);
  return jsonb_build_object('tab_id',tab.id,'guest_id',gid);
end $$;

-- Sessão válida para a mesa do QR: a comanda da sessão precisa ser a comanda
-- aberta dessa mesa (principal ou unida).
create function private.session_tab(p_slug text, p_qr text, p_hash text, out o_rid uuid, out o_tab uuid, out o_guest uuid)
language plpgsql stable security definer set search_path = '' as $$
declare tid uuid;
begin
  select t.restaurant_id, t.id into o_rid, tid from public.tables t join public.restaurants r on r.id = t.restaurant_id
    where r.slug = p_slug and r.status = 'active' and t.qr_token = p_qr and t.active;
  if tid is null then return; end if;
  select s.tab_id, s.guest_id into o_tab, o_guest from public.tab_sessions s
    where s.token_hash = p_hash and s.expires_at > now() and s.tab_id = public.tab_for_table(tid);
end $$;
revoke all on function private.session_tab(text, text, text) from public;
grant execute on function private.session_tab(text, text, text) to authenticated, service_role;

create or replace function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; session_guest uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; lines jsonb:='[]'; line_id uuid; st text;
  batch uuid; created jsonb:='[]'; total_all integer:=0; prep_all integer:=1; st_total integer; st_prep integer; existing_batch uuid;
begin
  perform set_config('app.actor', 'customer', true);
  select o_rid, o_tab, o_guest into rid, session_tab, session_guest from private.session_tab(p_slug, p_qr, p_hash);
  if session_tab is null then raise exception 'Sessão inválida. Digite o código da mesa' using errcode='28000'; end if;
  select * into tab from public.tabs where id=session_tab for update;
  if tab.status <> 'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  select id, batch_id into oid, existing_batch from public.orders where request_id=p_request and tab_id=tab.id order by created_at limit 1;
  if oid is not null then
    return jsonb_build_object('id',oid,'batch_id',existing_batch,
      'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'station',o.station)),'[]'::jsonb) from public.orders o where o.request_id=p_request and o.tab_id=tab.id));
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Pedido inválido'; end if;
  for line in select value from jsonb_array_elements(p_items) loop
    qty := (line->>'quantity')::integer;
    if qty not between 1 and 99 or length(coalesce(line->>'note',''))>200 then raise exception 'Quantidade ou observação inválida'; end if;
    if jsonb_typeof(coalesce(line->'shared','false'::jsonb))<>'boolean' then raise exception 'Pedido inválido'; end if;
    select mi.* into item from public.menu_items mi join public.categories c on c.id=mi.category_id
      where mi.id=(line->>'item_id')::uuid and mi.restaurant_id=rid and mi.active and not mi.sold_out and c.active for update of mi;
    if item.id is null then raise exception 'Um item ficou indisponível. Revise o carrinho'; end if;
    select coalesce(mi.station, c.station, 'cozinha') into st from public.menu_items mi join public.categories c on c.id=mi.category_id where mi.id=item.id;
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
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot,'shared',coalesce((line->>'shared')::boolean,false),'stock',item.stock_enabled,'station',st,'prep',item.prep_minutes));
  end loop;
  batch := gen_random_uuid();
  for st in select distinct value->>'station' from jsonb_array_elements(lines) order by 1 loop
    select coalesce(sum((value->>'unit')::integer*(value->>'qty')::integer),0), coalesce(max((value->>'prep')::integer),1)
      into st_total, st_prep from jsonb_array_elements(lines) where value->>'station'=st;
    insert into public.orders(restaurant_id,tab_id,guest_id,prep_minutes,total_cents,request_id,station,batch_id)
      values(rid,tab.id,session_guest,st_prep,st_total,p_request,st,batch) returning id into oid;
    for line in select value from jsonb_array_elements(lines) where value->>'station'=st loop
      insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared,station)
        values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers',(line->>'shared')::boolean,st) returning id into line_id;
      if (line->>'stock')::boolean then
        perform private.move_stock((line->>'item_id')::uuid, 'venda', -((line->>'qty')::integer), line_id, null, null);
      end if;
    end loop;
    total_all := total_all + st_total; prep_all := greatest(prep_all, st_prep);
    created := created || jsonb_build_array(jsonb_build_object('id',oid,'station',st,'prep_minutes',st_prep,'total_cents',st_total));
  end loop;
  return jsonb_build_object('id',(created->0->>'id')::uuid,'batch_id',batch,'prep_minutes',prep_all,'total_cents',total_all,'orders',created);
end $$;

create or replace function public.cancel_table_order(p_slug text,p_qr text,p_hash text,p_order uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; gid uuid; tab public.tabs;
begin
  perform set_config('app.actor', 'customer', true);
  select o_tab, o_guest into bid, gid from private.session_tab(p_slug, p_qr, p_hash);
  if bid is null then raise exception 'Sessão inválida' using errcode='28000'; end if;
  select * into tab from public.tabs where id=bid for update;
  if tab.status<>'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  update public.orders set status='cancelado', cancel_reason='Cancelado pelo cliente' where id=p_order and tab_id=bid and status='recebido' and guest_id is not distinct from gid;
  return found;
end $$;

create or replace function public.cancel_table_order_item(p_slug text, p_qr text, p_hash text, p_item uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; gid uuid; tab public.tabs; line public.order_items; o public.orders;
begin
  perform set_config('app.actor', 'customer', true);
  select o_tab, o_guest into bid, gid from private.session_tab(p_slug, p_qr, p_hash);
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

create or replace function public.create_service_call(p_slug text, p_qr text, p_hash text, p_device text, p_kind text, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; bid uuid; gid uuid; existing public.service_calls; created public.service_calls; v_note text;
begin
  perform set_config('app.actor', 'customer', true);
  select t.restaurant_id, t.id into rid, tid from public.tables t join public.restaurants r on r.id = t.restaurant_id
    where r.slug = p_slug and r.status = 'active' and t.qr_token = p_qr and t.active;
  if tid is null then return jsonb_build_object('error', 'Mesa indisponível', 'status', 404); end if;
  if p_kind not in ('garcom', 'conta', 'ajuda') then return jsonb_build_object('error', 'Chamada inválida', 'status', 400); end if;
  v_note := nullif(left(regexp_replace(btrim(coalesce(p_note, '')), '\s+', ' ', 'g'), 80), '');
  if p_hash is not null then
    select o_tab, o_guest into bid, gid from private.session_tab(p_slug, p_qr, p_hash);
  end if;
  if bid is null then
    if p_kind <> 'garcom' then return jsonb_build_object('error', 'Digite o código da mesa para pedir a conta', 'status', 401); end if;
    if exists (select 1 from public.service_calls where device_id = p_device and created_at > now() - interval '2 minutes') then
      return jsonb_build_object('error', 'Já avisamos o garçom. Aguarde um instante', 'status', 429);
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tid::text || p_kind, 2));
  select * into existing from public.service_calls where table_id = tid and kind = p_kind and status = 'aberta';
  if existing.id is not null then
    return jsonb_build_object('id', existing.id, 'kind', existing.kind, 'created_at', existing.created_at, 'already', true);
  end if;
  insert into public.service_calls (restaurant_id, table_id, tab_id, guest_id, device_id, kind, note)
    values (rid, tid, bid, gid, p_device, p_kind, v_note) returning * into created;
  return jsonb_build_object('id', created.id, 'kind', created.kind, 'created_at', created.created_at, 'already', false);
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tab_tables;
  end if;
end;
$$;
