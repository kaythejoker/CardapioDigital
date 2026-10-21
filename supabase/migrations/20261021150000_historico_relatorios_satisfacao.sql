-- Fase 2, etapa 7 (spec-fase2.md, seções 8, 11 e 15): histórico de comandas e
-- operações, relatórios por período e pesquisa de satisfação.
-- Tudo calculado no banco por funções com a permissão conferida dentro
-- (view_reports), para o painel não carregar pedidos antigos inteiros.

create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at);
create index if not exists tabs_restaurant_closed_idx on public.tabs (restaurant_id, closed_at) where status = 'closed';

alter table public.restaurants
  add column google_review_url text check (google_review_url ~ '^https://'),
  add column survey_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- Pesquisa de satisfação
-- ---------------------------------------------------------------------------

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  tab_id uuid not null references public.tabs (id) on delete cascade,
  guest_id uuid not null unique references public.tab_guests (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  food_rating integer check (food_rating between 1 and 5),
  service_rating integer check (service_rating between 1 and 5),
  wait_rating integer check (wait_rating between 1 and 5),
  tags text[] not null default '{}',
  comment text check (char_length(comment) <= 300),
  created_at timestamptz not null default now()
);
create index surveys_restaurant_idx on public.surveys (restaurant_id, created_at desc);

-- Fechar a comanda apaga as sessões; o hash de cada uma fica aqui por 24 h
-- só para a pessoa responder a pesquisa (não vale para pedir).
create table public.survey_invites (
  token_hash text primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  tab_id uuid not null references public.tabs (id) on delete cascade,
  guest_id uuid not null references public.tab_guests (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index survey_invites_tab_idx on public.survey_invites (tab_id);

alter table public.surveys enable row level security;
alter table public.survey_invites enable row level security;
revoke all on public.surveys, public.survey_invites from anon, authenticated;
grant select on public.surveys to authenticated;
grant select, insert, update, delete on public.surveys, public.survey_invites to service_role;
create policy "surveys: equipe lê" on public.surveys
  for select to authenticated using (private.can_read(restaurant_id));

create or replace function private.revoke_tab_sessions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.merged_into is null then
    insert into public.survey_invites (token_hash, restaurant_id, tab_id, guest_id, expires_at)
      select s.token_hash, new.restaurant_id, new.id, s.guest_id, now() + interval '24 hours'
      from public.tab_sessions s where s.tab_id = new.id and s.guest_id is not null
      on conflict do nothing;
  end if;
  delete from public.tab_sessions where tab_id = new.id;
  update public.service_calls set status = 'atendida', attended_at = now() where tab_id = new.id and status = 'aberta';
  update public.tab_tables set released_at = now() where tab_id = new.id and released_at is null;
  return null;
end;
$$;

-- Convite válido para este celular (hash do cookie) nesta mesa.
create function public.survey_invite(p_slug text, p_qr text, p_hash text)
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
  if not r.survey_enabled then return null; end if;
  select * into g from public.tab_guests where id = inv.guest_id;
  select * into t from public.tabs where id = inv.tab_id;
  answered := inv.used_at is not null or exists (select 1 from public.surveys where guest_id = inv.guest_id);
  return jsonb_build_object('tab_id', inv.tab_id, 'guest_id', inv.guest_id, 'guest_name', g.name, 'closed_at', t.closed_at, 'answered', answered);
end;
$$;
revoke all on function public.survey_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.survey_invite(text, text, text) to service_role;

create function public.submit_survey(p_slug text, p_qr text, p_hash text, p_rating integer, p_food integer, p_service integer, p_wait integer, p_tags text[], p_comment text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare inv jsonb; r public.restaurants; sid uuid; v_comment text; v_tags text[];
begin
  perform set_config('app.actor', 'customer', true);
  inv := public.survey_invite(p_slug, p_qr, p_hash);
  if inv is null then raise exception 'A avaliação não está mais disponível' using errcode = '28000'; end if;
  if (inv ->> 'answered')::boolean then raise exception 'Você já avaliou esta visita'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Escolha de 1 a 5 estrelas'; end if;
  if (p_food is not null and p_food not between 1 and 5) or (p_service is not null and p_service not between 1 and 5) or (p_wait is not null and p_wait not between 1 and 5) then
    raise exception 'Notas de 1 a 5';
  end if;
  v_comment := nullif(left(btrim(coalesce(p_comment, '')), 300), '');
  select coalesce(array_agg(distinct left(btrim(x), 40)), '{}') into v_tags from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 10;
  if cardinality(v_tags) > 10 then v_tags := v_tags[1:10]; end if;
  select * into r from public.restaurants where id = (select restaurant_id from public.survey_invites where token_hash = p_hash);
  insert into public.surveys (restaurant_id, tab_id, guest_id, rating, food_rating, service_rating, wait_rating, tags, comment)
    values (r.id, (inv ->> 'tab_id')::uuid, (inv ->> 'guest_id')::uuid, p_rating, p_food, p_service, p_wait, v_tags, v_comment) returning id into sid;
  update public.survey_invites set used_at = now() where token_hash = p_hash;
  perform private.audit(r.id, 'avaliacao_enviada', 'survey', sid, (inv ->> 'tab_id')::uuid, jsonb_build_object('rating', p_rating, 'guest_id', inv ->> 'guest_id'));
  return jsonb_build_object('ok', true, 'google_review_url', case when p_rating >= 4 then r.google_review_url else null end);
end;
$$;
revoke all on function public.submit_survey(text, text, text, integer, integer, integer, integer, text[], text) from public, anon, authenticated;
grant execute on function public.submit_survey(text, text, text, integer, integer, integer, integer, text[], text) to service_role;

-- Resumo da satisfação no período: médias, distribuição, taxa de resposta, etiquetas e comentários.
create function public.survey_summary(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not private.has_permission(p_restaurant, 'view_reports') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'responses', count(*),
    'avg_rating', round(avg(rating)::numeric, 2),
    'avg_food', round(avg(food_rating)::numeric, 2),
    'avg_service', round(avg(service_rating)::numeric, 2),
    'avg_wait', round(avg(wait_rating)::numeric, 2),
    'distribution', (select jsonb_object_agg(r, n) from (select rating as r, count(*) as n from public.surveys where restaurant_id = p_restaurant and created_at >= p_from and created_at < p_to group by rating) d),
    'guests', (select count(*) from public.tab_guests g join public.tabs t on t.id = g.tab_id where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and t.closed_at >= p_from and t.closed_at < p_to),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'n', n) order by n desc), '[]'::jsonb) from (select unnest(tags) as tag, count(*) as n from public.surveys where restaurant_id = p_restaurant and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 12) tg),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rating', s.rating, 'comment', s.comment, 'tags', to_jsonb(s.tags), 'created_at', s.created_at, 'guest', g.name, 'tab_id', s.tab_id,
        'table', (select tb.label from public.tabs t join public.tables tb on tb.id = t.table_id where t.id = s.tab_id)) order by s.created_at desc), '[]'::jsonb)
      from public.surveys s join public.tab_guests g on g.id = s.guest_id where s.restaurant_id = p_restaurant and s.created_at >= p_from and s.created_at < p_to)
  ) into result from public.surveys where restaurant_id = p_restaurant and created_at >= p_from and created_at < p_to;
  return result;
