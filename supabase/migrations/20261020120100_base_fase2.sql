-- Fase 2, etapa 1 (spec-fase2.md, seções 10 e 11 e "Decisões transversais"):
-- * registro de operações (audit_log), escrito por triggers nas tabelas que a
--   equipe altera, para valer tanto pela API quanto por acesso direto ao PostgREST;
-- * mais de um papel por pessoa (roles) e permissões ajustáveis por pessoa;
-- * membro desligado (active = false) sem apagar o histórico.
--
-- Compatível com a versão publicada do app: a coluna `role` continua existindo e
-- é mantida em sincronia com `roles` por trigger (role = primeiro papel).

-- ---------------------------------------------------------------------------
-- Papéis múltiplos, permissões e desligamento
-- ---------------------------------------------------------------------------

alter table public.restaurant_members
  add column roles public.member_role[] not null default '{}'::public.member_role[],
  add column permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  add column active boolean not null default true;

update public.restaurant_members set roles = array[role];

alter table public.restaurant_members
  alter column roles drop default,
  add constraint restaurant_members_roles_not_empty check (cardinality(roles) >= 1);

-- role ⇄ roles: aceita escrita antiga (só role) e nova (só roles).
create function private.sync_member_roles()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.roles is null or cardinality(new.roles) = 0 then
    new.roles := array[new.role];
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role and new.roles = old.roles then
    -- A versão anterior do app só muda `role`.
    new.roles := array[new.role];
  end if;
  new.roles := (select array_agg(distinct r order by r) from unnest(new.roles) r);
  if new.role is null or not (new.role = any (new.roles)) then
    new.role := new.roles[1];
  end if;
  return new;
end;
$$;

create trigger restaurant_members_sync_roles
before insert or update on public.restaurant_members
for each row execute function private.sync_member_roles();

-- Permissão padrão de cada papel (espelhada em lib/permissions.ts).
create function private.default_permission(roles public.member_role[], perm text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when 'manager' = any ($1) then true
    when 'waiter' = any ($1) then $2 in ('cancel_items', 'register_payment', 'close_tab', 'merge_tables')
    else false
  end;
$$;

-- Permissão efetiva: gestor tem tudo; os demais usam o ajuste por pessoa ou o
-- padrão do papel. O revendedor dono do restaurante também pode tudo.
create function private.has_permission(rid uuid, perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case
      when 'manager' = any (m.roles) then true
      else coalesce((m.permissions ->> $2)::boolean, private.default_permission(m.roles, $2))
    end
    from public.restaurant_members m
    where m.restaurant_id = $1 and m.user_id = (select auth.uid()) and m.active
  ), false) or private.is_reseller_of($1);
$$;

-- is_member passa a olhar `roles` e a ignorar quem foi desligado.
create or replace function private.is_member(rid uuid, roles public.member_role[] default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = $1
      and m.user_id = (select auth.uid())
      and m.active
      and ($2 is null or m.roles && $2)
  );
$$;

