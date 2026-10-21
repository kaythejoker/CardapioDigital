-- Fase 2, etapa 8 (spec-fase2.md, seções 2 e 13): planos, assinaturas e suporte.
-- * A revenda cria planos com módulos ligados (bar, estoque, financeiro,
--   relatórios, chamadas, pesquisa, domínio próprio), período de teste e preço.
-- * Cada restaurante tem uma assinatura; a cobrança é registrada à mão pela
--   revenda e estende o vencimento. Teste vencido ou período vencido viram
--   "atrasada"; passados os dias de carência, "suspensa" (cardápio parado,
--   painel só leitura). Tudo calculado na leitura, sem cron.
-- * Restaurantes que já existem recebem o plano "Completo" ativo, sem vencimento.
-- * Contato de suporte da revenda (WhatsApp, e-mail, horário) para o botão Ajuda.

alter table public.resellers
  add column support_whatsapp text check (support_whatsapp ~ '^\+?[0-9]{8,15}$'),
  add column support_email text check (support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column support_hours text check (char_length(support_hours) <= 120);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price_cents integer not null default 0 check (price_cents >= 0),
  billing_period text not null default 'mensal' check (billing_period in ('mensal', 'anual')),
  max_tables integer check (max_tables is null or max_tables >= 1),
  trial_days integer not null default 14 check (trial_days between 0 and 365),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index plans_reseller_idx on public.plans (reseller_id);
create unique index plans_one_default on public.plans (reseller_id) where is_default;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null default 'teste' check (status in ('teste', 'ativa', 'atrasada', 'suspensa', 'cancelada')),
  trial_ends_at timestamptz,
  -- Nulo = sem vencimento (cortesia ou legado).
  current_period_end timestamptz,
  grace_days integer not null default 5 check (grace_days between 0 and 60),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  method text check (method in ('pix', 'boleto', 'transferencia', 'cartao', 'outro')),
  note text check (char_length(note) <= 200),
  registered_by uuid,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index subscription_payments_sub_idx on public.subscription_payments (subscription_id, paid_at desc);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
revoke all on public.plans, public.subscriptions, public.subscription_payments from anon, authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update on public.subscriptions to authenticated;
grant select, insert on public.subscription_payments to authenticated;
grant select, insert, update, delete on public.plans, public.subscriptions, public.subscription_payments to service_role;

-- Planos: a revenda gerencia os seus; a equipe dos restaurantes lê o plano do restaurante.
create policy "plans: revenda e equipe leem" on public.plans
  for select to authenticated using (private.can_read_reseller(reseller_id));
create policy "plans: revenda cria" on public.plans
  for insert to authenticated with check (private.is_reseller_member(reseller_id));
create policy "plans: revenda edita" on public.plans
  for update to authenticated using (private.is_reseller_member(reseller_id)) with check (private.is_reseller_member(reseller_id));
create policy "plans: revenda remove" on public.plans
  for delete to authenticated using (private.is_reseller_member(reseller_id));
-- Assinaturas: só a revenda escreve; a equipe lê a do próprio restaurante.
create policy "subscriptions: leitura" on public.subscriptions
  for select to authenticated using (private.can_read(restaurant_id));
create policy "subscriptions: revenda cria" on public.subscriptions
  for insert to authenticated with check (private.is_reseller_of(restaurant_id));
create policy "subscriptions: revenda edita" on public.subscriptions
  for update to authenticated using (private.is_reseller_of(restaurant_id)) with check (private.is_reseller_of(restaurant_id));
create policy "subscription_payments: revenda lê" on public.subscription_payments
  for select to authenticated using (exists (select 1 from public.subscriptions s where s.id = subscription_id and private.is_reseller_of(s.restaurant_id)));
create policy "subscription_payments: revenda registra" on public.subscription_payments
  for insert to authenticated with check (exists (select 1 from public.subscriptions s where s.id = subscription_id and private.is_reseller_of(s.restaurant_id)));

-- Status efetivo, derivado das datas (sem cron).
create function private.effective_status(s public.subscriptions)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when s.status in ('suspensa', 'cancelada') then s.status
    when s.status = 'teste' and s.trial_ends_at is not null and s.trial_ends_at + make_interval(days => s.grace_days) < now() then 'suspensa'
    when s.status = 'teste' and s.trial_ends_at is not null and s.trial_ends_at < now() then 'atrasada'
    when s.status in ('ativa', 'atrasada') and s.current_period_end is not null and s.current_period_end + make_interval(days => s.grace_days) < now() then 'suspensa'
    when s.status in ('ativa', 'atrasada') and s.current_period_end is not null and s.current_period_end < now() then 'atrasada'
    when s.status = 'atrasada' then 'ativa'
    else s.status
  end;
$$;

-- Acesso do restaurante: status, módulos e se está bloqueado. Restaurante sem
-- assinatura (legado) tem tudo liberado.
create function public.restaurant_access(p_restaurant uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.subscriptions; p public.plans; st text; all_on jsonb := '{"bar":true,"stock":true,"finance":true,"reports":true,"service_calls":true,"surveys":true,"custom_domain":true}'::jsonb;
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
revoke all on function public.restaurant_access(uuid) from public, anon;
grant execute on function public.restaurant_access(uuid) to authenticated, service_role;

create function private.feature_enabled(p_restaurant uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((public.restaurant_access(p_restaurant) -> 'features' ->> p_feature)::boolean, true)
    and not (public.restaurant_access(p_restaurant) ->> 'blocked')::boolean;
$$;
create function private.restaurant_blocked(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (public.restaurant_access(p_restaurant) ->> 'blocked')::boolean;
$$;
revoke all on function private.feature_enabled(uuid, text), private.restaurant_blocked(uuid) from public;
grant execute on function private.feature_enabled(uuid, text), private.restaurant_blocked(uuid) to authenticated, service_role;

-- Restaurantes existentes: plano "Completo" ativo e sem vencimento, para nada mudar.
insert into public.plans (reseller_id, name, price_cents, billing_period, trial_days, features, is_default)
select r.id, 'Completo', 0, 'mensal', 14,
  '{"bar":true,"stock":true,"finance":true,"reports":true,"service_calls":true,"surveys":true,"custom_domain":true}'::jsonb, true
from public.resellers r;
insert into public.subscriptions (restaurant_id, plan_id, status, notes)
select rt.id, p.id, 'ativa', 'Migração da fase 2: plano Completo sem vencimento'
from public.restaurants rt join public.plans p on p.reseller_id = rt.reseller_id and p.is_default;

-- Revenda nova nasce com o plano "Completo" padrão, para ter onde encaixar os restaurantes.
create function private.create_default_plan()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.plans (reseller_id, name, price_cents, billing_period, trial_days, features, is_default)
    values (new.id, 'Completo', 0, 'mensal', 14,
      '{"bar":true,"stock":true,"finance":true,"reports":true,"service_calls":true,"surveys":true,"custom_domain":true}'::jsonb, true);
  return new;
end;
$$;
create trigger resellers_default_plan after insert on public.resellers
for each row execute function private.create_default_plan();

-- Restaurante novo nasce em teste no plano padrão da revenda.
create function private.create_subscription()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p public.plans;
begin
  select * into p from public.plans where reseller_id = new.reseller_id and is_default and active;
  if p.id is not null then
    insert into public.subscriptions (restaurant_id, plan_id, status, trial_ends_at)
      values (new.id, p.id, case when p.trial_days > 0 then 'teste' else 'ativa' end, case when p.trial_days > 0 then now() + make_interval(days => p.trial_days) else null end);
  end if;
  return new;
end;
$$;
create trigger restaurants_subscription after insert on public.restaurants
for each row execute function private.create_subscription();

create function private.touch_subscription() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger subscriptions_touch before update on public.subscriptions
for each row execute function private.touch_subscription();

-- Registrar pagamento da assinatura: estende o vencimento e reativa.
create function public.register_subscription_payment(p_restaurant uuid, p_amount integer, p_period_start date, p_period_end date, p_method text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s public.subscriptions; pid uuid;
begin
  if not private.is_reseller_of(p_restaurant) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into s from public.subscriptions where restaurant_id = p_restaurant for update;
  if s.id is null then raise exception 'Restaurante sem assinatura'; end if;
  if p_period_end <= p_period_start then raise exception 'Período inválido'; end if;
  insert into public.subscription_payments (subscription_id, amount_cents, period_start, period_end, method, note, registered_by)
    values (s.id, p_amount, p_period_start, p_period_end, p_method, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())) returning id into pid;
  update public.subscriptions set status = 'ativa', trial_ends_at = null,
    current_period_end = greatest(coalesce(current_period_end, 'epoch'::timestamptz), (p_period_end::timestamp at time zone 'America/Sao_Paulo') + interval '1 day' - interval '1 second')
    where id = s.id;
  perform private.audit(p_restaurant, 'assinatura_paga', 'subscription', s.id, null,
    jsonb_build_object('amount_cents', p_amount, 'period_start', p_period_start, 'period_end', p_period_end, 'method', p_method));
  return jsonb_build_object('id', pid, 'access', public.restaurant_access(p_restaurant));
end;
$$;
revoke all on function public.register_subscription_payment(uuid, integer, date, date, text, text) from public, anon;
grant execute on function public.register_subscription_payment(uuid, integer, date, date, text, text) to authenticated;

-- Trocar plano, suspender, reativar ou cancelar.
create function public.set_subscription(p_restaurant uuid, p_plan uuid, p_status text, p_period_end date default null, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s public.subscriptions; p public.plans; rid uuid;
begin
  if not private.is_reseller_of(p_restaurant) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select reseller_id into rid from public.restaurants where id = p_restaurant;
  select * into p from public.plans where id = p_plan and reseller_id = rid;
  if p.id is null then raise exception 'Plano inválido'; end if;
  if p_status not in ('teste', 'ativa', 'suspensa', 'cancelada') then raise exception 'Status inválido'; end if;
  select * into s from public.subscriptions where restaurant_id = p_restaurant for update;
  if s.id is null then
    insert into public.subscriptions (restaurant_id, plan_id, status, trial_ends_at, current_period_end, notes)
      values (p_restaurant, p.id, p_status, case when p_status = 'teste' then now() + make_interval(days => p.trial_days) end,
        case when p_period_end is not null then (p_period_end::timestamp at time zone 'America/Sao_Paulo') + interval '1 day' - interval '1 second' end, p_notes);
  else
    update public.subscriptions set plan_id = p.id, status = p_status,
      trial_ends_at = case when p_status = 'teste' then coalesce(trial_ends_at, now() + make_interval(days => p.trial_days)) else null end,
      -- Reativar sem informar vencimento limpa um vencimento já passado (cortesia até o próximo pagamento).
      current_period_end = case when p_period_end is not null then (p_period_end::timestamp at time zone 'America/Sao_Paulo') + interval '1 day' - interval '1 second'
                                when p_status in ('ativa', 'teste') and current_period_end < now() then null
                                else current_period_end end,
      notes = coalesce(p_notes, notes)
      where id = s.id;
  end if;
  perform private.audit(p_restaurant, 'assinatura_alterada', 'subscription', s.id, null,
    jsonb_build_object('plan', p.name, 'status', p_status, 'period_end', p_period_end));
  return public.restaurant_access(p_restaurant);
end;
$$;
revoke all on function public.set_subscription(uuid, uuid, text, date, text) from public, anon;
grant execute on function public.set_subscription(uuid, uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Módulos e bloqueio aplicados no banco
-- ---------------------------------------------------------------------------

-- Pedido e chamada do cliente não passam com o restaurante suspenso.
create or replace function private.session_tab(p_slug text, p_qr text, p_hash text, out o_rid uuid, out o_tab uuid, out o_guest uuid)
language plpgsql stable security definer set search_path = '' as $$
declare tid uuid;
begin
  select t.restaurant_id, t.id into o_rid, tid from public.tables t join public.restaurants r on r.id = t.restaurant_id
    where r.slug = p_slug and r.status = 'active' and t.qr_token = p_qr and t.active;
  if tid is null then return; end if;
  if private.restaurant_blocked(o_rid) then raise exception 'Cardápio temporariamente indisponível. Fale com o restaurante' using errcode = '28000'; end if;
  select s.tab_id, s.guest_id into o_tab, o_guest from public.tab_sessions s
    where s.token_hash = p_hash and s.expires_at > now() and s.tab_id = public.tab_for_table(tid);
end $$;

create or replace function public.create_service_call(p_slug text, p_qr text, p_hash text, p_device text, p_kind text, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; bid uuid; gid uuid; existing public.service_calls; created public.service_calls; v_note text;
begin
  perform set_config('app.actor', 'customer', true);
  select t.restaurant_id, t.id into rid, tid from public.tables t join public.restaurants r on r.id = t.restaurant_id
    where r.slug = p_slug and r.status = 'active' and t.qr_token = p_qr and t.active;
  if tid is null then return jsonb_build_object('error', 'Mesa indisponível', 'status', 404); end if;
  if not private.feature_enabled(rid, 'service_calls') then return jsonb_build_object('error', 'Chamar o garçom não está disponível neste restaurante', 'status', 403); end if;
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

-- PIN com o restaurante suspenso também é recusado.
create or replace function public.verify_table_pin(p_slug text, p_qr text, p_pin text, p_device text, p_hash text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; tab public.tabs; attempt public.pin_attempts; failures integer; v_name text; gid uuid;
begin
  v_name := nullif(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'), '');
  if char_length(v_name) > 40 then return jsonb_build_object('error','Nome muito longo','status',400); end if;
  select t.restaurant_id, t.id into rid, tid from public.tables t join public.restaurants r on r.id=t.restaurant_id
    where r.slug=p_slug and r.status='active' and t.qr_token=p_qr and t.active;
  if tid is null then return jsonb_build_object('error','Mesa indisponível','status',404); end if;
  if private.restaurant_blocked(rid) then return jsonb_build_object('error','Cardápio temporariamente indisponível. Fale com o restaurante','status',403); end if;
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

-- Módulos: estoque, financeiro, relatórios, pesquisa e bar.
create or replace function public.adjust_stock(p_item uuid, p_kind text, p_quantity integer, p_note text default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare item public.menu_items; delta integer;
begin
  select * into item from public.menu_items where id = p_item;
  if item.id is null then raise exception 'Item indisponível'; end if;
  if not private.has_permission(item.restaurant_id, 'manage_stock') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not private.feature_enabled(item.restaurant_id, 'stock') then raise exception 'Função não incluída no seu plano' using errcode = '42501'; end if;
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

create or replace function public.close_day(p_restaurant uuid, p_day date, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare totals jsonb; by_method jsonb; cid uuid;
begin
  if not private.has_permission(p_restaurant, 'view_finance') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not private.feature_enabled(p_restaurant, 'finance') then raise exception 'Função não incluída no seu plano' using errcode = '42501'; end if;
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

create or replace function public.report_summary(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not private.has_permission(p_restaurant, 'view_reports') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not private.feature_enabled(p_restaurant, 'reports') then raise exception 'Função não incluída no seu plano' using errcode = '42501'; end if;
  if p_from < now() - interval '12 months' then raise exception 'Os relatórios cobrem até 12 meses'; end if;
  select jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and o.created_at >= p_from and o.created_at < p_to),
    'items_cents', (select coalesce(sum(o.total_cents), 0) from public.orders o where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and o.created_at >= p_from and o.created_at < p_to),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'orders', n, 'cents', c) order by d), '[]'::jsonb) from (
        select (o.created_at at time zone 'America/Sao_Paulo')::date as d, count(*) as n, sum(o.total_cents) as c from public.orders o
        where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and o.created_at >= p_from and o.created_at < p_to group by 1) x),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', n, 'cents', c) order by h), '[]'::jsonb) from (
        select extract(hour from o.created_at at time zone 'America/Sao_Paulo')::integer as h, count(*) as n, sum(o.total_cents) as c from public.orders o
        where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and o.created_at >= p_from and o.created_at < p_to group by 1) x),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', q, 'cents', c) order by c desc), '[]'::jsonb) from (
        select coalesce(cat.name, 'Sem categoria') as name, sum(i.quantity) as q, sum(i.unit_price_cents * i.quantity) as c
        from public.order_items i join public.orders o on o.id = i.order_id left join public.menu_items mi on mi.id = i.menu_item_id left join public.categories cat on cat.id = mi.category_id
        where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and i.cancelled_at is null and o.created_at >= p_from and o.created_at < p_to group by 1) x),
    'by_item', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', q, 'cents', c) order by q desc), '[]'::jsonb) from (
        select i.name_snapshot as name, sum(i.quantity) as q, sum(i.unit_price_cents * i.quantity) as c
        from public.order_items i join public.orders o on o.id = i.order_id
        where o.restaurant_id = p_restaurant and o.status <> 'cancelado' and i.cancelled_at is null and o.created_at >= p_from and o.created_at < p_to group by 1 order by 2 desc limit 100) x),
    'by_table', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'tabs', n, 'cents', c) order by c desc), '[]'::jsonb) from (
        select tb.label, count(*) as n, sum((public.tab_totals(t.id) ->> 'due_cents')::integer) as c
        from public.tabs t join public.tables tb on tb.id = t.table_id
        where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to group by 1) x),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'opened', op, 'closed', cl)), '[]'::jsonb) from (
        select u, sum(op) as op, sum(cl) as cl from (
          select opened_by as u, 1 as op, 0 as cl from public.tabs where restaurant_id = p_restaurant and status = 'closed' and merged_into is null and closed_at >= p_from and closed_at < p_to and opened_by is not null
          union all
          select closed_by, 0, 1 from public.tabs where restaurant_id = p_restaurant and status = 'closed' and merged_into is null and closed_at >= p_from and closed_at < p_to and closed_by is not null) s group by u) x),
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'cents', c) order by c desc), '[]'::jsonb) from (
        select method, sum(amount_cents) as c from public.payments where restaurant_id = p_restaurant and voided_at is null and created_at >= p_from and created_at < p_to group by 1) x),
    'fee_cents', (select coalesce(sum((public.tab_totals(t.id) ->> 'fee_cents')::integer), 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to),
    'discount_cents', (select coalesce(sum(discount_cents), 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to),
    'tabs_closed', (select count(*) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to),
    'guests', (select count(*) from public.tab_guests g join public.tabs t on t.id = g.tab_id where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to),
    'cancellations', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'quantity', q, 'cents', c) order by c desc), '[]'::jsonb) from (
        select coalesce(i.cancel_reason, 'Sem motivo') as reason, sum(i.quantity) as q, sum(i.unit_price_cents * i.quantity) as c
        from public.order_items i join public.orders o on o.id = i.order_id
        where o.restaurant_id = p_restaurant and i.cancelled_at is not null and i.cancelled_at >= p_from and i.cancelled_at < p_to group by 1) x),
    'cancellations_by_role', (select coalesce(jsonb_object_agg(actor_role, n), '{}'::jsonb) from (
        select actor_role, count(*) as n from public.audit_log where restaurant_id = p_restaurant and action in ('item_cancelado', 'pedido_cancelado') and created_at >= p_from and created_at < p_to group by 1) x),
    'prep_by_station', (select coalesce(jsonb_agg(jsonb_build_object('station', station, 'avg_minutes', m, 'orders', n)), '[]'::jsonb) from (
        select station, round(avg(extract(epoch from (ready_at - started_at)) / 60)::numeric, 1) as m, count(*) as n from public.orders
        where restaurant_id = p_restaurant and started_at is not null and ready_at is not null and created_at >= p_from and created_at < p_to group by 1) x),
    'table_minutes_avg', (select round(avg(extract(epoch from (closed_at - opened_at)) / 60)::numeric, 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to)
  ) into result;
  return result;