end;
$$;
revoke all on function public.survey_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.survey_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Média dos últimos 30 dias, para a lista da revenda.
create function public.restaurant_rating(p_restaurant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'responses', count(*))
  from public.surveys where restaurant_id = p_restaurant and created_at > now() - interval '30 days'
    and (private.can_read(p_restaurant) or private.is_reseller_of(p_restaurant));
$$;
revoke all on function public.restaurant_rating(uuid) from public, anon;
grant execute on function public.restaurant_rating(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Histórico
-- ---------------------------------------------------------------------------

create function private.can_view_history(p_restaurant uuid, p_from timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission(p_restaurant, 'view_reports')
    or (private.is_member(p_restaurant, array['waiter', 'manager']::public.member_role[])
        and p_from >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'));
$$;
revoke all on function private.can_view_history(uuid, timestamptz) from public;
grant execute on function private.can_view_history(uuid, timestamptz) to authenticated, service_role;

-- Comandas fechadas no período (até 12 meses), com totais e mesas.
create function public.tab_history(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_history(p_restaurant, p_from) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_from < now() - interval '12 months' then raise exception 'O histórico mostra até 12 meses'; end if;
  return (select coalesce(jsonb_agg(row order by (row ->> 'closed_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', t.id, 'opened_at', t.opened_at, 'closed_at', t.closed_at, 'opened_by', t.opened_by, 'closed_by', t.closed_by,
      'merged_into', t.merged_into,
      'table', tb.label,
      'tables', (select coalesce(jsonb_agg(x.label order by x.label), '[]'::jsonb) from public.tab_tables tt join public.tables x on x.id = tt.table_id where tt.tab_id = t.id),
      'guests', (select count(*) from public.tab_guests g where g.tab_id = t.id),
      'orders', (select count(*) from public.orders o where o.tab_id = t.id and o.status <> 'cancelado'),
      'cancelled_items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.tab_id = t.id and i.cancelled_at is not null),
      'totals', public.tab_totals(t.id)
    ) as row
    from public.tabs t join public.tables tb on tb.id = t.table_id
    where t.restaurant_id = p_restaurant and t.status = 'closed' and t.closed_at >= p_from and t.closed_at < p_to
  ) h);
end;
$$;
revoke all on function public.tab_history(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.tab_history(uuid, timestamptz, timestamptz) to authenticated;

-- Detalhe de uma comanda (aberta ou fechada): pessoas, pedidos, itens, pagamentos, chamadas, mesas e registro.
create function public.tab_detail(p_tab uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare t public.tabs;
begin
  select * into t from public.tabs where id = p_tab;
  if t.id is null then return null; end if;
  if not private.can_view_history(t.restaurant_id, coalesce(t.closed_at, now())) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'tab', jsonb_build_object('id', t.id, 'status', t.status, 'opened_at', t.opened_at, 'closed_at', t.closed_at, 'opened_by', t.opened_by, 'closed_by', t.closed_by, 'merged_into', t.merged_into,
      'table', (select label from public.tables where id = t.table_id),
      'tables', (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'added_at', tt.added_at, 'released_at', tt.released_at)), '[]'::jsonb) from public.tab_tables tt join public.tables x on x.id = tt.table_id where tt.tab_id = t.id),
      'totals', public.tab_totals(t.id)),
    'guests', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at, 'paid_cents', g.paid_cents) order by g.created_at), '[]'::jsonb) from public.tab_guests g where g.tab_id = t.id),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'station', o.station, 'batch_id', o.batch_id, 'guest_id', o.guest_id, 'total_cents', o.total_cents, 'created_at', o.created_at,
        'started_at', o.started_at, 'ready_at', o.ready_at, 'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason, 'cancelled_by', o.cancelled_by,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_snapshot, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'note', i.note, 'shared', i.shared,
            'modifiers', i.modifiers_snapshot, 'cancelled_at', i.cancelled_at, 'cancel_reason', i.cancel_reason, 'cancelled_by', i.cancelled_by) order by i.id), '[]'::jsonb) from public.order_items i where i.order_id = o.id)
      ) order by o.created_at), '[]'::jsonb) from public.orders o where o.tab_id = t.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'guest_id', p.guest_id, 'method', p.method, 'amount_cents', p.amount_cents, 'received_by', p.received_by, 'created_at', p.created_at, 'voided_at', p.voided_at, 'void_reason', p.void_reason) order by p.created_at), '[]'::jsonb) from public.payments p where p.tab_id = t.id),
    'calls', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'note', c.note, 'status', c.status, 'created_at', c.created_at, 'attended_at', c.attended_at, 'attended_by', c.attended_by) order by c.created_at), '[]'::jsonb) from public.service_calls c where c.tab_id = t.id),
    'surveys', (select coalesce(jsonb_agg(jsonb_build_object('rating', s.rating, 'comment', s.comment, 'guest_id', s.guest_id, 'created_at', s.created_at)), '[]'::jsonb) from public.surveys s where s.tab_id = t.id),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'actor_id', a.actor_id, 'actor_role', a.actor_role, 'entity', a.entity, 'entity_id', a.entity_id, 'data', a.data, 'created_at', a.created_at) order by a.created_at), '[]'::jsonb) from public.audit_log a where a.tab_id = t.id)
  );