-- Edição do cardápio: gestor, revendedor ou quem recebeu a permissão.
create function private.can_edit_menu(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission($1, 'edit_menu');
$$;

revoke all on function private.default_permission(public.member_role[], text) from public;
revoke all on function private.has_permission(uuid, text) from public;
revoke all on function private.can_edit_menu(uuid) from public;
grant execute on function private.default_permission(public.member_role[], text) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;
grant execute on function private.can_edit_menu(uuid) to authenticated, service_role;

-- Ninguém mexe no próprio vínculo, e só a revenda mexe em gestores.
create function private.guard_member_change()
returns trigger
language plpgsql set search_path = ''
as $$
declare uid uuid := (select auth.uid()); rid uuid := coalesce(new.restaurant_id, old.restaurant_id);
begin
  if uid is null or private.is_reseller_of(rid) then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' and old.user_id = uid then
    raise exception 'Você não pode alterar o próprio acesso' using errcode = '42501';
  end if;
  if (tg_op <> 'INSERT' and 'manager' = any (old.roles)) or (tg_op <> 'DELETE' and 'manager' = any (new.roles)) then
    raise exception 'Apenas a revenda altera o acesso de gestores' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger restaurant_members_guard_change
before insert or update or delete on public.restaurant_members
for each row execute function private.guard_member_change();

-- Cardápio: quem tem a permissão edita; cozinha e bar só marcam esgotado.
drop policy "categories: gestão cria" on public.categories;
drop policy "categories: gestão edita" on public.categories;
drop policy "categories: gestão remove" on public.categories;
create policy "categories: gestão cria" on public.categories
  for insert to authenticated with check (private.can_edit_menu(restaurant_id));
create policy "categories: gestão edita" on public.categories
  for update to authenticated
  using (private.can_edit_menu(restaurant_id)) with check (private.can_edit_menu(restaurant_id));
create policy "categories: gestão remove" on public.categories
  for delete to authenticated using (private.can_edit_menu(restaurant_id));

drop policy "menu_items: gestão cria" on public.menu_items;
drop policy "menu_items: gestão e cozinha editam" on public.menu_items;
drop policy "menu_items: gestão remove" on public.menu_items;
create policy "menu_items: gestão cria" on public.menu_items
  for insert to authenticated with check (private.can_edit_menu(restaurant_id));
create policy "menu_items: gestão, cozinha e bar editam" on public.menu_items
  for update to authenticated
  using (private.can_edit_menu(restaurant_id) or private.is_member(restaurant_id, array['kitchen', 'bar']::public.member_role[]))
  with check (private.can_edit_menu(restaurant_id) or private.is_member(restaurant_id, array['kitchen', 'bar']::public.member_role[]));
create policy "menu_items: gestão remove" on public.menu_items
  for delete to authenticated using (private.can_edit_menu(restaurant_id));

drop policy "modifier_groups: gestão cria" on public.modifier_groups;
drop policy "modifier_groups: gestão edita" on public.modifier_groups;
drop policy "modifier_groups: gestão remove" on public.modifier_groups;
create policy "modifier_groups: gestão cria" on public.modifier_groups
  for insert to authenticated with check (private.can_edit_menu(private.item_restaurant(menu_item_id)));
create policy "modifier_groups: gestão edita" on public.modifier_groups
  for update to authenticated
  using (private.can_edit_menu(private.item_restaurant(menu_item_id)))
  with check (private.can_edit_menu(private.item_restaurant(menu_item_id)));
create policy "modifier_groups: gestão remove" on public.modifier_groups
  for delete to authenticated using (private.can_edit_menu(private.item_restaurant(menu_item_id)));

drop policy "modifiers: gestão cria" on public.modifiers;
drop policy "modifiers: gestão edita" on public.modifiers;
drop policy "modifiers: gestão remove" on public.modifiers;
create policy "modifiers: gestão cria" on public.modifiers
  for insert to authenticated with check (private.can_edit_menu(private.group_restaurant(group_id)));
create policy "modifiers: gestão edita" on public.modifiers
  for update to authenticated
  using (private.can_edit_menu(private.group_restaurant(group_id)))
  with check (private.can_edit_menu(private.group_restaurant(group_id)));
create policy "modifiers: gestão remove" on public.modifiers
  for delete to authenticated using (private.can_edit_menu(private.group_restaurant(group_id)));

create or replace function private.guard_menu_item_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.can_edit_menu(old.restaurant_id)
     and (to_jsonb(new) - 'sold_out') is distinct from (to_jsonb(old) - 'sold_out') then
    raise exception 'A cozinha e o bar só podem marcar itens como esgotados' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.save_menu_item(p_restaurant uuid,p_item uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare iid uuid; gid uuid; grp jsonb; modifier jsonb;
begin
  if not private.can_edit_menu(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.categories where id=(p_data->>'category_id')::uuid and restaurant_id=p_restaurant) then raise exception 'Categoria inválida'; end if;
  if p_item is null then
    insert into public.menu_items(restaurant_id,category_id,name,description,price_cents,photo_url,prep_minutes,active,featured,position)
    values(p_restaurant,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',(p_data->>'price_cents')::integer,p_data->>'photo_url',(p_data->>'prep_minutes')::integer,(p_data->>'active')::boolean,(p_data->>'featured')::boolean,coalesce((p_data->>'position')::integer,0)) returning id into iid;
  else
    update public.menu_items set category_id=(p_data->>'category_id')::uuid,name=p_data->>'name',description=p_data->>'description',price_cents=(p_data->>'price_cents')::integer,photo_url=p_data->>'photo_url',prep_minutes=(p_data->>'prep_minutes')::integer,active=(p_data->>'active')::boolean,featured=(p_data->>'featured')::boolean
      where id=p_item and restaurant_id=p_restaurant returning id into iid;
    if iid is null then raise exception 'Item indisponível'; end if;
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

create or replace function public.reorder_menu(p_restaurant uuid,p_kind text,p_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare iid uuid; pos integer:=0;
begin
  if not private.can_edit_menu(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_kind not in ('categories','menu_items') then raise exception 'Lista inválida'; end if;
  if cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'IDs duplicados'; end if;
  foreach iid in array p_ids loop
    if p_kind='categories' then
      update public.categories set position=pos where id=iid and restaurant_id=p_restaurant;
    else
      update public.menu_items set position=pos where id=iid and restaurant_id=p_restaurant;
    end if;
    if not found then raise exception 'Item inválido'; end if;
    pos:=pos+1;
  end loop;
end $$;

-- Permissões nas ações que já existem: fechar comanda, cancelar pedido e
-- registrar pagamento. Cozinha e bar iniciam e finalizam o preparo.
create or replace function private.guard_tab_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'open' then
    raise exception 'Comanda fechada não pode ser reaberta' using errcode = '23514';
  end if;
  if new.status = 'closed' and old.status = 'open' then
    if (select auth.uid()) is not null and not private.has_permission(old.restaurant_id, 'close_tab') then
      raise exception 'Você não tem permissão para fechar comandas' using errcode = '42501';
    end if;
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

create or replace function private.guard_order_role() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is not null and new.status is distinct from old.status then
    if new.status in ('em_preparo','pronto') and not private.is_member(old.restaurant_id,array['kitchen','bar','manager']::public.member_role[]) then raise exception 'Apenas cozinha, bar ou gestor' using errcode='42501'; end if;
    if new.status = 'entregue' and not private.is_member(old.restaurant_id,array['waiter','manager']::public.member_role[]) then raise exception 'Apenas garçom ou gestor' using errcode='42501'; end if;
    if new.status = 'cancelado' and not private.has_permission(old.restaurant_id,'cancel_items') then raise exception 'Você não tem permissão para cancelar pedidos' using errcode='42501'; end if;
  end if;
  if auth.uid() is not null and new.pinned is distinct from old.pinned and not private.is_member(old.restaurant_id,array['kitchen','bar','manager']::public.member_role[]) then raise exception 'Apenas cozinha, bar ou gestor' using errcode='42501'; end if;
  return new;
end $$;

create or replace function private.guard_tab_guest_update() returns trigger language plpgsql set search_path='' as $$
begin
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

-- ---------------------------------------------------------------------------
-- Registro de operações
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- Usuário da equipe ou revenda; nulo para cliente e sistema.
  actor_id uuid,
  -- manager | waiter | kitchen | bar | reseller | customer | system
  actor_role text not null,
  action text not null,
  entity text,
  entity_id uuid,
  tab_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_log_restaurant_idx on public.audit_log (restaurant_id, created_at desc);
create index audit_log_tab_idx on public.audit_log (tab_id) where tab_id is not null;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
-- Só inserção, por trigger; ninguém edita nem apaga.
create policy "audit_log: equipe lê" on public.audit_log
  for select to authenticated using (private.can_read(restaurant_id));

-- Quem fez: equipe pelo auth.uid(); cliente e sistema pelo app.actor que as
-- RPCs do servidor definem na transação.
create function private.audit(rid uuid, p_action text, p_entity text, p_entity_id uuid, p_tab uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); actor text;
begin
  actor := nullif(current_setting('app.actor', true), '');
  if actor is null then
    if uid is null then
      actor := 'system';
    else
      select m.roles[1]::text into actor from public.restaurant_members m
        where m.restaurant_id = rid and m.user_id = uid;
      if actor is null and private.is_reseller_of(rid) then actor := 'reseller'; end if;
      actor := coalesce(actor, 'unknown');
    end if;
  end if;
  insert into public.audit_log (restaurant_id, actor_id, actor_role, action, entity, entity_id, tab_id, data)
  values (rid, uid, actor, p_action, p_entity, p_entity_id, p_tab, coalesce(p_data, '{}'::jsonb));
end;
$$;
revoke all on function private.audit(uuid, text, text, uuid, uuid, jsonb) from public;
grant execute on function private.audit(uuid, text, text, uuid, uuid, jsonb) to authenticated, service_role;

create function private.audit_tabs() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'mesa_aberta', 'tab', new.id, new.id, jsonb_build_object('table_id', new.table_id));
  elsif new.status = 'closed' and old.status = 'open' then
    perform private.audit(new.restaurant_id, 'comanda_fechada', 'tab', new.id, new.id, jsonb_build_object('table_id', new.table_id));
  elsif new.pin <> old.pin then
    perform private.audit(new.restaurant_id, 'pin_novo', 'tab', new.id, new.id, jsonb_build_object('table_id', new.table_id));
  end if;
  return null;
end $$;
create trigger tabs_audit after insert or update on public.tabs
for each row execute function private.audit_tabs();

create function private.audit_orders() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'pedido_enviado', 'order', new.id, new.tab_id,
      jsonb_build_object('total_cents', new.total_cents, 'guest_id', new.guest_id, 'prep_minutes', new.prep_minutes));
  else
    if new.status is distinct from old.status then
      perform private.audit(new.restaurant_id, 'pedido_' || new.status::text, 'order', new.id, new.tab_id,
        jsonb_build_object('from', old.status, 'total_cents', new.total_cents, 'guest_id', new.guest_id));
    end if;
    if new.pinned is distinct from old.pinned then
      perform private.audit(new.restaurant_id, case when new.pinned then 'pedido_fixado' else 'pedido_desafixado' end, 'order', new.id, new.tab_id, '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
create trigger orders_audit after insert or update on public.orders
for each row execute function private.audit_orders();

create function private.audit_tab_guests() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.paid_cents is distinct from old.paid_cents then
    perform private.audit(new.restaurant_id,
      case when new.paid_cents is null then 'pagamento_desfeito' else 'pagamento_marcado' end,
      'guest', new.id, new.tab_id, jsonb_build_object('name', new.name, 'paid_cents', new.paid_cents));
  end if;
  return null;
end $$;
create trigger tab_guests_audit after update on public.tab_guests
for each row execute function private.audit_tab_guests();

create function private.audit_menu_items() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sold_out is distinct from old.sold_out then
    perform private.audit(new.restaurant_id, case when new.sold_out then 'item_esgotado' else 'item_reposto' end,
      'menu_item', new.id, null, jsonb_build_object('name', new.name));
  end if;
  if new.price_cents is distinct from old.price_cents then
    perform private.audit(new.restaurant_id, 'preco_alterado', 'menu_item', new.id, null,
      jsonb_build_object('name', new.name, 'from', old.price_cents, 'to', new.price_cents));
  end if;
  if new.active is distinct from old.active then
    perform private.audit(new.restaurant_id, case when new.active then 'item_ativado' else 'item_desativado' end,
      'menu_item', new.id, null, jsonb_build_object('name', new.name));
  end if;
  return null;
end $$;
create trigger menu_items_audit after update on public.menu_items
for each row execute function private.audit_menu_items();

create function private.audit_members() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'membro_adicionado', 'member', new.user_id, null,
      jsonb_build_object('roles', to_jsonb(new.roles)));
  elsif tg_op = 'DELETE' then
    perform private.audit(old.restaurant_id, 'membro_removido', 'member', old.user_id, null,
      jsonb_build_object('roles', to_jsonb(old.roles)));
  elsif new.roles is distinct from old.roles or new.permissions is distinct from old.permissions or new.active is distinct from old.active then
    perform private.audit(new.restaurant_id, 'membro_alterado', 'member', new.user_id, null,
      jsonb_build_object('roles', to_jsonb(new.roles), 'permissions', new.permissions, 'active', new.active));
  end if;
  return null;
end $$;
create trigger restaurant_members_audit after insert or update or delete on public.restaurant_members
for each row execute function private.audit_members();

-- As RPCs do cliente marcam o autor como "customer" para o registro.
create or replace function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; session_guest uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; total integer:=0; prep integer:=1; lines jsonb:='[]';
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
    select mi.* into item from public.menu_items mi join public.categories c on c.id=mi.category_id
      where mi.id=(line->>'item_id')::uuid and mi.restaurant_id=rid and mi.active and not mi.sold_out and c.active for share of mi,c;
    if item.id is null then raise exception 'Um item ficou indisponível. Revise o carrinho'; end if;
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
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot,'shared',coalesce((line->>'shared')::boolean,false)));
  end loop;
  insert into public.orders(restaurant_id,tab_id,guest_id,prep_minutes,total_cents,request_id) values(rid,tab.id,session_guest,prep,total,p_request) returning id into oid;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared)
      values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers',(line->>'shared')::boolean);
  end loop;
  return jsonb_build_object('id',oid,'prep_minutes',prep,'total_cents',total);
end $$;

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
  update public.orders set status='cancelado' where id=p_order and tab_id=bid and status='recebido' and guest_id is not distinct from gid;
  return found;
end $$;
