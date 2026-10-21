-- Fase 2, etapa 6 (spec-fase2.md, seção 6): controle financeiro.
-- * payments: cada pagamento registrado pelo garçom (por pessoa ou pela mesa),
--   com forma e valor; estorno marca voided_at em vez de apagar.
--   tab_guests.paid_cents passa a ser mantido pelos pagamentos da pessoa.
-- * Taxa de serviço por restaurante (copiada para a comanda ao abrir; o garçom
--   pode retirar quando é opcional) e desconto com motivo e permissão.
-- * Fechar a comanda exige total pago >= total devido.
-- * cash_closures: fechamento do dia pelo gestor.

alter table public.restaurants
  add column service_fee_percent numeric(5, 2) not null default 0 check (service_fee_percent between 0 and 20),
  add column service_fee_optional boolean not null default true;

alter table public.tabs
  add column service_fee_percent numeric(5, 2) not null default 0 check (service_fee_percent between 0 and 20),
  add column service_fee_waived boolean not null default false,
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  add column discount_reason text check (char_length(discount_reason) <= 200),
  add column closed_by uuid;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  tab_id uuid not null,
  -- Nulo = pagamento da mesa toda.
  guest_id uuid,
  method text not null check (method in ('pix', 'dinheiro', 'debito', 'credito', 'outro')),
  amount_cents integer not null check (amount_cents > 0),
  received_by uuid,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (char_length(void_reason) <= 200),
  foreign key (tab_id, restaurant_id) references public.tabs (id, restaurant_id) on delete cascade,
  foreign key (guest_id, tab_id) references public.tab_guests (id, tab_id) deferrable initially immediate
);
create index payments_tab_idx on public.payments (tab_id) where voided_at is null;
create index payments_restaurant_day_idx on public.payments (restaurant_id, created_at);

create table public.cash_closures (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid,
  totals jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object'),
  note text check (char_length(note) <= 500),
  unique (restaurant_id, day)
);

alter table public.payments enable row level security;
alter table public.cash_closures enable row level security;
revoke all on public.payments, public.cash_closures from anon, authenticated;
grant select on public.payments, public.cash_closures to authenticated;
grant select, insert, update on public.payments, public.cash_closures to service_role;
-- Só o servidor (testes e manutenção) apaga um fechamento de dia.
grant delete on public.cash_closures to service_role;
create policy "payments: equipe lê" on public.payments
  for select to authenticated using (private.can_read(restaurant_id));
create policy "cash_closures: equipe lê" on public.cash_closures
  for select to authenticated using (private.can_read(restaurant_id));

