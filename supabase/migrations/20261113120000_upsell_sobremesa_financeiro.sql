-- Pedidos dos sócios no piloto Arroba (13/11/2026), ver docs/melhorias-piloto-arroba.md.
-- 1. "Combina com": cada prato sugere até 3 itens do mesmo restaurante.
-- 2. Categorias sugeridas quando o cliente pede a conta (ex.: sobremesas).
-- 3. Fechamento do dia: "vendido" passa a contar só as comandas fechadas no dia.

alter table public.menu_items add column pairs uuid[] not null default '{}';
alter table public.categories add column suggest_at_bill boolean not null default false;

-- Mantém em "Combina com" só itens do mesmo restaurante, sem repetir e sem o
-- próprio prato, na ordem escolhida pelo gestor.
create function private.clean_item_pairs()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select coalesce(array_agg(s.p order by s.ord), '{}') into new.pairs
  from (
    select u.p, min(u.ord) as ord
    from unnest(new.pairs) with ordinality as u(p, ord)
    where u.p <> new.id
      and exists (select 1 from public.menu_items m where m.id = u.p and m.restaurant_id = new.restaurant_id)
    group by u.p
  ) s;
  if cardinality(new.pairs) > 3 then
    raise exception 'Escolha até 3 itens em "Combina com"';
  end if;
  return new;
end;
$$;

create trigger menu_items_clean_pairs
before insert or update of pairs on public.menu_items
for each row execute function private.clean_item_pairs();

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
    -- Só comandas fechadas no dia; pedidos de mesas abertas entram no dia em que a mesa fechar.
    'items_cents', (select coalesce(sum((public.tab_totals(t.id) ->> 'items_cents')::integer), 0) from public.tabs t where t.restaurant_id = p_restaurant and t.status = 'closed' and t.merged_into is null and (t.closed_at at time zone 'America/Sao_Paulo')::date = p_day),
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