end;
$$;

-- Pesquisa desligada no plano: sem convite.
create or replace function public.survey_invite(p_slug text, p_qr text, p_hash text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare inv public.survey_invites; r public.restaurants; g public.tab_guests; t public.tabs; answered boolean;
begin
  select i.* into inv from public.survey_invites i join public.tabs b on b.id = i.tab_id join public.restaurants rr on rr.id = i.restaurant_id
    where i.token_hash = p_hash and i.expires_at > now() and rr.slug = p_slug
      and (b.table_id = (select id from public.tables where qr_token = p_qr and restaurant_id = rr.id)
           or exists (select 1 from public.tab_tables tt join public.tables tb on tb.id = tt.table_id where tt.tab_id = b.id and tb.qr_token = p_qr));
  if inv.token_hash is null then return null; end if;
  select * into r from public.restaurants where id = inv.restaurant_id;
  if not r.survey_enabled or not private.feature_enabled(r.id, 'surveys') then return null; end if;
  select * into g from public.tab_guests where id = inv.guest_id;
  select * into t from public.tabs where id = inv.tab_id;
  answered := inv.used_at is not null or exists (select 1 from public.surveys where guest_id = inv.guest_id);
  return jsonb_build_object('tab_id', inv.tab_id, 'guest_id', inv.guest_id, 'guest_name', g.name, 'closed_at', t.closed_at, 'answered', answered);
end;
$$;

-- Bar desligado no plano: categoria e item não podem ir para o bar.
create function private.guard_station()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.station = 'bar' and (tg_op = 'INSERT' or new.station is distinct from old.station) and not private.feature_enabled(new.restaurant_id, 'bar') then
    raise exception 'O painel do bar não está incluído no seu plano' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger categories_guard_station before insert or update of station on public.categories
for each row execute function private.guard_station();
create trigger menu_items_guard_station before insert or update of station on public.menu_items
for each row execute function private.guard_station();

-- Limite de mesas do plano.
create function private.guard_table_limit()
returns trigger
language plpgsql set search_path = ''
as $$
declare limit_tables integer;
begin
  limit_tables := (public.restaurant_access(new.restaurant_id) ->> 'max_tables')::integer;
  if limit_tables is not null and (select count(*) from public.tables where restaurant_id = new.restaurant_id and active) >= limit_tables then
    raise exception 'Seu plano permite até % mesas', limit_tables using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tables_guard_limit before insert on public.tables
for each row execute function private.guard_table_limit();