end;
$$;
revoke all on function public.tab_detail(uuid) from public, anon;
grant execute on function public.tab_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Relatórios
-- ---------------------------------------------------------------------------

create function public.report_summary(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not private.has_permission(p_restaurant, 'view_reports') then raise exception 'Acesso negado' using errcode = '42501'; end if;
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
revoke all on function public.report_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Linha do tempo das operações no período, para a aba "Operações" do histórico.
create function public.audit_history(p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_action text default null, p_actor uuid default null, p_limit integer default 500)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_permission(p_restaurant, 'view_reports') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'actor_id', a.actor_id, 'actor_role', a.actor_role, 'entity', a.entity, 'entity_id', a.entity_id, 'tab_id', a.tab_id, 'data', a.data, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
    from (select * from public.audit_log a where a.restaurant_id = p_restaurant and a.created_at >= p_from and a.created_at < p_to
            and (p_action is null or a.action = p_action) and (p_actor is null or a.actor_id = p_actor)
          order by a.created_at desc limit least(coalesce(p_limit, 500), 2000)) a);
end;
$$;
revoke all on function public.audit_history(uuid, timestamptz, timestamptz, text, uuid, integer) from public, anon;
grant execute on function public.audit_history(uuid, timestamptz, timestamptz, text, uuid, integer) to authenticated;