-- Totais da comanda: itens ativos + taxa (se não retirada) - desconto; pago e saldo.
create function public.tab_totals(p_tab uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare t public.tabs; items integer; fee integer; paid integer; due integer;
begin
  select * into t from public.tabs where id = p_tab;
  if t.id is null then return null; end if;
  if (select auth.uid()) is not null and not private.can_read(t.restaurant_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(sum(total_cents), 0) into items from public.orders where tab_id = p_tab and status <> 'cancelado';
  fee := case when t.service_fee_waived then 0 else round(items * t.service_fee_percent / 100)::integer end;
  select coalesce(sum(amount_cents), 0) into paid from public.payments where tab_id = p_tab and voided_at is null;
  due := greatest(0, items + fee - t.discount_cents);
  return jsonb_build_object('items_cents', items, 'fee_cents', fee, 'fee_percent', t.service_fee_percent, 'fee_waived', t.service_fee_waived,
    'discount_cents', t.discount_cents, 'discount_reason', t.discount_reason, 'due_cents', due, 'paid_cents', paid, 'balance_cents', due - paid);
end;
$$;
revoke all on function public.tab_totals(uuid) from public, anon;
grant execute on function public.tab_totals(uuid) to authenticated, service_role;

-- paid_cents da pessoa = soma dos pagamentos ativos dela.
create function private.sync_guest_paid()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare gid uuid := coalesce(new.guest_id, old.guest_id); total integer; last_at timestamptz;
begin
  if gid is null then return null; end if;
  select sum(amount_cents), max(created_at) into total, last_at from public.payments where guest_id = gid and voided_at is null;
  perform set_config('app.payment', '1', true);
  update public.tab_guests set paid_cents = total, paid_at = case when total is null then null else last_at end where id = gid;
  perform set_config('app.payment', '', true);
  return null;
end;
$$;
create trigger payments_sync_guest after insert or update of voided_at on public.payments
for each row execute function private.sync_guest_paid();

-- O pagamento da pessoa só muda pelos pagamentos registrados.
create or replace function private.guard_tab_guest_update() returns trigger language plpgsql set search_path='' as $$
begin
  if coalesce(current_setting('app.merge', true), '') = '1' then return new; end if;
  if (to_jsonb(new) - array['paid_cents','paid_at']) is distinct from (to_jsonb(old) - array['paid_cents','paid_at']) then
    raise exception 'Só o pagamento da pessoa pode ser alterado' using errcode='42501';
  end if;
  if new.paid_cents is distinct from old.paid_cents and coalesce(current_setting('app.payment', true), '') <> '1' then
    raise exception 'Registre o pagamento com forma e valor' using errcode='42501';
  end if;
  return new;
end $$;

create function private.audit_payments() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'pagamento_registrado', 'payment', new.id, new.tab_id,
      jsonb_build_object('method', new.method, 'amount_cents', new.amount_cents, 'guest_id', new.guest_id));
  elsif new.voided_at is not null and old.voided_at is null then
    perform private.audit(new.restaurant_id, 'pagamento_estornado', 'payment', new.id, new.tab_id,
      jsonb_build_object('method', new.method, 'amount_cents', new.amount_cents, 'guest_id', new.guest_id, 'reason', new.void_reason));
  end if;
  return null;
end $$;
create trigger payments_audit after insert or update on public.payments
for each row execute function private.audit_payments();

-- Registrar pagamento (pessoa ou mesa), com forma e valor.
create function public.register_payment(p_tab uuid, p_guest uuid, p_method text, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t public.tabs; pid uuid;
begin
  select * into t from public.tabs where id = p_tab for update;
  if t.id is null or t.status <> 'open' then raise exception 'A comanda não está aberta'; end if;
  if not private.has_permission(t.restaurant_id, 'register_payment') then raise exception 'Você não tem permissão para registrar pagamentos' using errcode = '42501'; end if;
  if p_method not in ('pix', 'dinheiro', 'debito', 'credito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'Informe o valor recebido'; end if;
  if p_guest is not null and not exists (select 1 from public.tab_guests where id = p_guest and tab_id = p_tab) then raise exception 'Pessoa não está nesta comanda'; end if;
  insert into public.payments (restaurant_id, tab_id, guest_id, method, amount_cents, received_by)
    values (t.restaurant_id, p_tab, p_guest, p_method, p_amount, (select auth.uid())) returning id into pid;
  return jsonb_build_object('id', pid, 'totals', public.tab_totals(p_tab));
end;
$$;
revoke all on function public.register_payment(uuid, uuid, text, integer) from public, anon;
grant execute on function public.register_payment(uuid, uuid, text, integer) to authenticated;

-- Estorno: comanda aberta; depois do dia fechado só o gestor.
create function public.void_payment(p_payment uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare p public.payments; t public.tabs;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then raise exception 'Pagamento não encontrado'; end if;
  if p.voided_at is not null then return true; end if;
  if not private.has_permission(p.restaurant_id, 'register_payment') then raise exception 'Você não tem permissão para estornar pagamentos' using errcode = '42501'; end if;
  select * into t from public.tabs where id = p.tab_id;
  if exists (select 1 from public.cash_closures c where c.restaurant_id = p.restaurant_id and c.day = (p.created_at at time zone 'America/Sao_Paulo')::date)
     and not private.is_member(p.restaurant_id, array['manager']::public.member_role[]) and not private.is_reseller_of(p.restaurant_id) then
    raise exception 'O dia já foi fechado; só o gestor estorna' using errcode = '42501';
  end if;
  if t.status <> 'open' and not private.is_member(p.restaurant_id, array['manager']::public.member_role[]) and not private.is_reseller_of(p.restaurant_id) then
    raise exception 'A comanda já foi fechada; só o gestor estorna' using errcode = '42501';
  end if;
  update public.payments set voided_at = now(), voided_by = (select auth.uid()), void_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_payment;
  return true;
end;
$$;
revoke all on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated;

-- Desconto com permissão e motivo obrigatório.
create function public.apply_discount(p_tab uuid, p_cents integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t public.tabs; items integer;
begin
  select * into t from public.tabs where id = p_tab for update;
  if t.id is null or t.status <> 'open' then raise exception 'A comanda não está aberta'; end if;
  if not private.has_permission(t.restaurant_id, 'apply_discount') then raise exception 'Você não tem permissão para aplicar desconto' using errcode = '42501'; end if;
  if p_cents is null or p_cents < 0 then raise exception 'Desconto inválido'; end if;
  if p_cents > 0 and char_length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Informe o motivo do desconto'; end if;
  select coalesce(sum(total_cents), 0) into items from public.orders where tab_id = p_tab and status <> 'cancelado';
  if p_cents > items then raise exception 'O desconto não pode passar do valor dos itens'; end if;
  perform set_config('app.finance', '1', true);
  update public.tabs set discount_cents = p_cents, discount_reason = case when p_cents > 0 then btrim(p_reason) else null end where id = p_tab;
  perform set_config('app.finance', '', true);
  perform private.audit(t.restaurant_id, case when p_cents > 0 then 'desconto_aplicado' else 'desconto_removido' end, 'tab', p_tab, p_tab,
    jsonb_build_object('discount_cents', p_cents, 'reason', p_reason));
  return public.tab_totals(p_tab);
end;
$$;
revoke all on function public.apply_discount(uuid, integer, text) from public, anon;
grant execute on function public.apply_discount(uuid, integer, text) to authenticated;

-- Retirar ou aplicar a taxa de serviço (quando o restaurante a define como opcional).
create function public.set_service_fee(p_tab uuid, p_waived boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t public.tabs; r public.restaurants;
begin
  select * into t from public.tabs where id = p_tab for update;
  if t.id is null or t.status <> 'open' then raise exception 'A comanda não está aberta'; end if;
  if not private.is_member(t.restaurant_id, array['waiter', 'manager']::public.member_role[]) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if p_waived and not r.service_fee_optional and not private.has_permission(t.restaurant_id, 'apply_discount') then
    raise exception 'A taxa de serviço não é opcional neste restaurante' using errcode = '42501';
  end if;
  perform set_config('app.finance', '1', true);
  update public.tabs set service_fee_waived = p_waived where id = p_tab;
  perform set_config('app.finance', '', true);
  perform private.audit(t.restaurant_id, case when p_waived then 'taxa_retirada' else 'taxa_aplicada' end, 'tab', p_tab, p_tab,
    jsonb_build_object('percent', t.service_fee_percent));
  return public.tab_totals(p_tab);
end;
$$;
revoke all on function public.set_service_fee(uuid, boolean) from public, anon;
grant execute on function public.set_service_fee(uuid, boolean) to authenticated;

-- Fechar a comanda: só com o saldo quitado (equipe); registra quem fechou.
-- Campos financeiros só mudam pelas RPCs.
create or replace function private.guard_tab_update()
returns trigger
language plpgsql set search_path = ''
as $$
declare totals jsonb;
begin
  if old.status = 'closed' and new.status = 'open' then
    raise exception 'Comanda fechada não pode ser reaberta' using errcode = '23514';
  end if;
  if (select auth.uid()) is not null and coalesce(current_setting('app.finance', true), '') <> '1'
     and (new.service_fee_percent is distinct from old.service_fee_percent or new.service_fee_waived is distinct from old.service_fee_waived
          or new.discount_cents is distinct from old.discount_cents or new.discount_reason is distinct from old.discount_reason) then
    raise exception 'Taxa e desconto são alterados pelas ações da comanda' using errcode = '42501';
  end if;
  if new.status = 'closed' and old.status = 'open' then
    if (select auth.uid()) is not null then
      if not private.has_permission(old.restaurant_id, 'close_tab') then
        raise exception 'Você não tem permissão para fechar comandas' using errcode = '42501';
      end if;
      totals := public.tab_totals(old.id);
      if (totals ->> 'balance_cents')::integer > 0 and coalesce(current_setting('app.merge', true), '') <> '1' then
        raise exception 'Faltam R$ % para fechar a comanda', replace(to_char((totals ->> 'balance_cents')::numeric / 100, 'FM999999990.00'), '.', ',') using errcode = '23514';
      end if;
      new.closed_by := coalesce(new.closed_by, (select auth.uid()));
    end if;
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

-- Abrir a mesa copia a taxa de serviço do restaurante.
create or replace function public.open_table(p_table uuid)
returns public.tabs language plpgsql security invoker set search_path='' as $$
declare t public.tables; result public.tabs; candidate text; pct numeric(5,2);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_table::text, 1));
  select * into t from public.tables where id=p_table and active;
  if t.id is null then raise exception 'Mesa indisponível'; end if;
  if not private.is_member(t.restaurant_id,array['waiter','manager']::public.member_role[]) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if public.tab_for_table(t.id) is not null then raise exception 'A mesa já está aberta'; end if;
  select service_fee_percent into pct from public.restaurants where id = t.restaurant_id;
  for i in 1..100 loop
    candidate:=lpad(floor(random()*10000)::integer::text,4,'0');
    begin
      insert into public.tabs(restaurant_id,table_id,pin,opened_by,service_fee_percent) values(t.restaurant_id,t.id,candidate,auth.uid(),coalesce(pct,0)) returning * into result;
      return result;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Não foi possível gerar um código. Tente novamente';
end $$;

-- Unir comandas também move os pagamentos.
create or replace function public.merge_table(p_tab uuid, p_table uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target public.tabs; t public.tables; other public.tabs; g record; new_name text; moved_orders integer := 0; moved_guests integer := 0; tt record;
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
  set constraints public.orders_guest_fkey, public.payments_guest_id_tab_id_fkey deferred;
  select * into other from public.tabs where table_id = t.id and status = 'open' for update;
  if other.id is not null then
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
    update public.payments set tab_id = target.id where tab_id = other.id;
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

-- Fechamento do dia (fuso de São Paulo). Comandas abertas não impedem; ficam como pendência.
create function public.close_day(p_restaurant uuid, p_day date, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare totals jsonb; by_method jsonb; cid uuid;
begin
  if not private.has_permission(p_restaurant, 'view_finance') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_day > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Esse dia ainda não terminou'; end if;
  if exists (select 1 from public.cash_closures where restaurant_id = p_restaurant and day = p_day) then raise exception 'Esse dia já foi fechado'; end if;
  select coalesce(jsonb_object_agg(method, cents), '{}'::jsonb) into by_method from (
    select method, sum(amount_cents)::integer as cents from public.payments
    where restaurant_id = p_restaurant and voided_at is null and (created_at at time zone 'America/Sao_Paulo')::date = p_day group by method) m;
  select jsonb_build_object(
    'tabs_closed', (select count(*) from public.tabs where restaurant_id = p_restaurant and status = 'closed' and merged_into is null and (closed_at at time zone 'America/Sao_Paulo')::date = p_day),
    'items_cents', (select coalesce(sum(o.total_cents), 0) from public.orders o where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and (o.created_at at time zone 'America/Sao_Paulo')::date = p_day),
    'cancelled_cents', (select coalesce(sum(i.unit_price_cents * i.quantity), 0) from public.order_items i join public.orders o on o.id = i.order_id
        where o.restaurant_id = p_restaurant and i.cancelled_at is not null and (i.cancelled_at at time zone 'America/Sao_Paulo')::date = p_day),
    'fee_cents', (select coalesce(sum((public.tab_totals(t.id) ->> 'fee_cents')::integer), 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and (t.closed_at at time zone 'America/Sao_Paulo')::date = p_day),
    'discount_cents', (select coalesce(sum(discount_cents), 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and (t.closed_at at time zone 'America/Sao_Paulo')::date = p_day),
    'payments_cents', (select coalesce(sum(amount_cents), 0) from public.payments where restaurant_id = p_restaurant and voided_at is null and (created_at at time zone 'America/Sao_Paulo')::date = p_day),
    'by_method', by_method,
    'open_tabs', (select count(*) from public.tabs where restaurant_id = p_restaurant and status = 'open')
  ) into totals;
  insert into public.cash_closures (restaurant_id, day, closed_by, totals, note) values (p_restaurant, p_day, (select auth.uid()), totals, nullif(btrim(coalesce(p_note, '')), '')) returning id into cid;
  perform private.audit(p_restaurant, 'dia_fechado', 'cash_closure', cid, null, totals || jsonb_build_object('day', p_day));
  return jsonb_build_object('id', cid, 'totals', totals);
end;
$$;
revoke all on function public.close_day(uuid, date, text) from public, anon;
grant execute on function public.close_day(uuid, date, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payments;
  end if;
end;
$$;
