-- Fase 3 (spec-fase3.md): lista de espera, bloqueios e idiomas.
-- * Lista de espera por restaurante com número de ordem do dia (fuso de São
--   Paulo), status e token público para o cliente acompanhar a posição.
-- * Pausar pedidos do restaurante, bloquear uma comanda e bloquear item ou
--   categoria com motivo e janela de horário. Conferido no banco, no envio do
--   cliente, por gatilhos: a submit_table_order não muda.
-- * Traduções (en, es) de item, categoria, grupo de adicionais e adicional.
-- * Três módulos novos no plano: waitlist, order_blocks e languages. Planos
--   existentes não têm as chaves e ficam com tudo ligado (all_on).
-- * Permissão nova block_orders, padrão ligado para garçom, cozinha e bar.

-- ---------------------------------------------------------------------------
-- Módulos e permissão
-- ---------------------------------------------------------------------------

create or replace function public.restaurant_access(p_restaurant uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.subscriptions; p public.plans; st text;
  all_on jsonb := '{"bar":true,"stock":true,"finance":true,"reports":true,"service_calls":true,"surveys":true,"custom_domain":true,"waitlist":true,"order_blocks":true,"languages":true}'::jsonb;
begin
  select * into s from public.subscriptions where restaurant_id = p_restaurant;
  if s.id is null then
    return jsonb_build_object('status', 'ativa', 'blocked', false, 'plan', null, 'features', all_on, 'period_end', null, 'trial_ends_at', null, 'max_tables', null);
  end if;
  select * into p from public.plans where id = s.plan_id;
  st := private.effective_status(s);
  return jsonb_build_object(
    'status', st,
    'blocked', st in ('suspensa', 'cancelada'),
    'plan', p.name,
    'plan_id', p.id,
    'features', all_on || coalesce(p.features, '{}'::jsonb),
    'period_end', s.current_period_end,
    'trial_ends_at', s.trial_ends_at,
    'grace_days', s.grace_days,
    'max_tables', p.max_tables
  );
end;
$$;

-- Espelhado em lib/permissions.ts.
create or replace function private.default_permission(roles public.member_role[], perm text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when 'manager' = any ($1) then true
    when $2 = 'block_orders' then $1 && array['waiter', 'kitchen', 'bar']::public.member_role[]
    when 'waiter' = any ($1) then $2 in ('cancel_items', 'register_payment', 'close_tab', 'merge_tables')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Idiomas
-- ---------------------------------------------------------------------------

-- {"en": {"name": "...", "description": "..."}, "es": {...}}; só textos curtos.
create function private.valid_translations(j jsonb, fields text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(j) = 'object'
    and not exists (
      select 1 from jsonb_each(j) l
      where l.key not in ('en', 'es')
         or jsonb_typeof(l.value) <> 'object'
         or exists (
           select 1 from jsonb_each(l.value) f
           where f.key <> all (fields)
              or jsonb_typeof(f.value) <> 'string'
              or char_length(f.value #>> '{}') > 1000));
$$;
revoke all on function private.valid_translations(jsonb, text[]) from public;
grant execute on function private.valid_translations(jsonb, text[]) to authenticated, service_role;

alter table public.menu_items
  add column translations jsonb not null default '{}'::jsonb
    check (private.valid_translations(translations, array['name', 'description']));
alter table public.categories
  add column translations jsonb not null default '{}'::jsonb
    check (private.valid_translations(translations, array['name']));
alter table public.modifier_groups
  add column translations jsonb not null default '{}'::jsonb
    check (private.valid_translations(translations, array['name']));
alter table public.modifiers
  add column translations jsonb not null default '{}'::jsonb
    check (private.valid_translations(translations, array['name']));

-- ---------------------------------------------------------------------------
-- Bloqueios
-- ---------------------------------------------------------------------------

alter table public.restaurants
  add column orders_paused boolean not null default false,
  add column orders_paused_reason text check (char_length(orders_paused_reason) <= 120),
  add column orders_paused_at timestamptz;

alter table public.tabs
  add column orders_blocked boolean not null default false,
  add column orders_blocked_reason text check (char_length(orders_blocked_reason) <= 120);

-- Janela de horário: as duas pontas ou nenhuma; pode virar a meia-noite.
alter table public.menu_items
  add column blocked boolean not null default false,
  add column blocked_reason text check (char_length(blocked_reason) <= 120),
  add column available_from time,
  add column available_until time,
  add constraint menu_items_hours check ((available_from is null and available_until is null) or (available_from is not null and available_until is not null and available_from <> available_until));
alter table public.categories
  add column blocked boolean not null default false,
  add column blocked_reason text check (char_length(blocked_reason) <= 120),
  add column available_from time,
  add column available_until time,
  add constraint categories_hours check ((available_from is null and available_until is null) or (available_from is not null and available_until is not null and available_from <> available_until));

-- Agora (São Paulo) está dentro da janela? Sem janela = sempre.
create function private.within_hours(p_from time, p_until time)
returns boolean
language sql stable set search_path = ''
as $$
  select case
    when p_from is null or p_until is null then true
    when p_from < p_until then (now() at time zone 'America/Sao_Paulo')::time >= p_from
                           and (now() at time zone 'America/Sao_Paulo')::time < p_until
    else (now() at time zone 'America/Sao_Paulo')::time >= p_from
      or (now() at time zone 'America/Sao_Paulo')::time < p_until
  end;
$$;
revoke all on function private.within_hours(time, time) from public;
grant execute on function private.within_hours(time, time) to authenticated, service_role;

-- Bloqueio e horário de item e categoria são do módulo order_blocks.
create function private.guard_blocks()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and (new.blocked or new.available_from is not null))
     or (tg_op = 'UPDATE' and (new.blocked is distinct from old.blocked
          or new.available_from is distinct from old.available_from
          or new.available_until is distinct from old.available_until)) then
    if not private.feature_enabled(new.restaurant_id, 'order_blocks') then
      raise exception 'Bloqueios não estão incluídos no seu plano' using errcode = '42501';
    end if;
  end if;
  if not new.blocked then new.blocked_reason := null; end if;
  return new;
end;
$$;
create trigger menu_items_guard_blocks before insert or update on public.menu_items
for each row execute function private.guard_blocks();
create trigger categories_guard_blocks before insert or update on public.categories
for each row execute function private.guard_blocks();

-- Envio do cliente: restaurante pausado ou comanda bloqueada recusam o pedido.
create function private.guard_customer_order()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.restaurants; t public.tabs;
begin
  if coalesce(current_setting('app.actor', true), '') <> 'customer' then return new; end if;
  if not private.feature_enabled(new.restaurant_id, 'order_blocks') then return new; end if;
  select * into r from public.restaurants where id = new.restaurant_id;
  if r.orders_paused then
    raise exception '%', coalesce('Pedidos pausados: ' || nullif(btrim(r.orders_paused_reason), ''), 'Os pedidos estão pausados no momento. Tente de novo em instantes')
      using errcode = '23514';
  end if;
  select * into t from public.tabs where id = new.tab_id;
  if t.orders_blocked then
    raise exception 'Novos pedidos desta mesa estão bloqueados. Chame o garçom' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger orders_guard_customer before insert on public.orders
for each row execute function private.guard_customer_order();

-- Envio do cliente: item ou categoria bloqueados, ou fora do horário.
create function private.guard_customer_item()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare mi public.menu_items; c public.categories;
begin
  if coalesce(current_setting('app.actor', true), '') <> 'customer' or new.menu_item_id is null then return new; end if;
  select * into mi from public.menu_items where id = new.menu_item_id;
  if not private.feature_enabled(mi.restaurant_id, 'order_blocks') then return new; end if;
  select * into c from public.categories where id = mi.category_id;
  if mi.blocked or c.blocked then
    raise exception '% não está disponível agora', mi.name using errcode = '23514';
  end if;
  if not private.within_hours(mi.available_from, mi.available_until) or not private.within_hours(c.available_from, c.available_until) then
    raise exception '% está fora do horário. Revise o carrinho', mi.name using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger order_items_guard_customer before insert on public.order_items
for each row execute function private.guard_customer_item();

-- Pausar pedidos do restaurante.
create function public.set_orders_paused(p_restaurant uuid, p_paused boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 120), '');
begin
  if not private.has_permission(p_restaurant, 'block_orders') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not private.feature_enabled(p_restaurant, 'order_blocks') then raise exception 'Função não incluída no seu plano' using errcode = '42501'; end if;
  update public.restaurants set orders_paused = p_paused,
    orders_paused_reason = case when p_paused then v_reason end,
    orders_paused_at = case when p_paused then now() end
    where id = p_restaurant;
  perform private.audit(p_restaurant, case when p_paused then 'pedidos_pausados' else 'pedidos_retomados' end,
    'restaurant', p_restaurant, null, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('orders_paused', p_paused, 'orders_paused_reason', case when p_paused then v_reason end);
end;
$$;
revoke all on function public.set_orders_paused(uuid, boolean, text) from public, anon;
grant execute on function public.set_orders_paused(uuid, boolean, text) to authenticated;

-- Bloquear uma comanda aberta.
create function public.set_tab_blocked(p_tab uuid, p_blocked boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t public.tabs; v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 120), '');
begin
  select * into t from public.tabs where id = p_tab for update;
  if t.id is null or t.status <> 'open' then raise exception 'Comanda indisponível'; end if;
  if not private.has_permission(t.restaurant_id, 'block_orders') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not private.feature_enabled(t.restaurant_id, 'order_blocks') then raise exception 'Função não incluída no seu plano' using errcode = '42501'; end if;
  update public.tabs set orders_blocked = p_blocked, orders_blocked_reason = case when p_blocked then v_reason end where id = p_tab;
  perform private.audit(t.restaurant_id, case when p_blocked then 'mesa_bloqueada' else 'mesa_desbloqueada' end,
    'tab', t.id, t.id, jsonb_build_object('table_id', t.table_id, 'reason', v_reason));
  return jsonb_build_object('id', t.id, 'orders_blocked', p_blocked);
end;
$$;
revoke all on function public.set_tab_blocked(uuid, boolean, text) from public, anon;
grant execute on function public.set_tab_blocked(uuid, boolean, text) to authenticated;

-- Registro: bloqueio de item entra junto com esgotado, preço e ativo.
create or replace function private.audit_menu_items() returns trigger language plpgsql security definer set search_path = '' as $$
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
  if new.blocked is distinct from old.blocked then
    perform private.audit(new.restaurant_id, case when new.blocked then 'item_bloqueado' else 'item_desbloqueado' end,
      'menu_item', new.id, null, jsonb_build_object('name', new.name, 'reason', new.blocked_reason));
  end if;
  return null;
end $$;

-- Editor do item: traduções, bloqueio e horário.
create or replace function public.save_menu_item(p_restaurant uuid,p_item uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare iid uuid; gid uuid; grp jsonb; modifier jsonb; previous public.menu_items; enable boolean; qty integer; threshold integer; v_station text;
  v_tr jsonb; v_blocked boolean; v_reason text; v_from time; v_until time;
begin
  if not private.can_edit_menu(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.categories where id=(p_data->>'category_id')::uuid and restaurant_id=p_restaurant) then raise exception 'Categoria inválida'; end if;
  enable := coalesce((p_data->>'stock_enabled')::boolean, false);
  qty := nullif(p_data->>'stock_quantity','')::integer;
  threshold := coalesce(nullif(p_data->>'low_stock_threshold','')::integer, 5);
  v_station := nullif(p_data->>'station','');
  v_tr := coalesce(p_data->'translations', '{}'::jsonb);
  v_blocked := coalesce((p_data->>'blocked')::boolean, false);
  v_reason := nullif(btrim(coalesce(p_data->>'blocked_reason','')), '');
  v_from := nullif(p_data->>'available_from','')::time;
  v_until := nullif(p_data->>'available_until','')::time;
  if v_station is not null and v_station not in ('cozinha','bar') then raise exception 'Setor inválido'; end if;
  if enable and (qty is null or qty < 0) then raise exception 'Informe a quantidade em estoque'; end if;
  if (v_from is null) <> (v_until is null) or v_from = v_until then raise exception 'Informe início e fim diferentes para o horário'; end if;
  if p_item is null then
    insert into public.menu_items(restaurant_id,category_id,name,description,price_cents,photo_url,prep_minutes,active,featured,position,stock_enabled,stock_quantity,low_stock_threshold,sold_out,sold_out_auto,station,translations,blocked,blocked_reason,available_from,available_until)
    values(p_restaurant,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',(p_data->>'price_cents')::integer,p_data->>'photo_url',(p_data->>'prep_minutes')::integer,(p_data->>'active')::boolean,(p_data->>'featured')::boolean,coalesce((p_data->>'position')::integer,0),enable,case when enable then qty else null end,threshold,enable and qty = 0,enable and qty = 0,v_station,v_tr,v_blocked,v_reason,v_from,v_until) returning id into iid;
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
      sold_out_auto=enable and qty = 0,
      station=v_station,
      translations=v_tr,blocked=v_blocked,blocked_reason=v_reason,available_from=v_from,available_until=v_until
      where id=p_item returning id into iid;
    if enable and (not previous.stock_enabled or previous.stock_quantity is distinct from qty) then
      perform private.log_stock(iid,'ajuste',qty-coalesce(case when previous.stock_enabled then previous.stock_quantity end,0),qty,case when previous.stock_enabled then 'Ajuste pelo editor do item' else 'Estoque inicial' end);
    end if;
    delete from public.modifier_groups where menu_item_id=iid;
  end if;
  for grp in select value from jsonb_array_elements(p_data->'groups') loop
    insert into public.modifier_groups(menu_item_id,name,required,min_select,max_select,position,translations)
    values(iid,grp->>'name',(grp->>'required')::boolean,(grp->>'min_select')::integer,(grp->>'max_select')::integer,(grp->>'position')::integer,coalesce(grp->'translations','{}'::jsonb)) returning id into gid;
    for modifier in select value from jsonb_array_elements(grp->'modifiers') loop
      insert into public.modifiers(group_id,name,price_cents,position,translations) values(gid,modifier->>'name',(modifier->>'price_cents')::integer,(modifier->>'position')::integer,coalesce(modifier->'translations','{}'::jsonb));
    end loop;
  end loop;
  return iid;
end $$;

-- ---------------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------------

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- Dia de São Paulo: o número de ordem recomeça a cada dia.
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  number integer not null check (number >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  party_size integer not null check (party_size between 1 and 50),
  phone text check (phone ~ '^\+?[0-9]{8,15}$'),
  note text check (char_length(note) <= 120),
  status text not null default 'aguardando' check (status in ('aguardando', 'chamado', 'sentado', 'desistiu')),
  public_token uuid not null unique default gen_random_uuid(),
  table_id uuid references public.tables (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  called_at timestamptz,
  seated_at timestamptz,
  left_at timestamptz,
  unique (restaurant_id, day, number)
);
create index waitlist_entries_active_idx on public.waitlist_entries (restaurant_id, day, status);

-- Garçom, gestor ou revenda, com o módulo no plano.
create function private.can_host(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (private.is_member($1, array['waiter', 'manager']::public.member_role[]) or private.is_reseller_of($1))
    and private.feature_enabled($1, 'waitlist');
$$;
revoke all on function private.can_host(uuid) from public;
grant execute on function private.can_host(uuid) to authenticated, service_role;

alter table public.waitlist_entries enable row level security;
revoke all on public.waitlist_entries from anon, authenticated;
grant select, insert, update on public.waitlist_entries to authenticated;
grant select, insert, update, delete on public.waitlist_entries to service_role;
create policy "waitlist_entries: leitura" on public.waitlist_entries
  for select to authenticated using (private.can_read(restaurant_id));
create policy "waitlist_entries: salão cadastra" on public.waitlist_entries
  for insert to authenticated with check (private.can_host(restaurant_id));
create policy "waitlist_entries: salão edita" on public.waitlist_entries
  for update to authenticated using (private.can_host(restaurant_id)) with check (private.can_host(restaurant_id));

-- Status só anda para frente (chamado pode voltar a aguardando); dados do grupo
-- só mudam enquanto ele espera. Carimba os horários.
create function private.guard_waitlist_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (new.restaurant_id is distinct from old.restaurant_id or new.day is distinct from old.day
     or new.number is distinct from old.number or new.public_token is distinct from old.public_token
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by) then
    raise exception 'Registro da espera não pode ser alterado' using errcode = '42501';
  end if;
  if old.status in ('sentado', 'desistiu') and (to_jsonb(new) is distinct from to_jsonb(old)) then
    raise exception 'Este grupo já saiu da espera' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'aguardando' and new.status in ('chamado', 'sentado', 'desistiu'))
         or (old.status = 'chamado' and new.status in ('aguardando', 'sentado', 'desistiu'))) then
      raise exception 'Mudança de status inválida' using errcode = '23514';
    end if;
    if new.status = 'chamado' then new.called_at := now(); end if;
    if new.status = 'aguardando' then new.called_at := null; end if;
    if new.status = 'sentado' then new.seated_at := now(); end if;
    if new.status = 'desistiu' then new.left_at := now(); end if;
  end if;
  return new;
end;
$$;
create trigger waitlist_entries_guard before update on public.waitlist_entries
for each row execute function private.guard_waitlist_update();

create function private.audit_waitlist() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'espera_adicionada', 'waitlist', new.id, null,
      jsonb_build_object('number', new.number, 'name', new.name, 'party_size', new.party_size));
  elsif new.status is distinct from old.status then
    perform private.audit(new.restaurant_id, 'espera_' || new.status, 'waitlist', new.id, null,
      jsonb_build_object('number', new.number, 'name', new.name, 'table_id', new.table_id));
  end if;
  return null;
end $$;
create trigger waitlist_entries_audit after insert or update on public.waitlist_entries
for each row execute function private.audit_waitlist();

-- Cadastrar: número de ordem do dia sob trava, para dois garçons não pegarem o mesmo.
create function public.add_waitlist_entry(p_restaurant uuid, p_name text, p_party integer, p_phone text default null, p_note text default null)
returns public.waitlist_entries
language plpgsql security invoker set search_path = ''
as $$
declare v_day date := (now() at time zone 'America/Sao_Paulo')::date; next_number integer; created public.waitlist_entries;
begin
  if not private.can_host(p_restaurant) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant::text || v_day::text, 3));
  select coalesce(max(number), 0) + 1 into next_number from public.waitlist_entries where restaurant_id = p_restaurant and day = v_day;
  insert into public.waitlist_entries (restaurant_id, day, number, name, party_size, phone, note, created_by)
    values (p_restaurant, v_day, next_number, regexp_replace(btrim(p_name), '\s+', ' ', 'g'), p_party,
      nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''), nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
    returning * into created;
  return created;
end;
$$;
revoke all on function public.add_waitlist_entry(uuid, text, integer, text, text) from public, anon;
grant execute on function public.add_waitlist_entry(uuid, text, integer, text, text) to authenticated;

-- Sentar: com mesa, abre a comanda dela na mesma transação.
create function public.seat_waitlist_entry(p_entry uuid, p_table uuid default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare e public.waitlist_entries; t public.tables; tab public.tabs;
begin
  select * into e from public.waitlist_entries where id = p_entry for update;
  if e.id is null then raise exception 'Grupo não encontrado'; end if;
  if not private.can_host(e.restaurant_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_table is not null then
    select * into t from public.tables where id = p_table and restaurant_id = e.restaurant_id and active;
    if t.id is null then raise exception 'Mesa indisponível'; end if;
    tab := public.open_table(p_table);
  end if;
  update public.waitlist_entries set status = 'sentado', table_id = p_table where id = p_entry;
  return jsonb_build_object('id', e.id, 'tab_id', tab.id, 'pin', tab.pin);
end;
$$;
revoke all on function public.seat_waitlist_entry(uuid, uuid) from public, anon;
grant execute on function public.seat_waitlist_entry(uuid, uuid) to authenticated;

-- Página pública do cliente (rota do servidor com a chave secreta): posição,
-- status e marca do restaurante. O link vale por 12 horas.
create function public.waitlist_status(p_slug text, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare e public.waitlist_entries; r public.restaurants; ahead integer;
begin
  select w.* into e from public.waitlist_entries w join public.restaurants rr on rr.id = w.restaurant_id
    where w.public_token = p_token and rr.slug = p_slug and rr.status = 'active' and w.created_at > now() - interval '12 hours';
  if e.id is null then return null; end if;
  select * into r from public.restaurants where id = e.restaurant_id;
  select count(*) into ahead from public.waitlist_entries
    where restaurant_id = e.restaurant_id and day = e.day and status in ('aguardando', 'chamado') and number < e.number;
  return jsonb_build_object(
    'number', e.number,
    'name', split_part(e.name, ' ', 1),
    'party_size', e.party_size,
    'status', e.status,
    'ahead', case when e.status in ('aguardando', 'chamado') then ahead else 0 end,
    'created_at', e.created_at,
    'called_at', e.called_at,
    'restaurant', jsonb_build_object('name', r.name, 'logo_url', r.logo_url, 'primary_color', r.primary_color,
      'background_color', r.background_color, 'languages', private.feature_enabled(r.id, 'languages'),
      'brand', (select jsonb_build_object('brand_name', s.brand_name, 'logo_url', s.logo_url, 'primary_color', s.primary_color)
                from public.resellers s where s.id = r.reseller_id)));
end;
$$;
revoke all on function public.waitlist_status(text, uuid) from public, anon, authenticated;
grant execute on function public.waitlist_status(text, uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.waitlist_entries;
  end if;
end $$;
