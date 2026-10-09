-- Cardápio Digital — esquema inicial do MVP (spec: docs/spec.md, "Modelo de dados").
--
-- Princípios:
-- * Toda linha pertence a um restaurante; o isolamento é garantido por RLS.
-- * O cliente (anônimo) nunca acessa o banco direto: as rotas do servidor usam a
--   chave secreta depois de validar a sessão da comanda. Por isso anon não tem
--   nenhuma política, e tab_sessions/pin_attempts não têm política nenhuma.
-- * Chaves estrangeiras compostas (id, restaurant_id) impedem que uma mesa,
--   comanda ou pedido aponte para outro restaurante.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.restaurant_status as enum ('active', 'inactive');
create type public.member_role as enum ('manager', 'waiter', 'kitchen');
create type public.tab_status as enum ('open', 'closed');
create type public.order_status as enum ('recebido', 'em_preparo', 'pronto', 'entregue', 'cancelado');
create type public.kitchen_mode as enum ('fifo', 'complexity', 'balanced');

-- ---------------------------------------------------------------------------
-- Revenda e restaurantes
-- ---------------------------------------------------------------------------

create table public.resellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_name text not null,
  logo_url text,
  primary_color text not null default '#E0552B' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  domain text unique,
  created_at timestamptz not null default now()
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete restrict,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url text,
  cover_url text,
  status public.restaurant_status not null default 'active',
  created_at timestamptz not null default now()
);
create index restaurants_reseller_id_idx on public.restaurants (reseller_id);

create table public.reseller_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, reseller_id)
);
create index reseller_members_reseller_id_idx on public.reseller_members (reseller_id);

create table public.restaurant_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);
create index restaurant_members_restaurant_id_idx on public.restaurant_members (restaurant_id);

-- ---------------------------------------------------------------------------
-- Mesas, comandas e sessões
-- ---------------------------------------------------------------------------

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  -- Código aleatório do QR (/{slug}/m/{qr_token}); não é o número da mesa.
  qr_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, label),
  unique (id, restaurant_id)
);

create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid not null,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  status public.tab_status not null default 'open',
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade,
  unique (id, restaurant_id),
  check ((status = 'closed') = (closed_at is not null))
);
create index tabs_table_id_idx on public.tabs (table_id, restaurant_id);
-- No MVP, no máximo uma comanda aberta por mesa.
create unique index tabs_one_open_per_table on public.tabs (table_id) where status = 'open';
-- PIN único entre as comandas abertas do mesmo restaurante.
create unique index tabs_unique_open_pin on public.tabs (restaurant_id, pin) where status = 'open';

create table public.tab_sessions (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.tabs (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours',
  check (expires_at > created_at)
);
create index tab_sessions_tab_id_idx on public.tab_sessions (tab_id);

create table public.pin_attempts (
  device_id text not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (device_id, restaurant_id)
);
create index pin_attempts_restaurant_id_idx on public.pin_attempts (restaurant_id);

-- ---------------------------------------------------------------------------
-- Cardápio
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index categories_restaurant_id_idx on public.categories (restaurant_id, position);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  photo_url text,
  prep_minutes integer not null default 10 check (prep_minutes between 1 and 240),
  active boolean not null default true,
  sold_out boolean not null default false,
  -- Aparece na seção "Destaques da casa" do cardápio (tela 1).
  featured boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (category_id, restaurant_id) references public.categories (id, restaurant_id) on delete cascade
);
create index menu_items_category_idx on public.menu_items (category_id, restaurant_id);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id, position);

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  name text not null,
  required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  position integer not null default 0,
  check (min_select >= 0 and max_select >= 1 and min_select <= max_select),
  check (not required or min_select >= 1)
);
create index modifier_groups_menu_item_id_idx on public.modifier_groups (menu_item_id, position);

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  position integer not null default 0
);
create index modifiers_group_id_idx on public.modifiers (group_id, position);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  tab_id uuid not null,
  status public.order_status not null default 'recebido',
  -- Maior prep_minutes entre os itens (a cozinha prepara em paralelo).
  prep_minutes integer not null check (prep_minutes >= 1),
  pinned boolean not null default false,
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  foreign key (tab_id, restaurant_id) references public.tabs (id, restaurant_id) on delete cascade
);
create index orders_queue_idx on public.orders (restaurant_id, status, created_at);
create index orders_tab_id_idx on public.orders (tab_id, restaurant_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  name_snapshot text not null,
  -- Preço unitário final no envio: preço do item + adicionais escolhidos.
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 99),
  note text check (char_length(note) <= 200),
  -- [{"group": "Ponto da carne", "name": "Ao ponto", "price_cents": 0}, ...]
  modifiers_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(modifiers_snapshot) = 'array')
);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_menu_item_id_idx on public.order_items (menu_item_id);

create table public.kitchen_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  mode public.kitchen_mode not null default 'balanced',
  weight_wait numeric(5, 2) not null default 1 check (weight_wait >= 0),
  weight_complexity numeric(5, 2) not null default 1 check (weight_complexity >= 0),
  max_wait_minutes integer not null default 20 check (max_wait_minutes between 1 and 240)
);

-- ---------------------------------------------------------------------------
-- Funções de acesso (schema private: fora da API)
-- ---------------------------------------------------------------------------

create function private.is_member(rid uuid, roles public.member_role[] default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = rid
      and m.user_id = (select auth.uid())
      and (roles is null or m.role = any (roles))
  );
$$;

create function private.is_reseller_member(res_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.reseller_members rm
    where rm.reseller_id = res_id and rm.user_id = (select auth.uid())
  );
$$;

create function private.is_reseller_of(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurants r
    join public.reseller_members rm on rm.reseller_id = r.reseller_id
    where r.id = rid and rm.user_id = (select auth.uid())
  );
$$;

-- Leitura: qualquer membro da equipe do restaurante ou o revendedor dono dele.
create function private.can_read(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_member(rid) or private.is_reseller_of(rid);
$$;

-- Gestão (cardápio, mesas, equipe, configurações): gestor ou revendedor.
create function private.can_manage(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_member(rid, array['manager']::public.member_role[]) or private.is_reseller_of(rid);
$$;

-- A equipe de um restaurante precisa ler a marca do revendedor dele.
create function private.can_read_reseller(res_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_reseller_member(res_id) or exists (
    select 1
    from public.restaurants r
    join public.restaurant_members m on m.restaurant_id = r.id
    where r.reseller_id = res_id and m.user_id = (select auth.uid())
  );
$$;

create function private.item_restaurant(item_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select restaurant_id from public.menu_items where id = item_id;
$$;

create function private.group_restaurant(gid uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select mi.restaurant_id
  from public.modifier_groups g
  join public.menu_items mi on mi.id = g.menu_item_id
  where g.id = gid;
$$;

create function private.order_restaurant(oid uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select restaurant_id from public.orders where id = oid;
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers de integridade
-- ---------------------------------------------------------------------------

-- Todo restaurante nasce com a configuração da fila no modo Equilibrado.
create function private.create_kitchen_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.kitchen_settings (restaurant_id) values (new.id);
  return new;
end;
$$;

create trigger restaurants_kitchen_settings
after insert on public.restaurants
for each row execute function private.create_kitchen_settings();

-- Só o revendedor muda status, revenda e endereço (slug) do restaurante.
create function private.guard_restaurant_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_reseller_of(old.id)
     and (new.status is distinct from old.status
          or new.reseller_id is distinct from old.reseller_id
          or new.slug is distinct from old.slug) then
    raise exception 'Apenas o revendedor pode alterar status, revenda ou endereço do restaurante'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger restaurants_guard_update
before update on public.restaurants
for each row execute function private.guard_restaurant_update();

-- Comanda: fechar grava closed_at; comanda fechada não reabre.
create function private.guard_tab_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'open' then
    raise exception 'Comanda fechada não pode ser reaberta' using errcode = '23514';
  end if;
  if new.status = 'closed' and old.status = 'open' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

create trigger tabs_guard_update
before update on public.tabs
for each row execute function private.guard_tab_update();

-- Fechar a comanda invalida na hora as sessões dos celulares.
create function private.revoke_tab_sessions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tab_sessions where tab_id = new.id;
  return null;
end;
$$;

create trigger tabs_revoke_sessions
after update of status on public.tabs
for each row when (new.status = 'closed' and old.status = 'open')
execute function private.revoke_tab_sessions();

-- A cozinha só pode ligar/desligar "esgotado"; o resto do item é do gestor.
create function private.guard_menu_item_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.can_manage(old.restaurant_id)
     and (to_jsonb(new) - 'sold_out') is distinct from (to_jsonb(old) - 'sold_out') then
    raise exception 'A cozinha só pode marcar itens como esgotados' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_items_guard_update
before update on public.menu_items
for each row execute function private.guard_menu_item_update();

-- Pedido: status só avança recebido → em_preparo → pronto → entregue (ou
-- cancelado antes de entregue); cada passo grava seu horário. A equipe só muda
-- status e "fixar no topo"; itens e valores ficam como foram enviados.
create function private.guard_order_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'pinned', 'started_at', 'ready_at', 'delivered_at', 'cancelled_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'pinned', 'started_at', 'ready_at', 'delivered_at', 'cancelled_at']) then
    raise exception 'Só o status e a fixação do pedido podem ser alterados' using errcode = '42501';
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
      when 'cancelado' then new.cancelled_at := now();
      else null;
    end case;
  end if;

  return new;
end;
$$;

create trigger orders_guard_update
before update on public.orders
for each row execute function private.guard_order_update();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.resellers enable row level security;
alter table public.restaurants enable row level security;
alter table public.reseller_members enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.tables enable row level security;
alter table public.tabs enable row level security;
alter table public.tab_sessions enable row level security;
alter table public.pin_attempts enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifiers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.kitchen_settings enable row level security;

-- O cliente anônimo não fala com o banco (nem com tabelas criadas no futuro).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- resellers
create policy "resellers: leitura" on public.resellers
  for select to authenticated using (private.can_read_reseller(id));
create policy "resellers: revendedor edita a marca" on public.resellers
  for update to authenticated
  using (private.is_reseller_member(id)) with check (private.is_reseller_member(id));

-- restaurants
create policy "restaurants: leitura" on public.restaurants
  for select to authenticated using (private.can_read(id));
create policy "restaurants: revendedor cria" on public.restaurants
  for insert to authenticated with check (private.is_reseller_member(reseller_id));
create policy "restaurants: gestor ou revendedor edita" on public.restaurants
  for update to authenticated using (private.can_manage(id)) with check (private.can_manage(id));

-- reseller_members (escrita só pelo servidor)
create policy "reseller_members: leitura" on public.reseller_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_reseller_member(reseller_id));

-- restaurant_members
create policy "restaurant_members: leitura" on public.restaurant_members
  for select to authenticated using (private.can_read(restaurant_id));
create policy "restaurant_members: gestor ou revendedor adiciona" on public.restaurant_members
  for insert to authenticated with check (private.can_manage(restaurant_id));
create policy "restaurant_members: gestor ou revendedor edita" on public.restaurant_members
  for update to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));
create policy "restaurant_members: gestor ou revendedor remove" on public.restaurant_members
  for delete to authenticated using (private.can_manage(restaurant_id));

-- tables
create policy "tables: leitura" on public.tables
  for select to authenticated using (private.can_read(restaurant_id));
create policy "tables: gestão cria" on public.tables
  for insert to authenticated with check (private.can_manage(restaurant_id));
create policy "tables: gestão edita" on public.tables
  for update to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));
create policy "tables: gestão remove" on public.tables
  for delete to authenticated using (private.can_manage(restaurant_id));

-- tabs: garçom e gestor abrem e fecham
create policy "tabs: leitura" on public.tabs
  for select to authenticated using (private.can_read(restaurant_id));
create policy "tabs: garçom ou gestor abre" on public.tabs
  for insert to authenticated
  with check (private.is_member(restaurant_id, array['waiter', 'manager']::public.member_role[]));
create policy "tabs: garçom ou gestor edita" on public.tabs
  for update to authenticated
  using (private.is_member(restaurant_id, array['waiter', 'manager']::public.member_role[]))
  with check (private.is_member(restaurant_id, array['waiter', 'manager']::public.member_role[]));

-- tab_sessions e pin_attempts: sem políticas (só o servidor, com a chave secreta).

-- categories
create policy "categories: leitura" on public.categories
  for select to authenticated using (private.can_read(restaurant_id));
create policy "categories: gestão cria" on public.categories
  for insert to authenticated with check (private.can_manage(restaurant_id));
create policy "categories: gestão edita" on public.categories
  for update to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));
create policy "categories: gestão remove" on public.categories
  for delete to authenticated using (private.can_manage(restaurant_id));

-- menu_items: a cozinha também edita (só "esgotado", ver trigger)
create policy "menu_items: leitura" on public.menu_items
  for select to authenticated using (private.can_read(restaurant_id));
create policy "menu_items: gestão cria" on public.menu_items
  for insert to authenticated with check (private.can_manage(restaurant_id));
create policy "menu_items: gestão e cozinha editam" on public.menu_items
  for update to authenticated
  using (private.can_manage(restaurant_id) or private.is_member(restaurant_id, array['kitchen']::public.member_role[]))
  with check (private.can_manage(restaurant_id) or private.is_member(restaurant_id, array['kitchen']::public.member_role[]));
create policy "menu_items: gestão remove" on public.menu_items
  for delete to authenticated using (private.can_manage(restaurant_id));

-- modifier_groups
create policy "modifier_groups: leitura" on public.modifier_groups
  for select to authenticated using (private.can_read(private.item_restaurant(menu_item_id)));
create policy "modifier_groups: gestão cria" on public.modifier_groups
  for insert to authenticated with check (private.can_manage(private.item_restaurant(menu_item_id)));
create policy "modifier_groups: gestão edita" on public.modifier_groups
  for update to authenticated
  using (private.can_manage(private.item_restaurant(menu_item_id)))
  with check (private.can_manage(private.item_restaurant(menu_item_id)));
create policy "modifier_groups: gestão remove" on public.modifier_groups
  for delete to authenticated using (private.can_manage(private.item_restaurant(menu_item_id)));

-- modifiers
create policy "modifiers: leitura" on public.modifiers
  for select to authenticated using (private.can_read(private.group_restaurant(group_id)));
create policy "modifiers: gestão cria" on public.modifiers
  for insert to authenticated with check (private.can_manage(private.group_restaurant(group_id)));
create policy "modifiers: gestão edita" on public.modifiers
  for update to authenticated
  using (private.can_manage(private.group_restaurant(group_id)))
  with check (private.can_manage(private.group_restaurant(group_id)));
create policy "modifiers: gestão remove" on public.modifiers
  for delete to authenticated using (private.can_manage(private.group_restaurant(group_id)));

-- orders: criados só pelo servidor; a equipe muda status e fixação
create policy "orders: leitura" on public.orders
  for select to authenticated using (private.can_read(restaurant_id));
create policy "orders: equipe atualiza" on public.orders
  for update to authenticated
  using (private.is_member(restaurant_id)) with check (private.is_member(restaurant_id));

-- order_items: só leitura
create policy "order_items: leitura" on public.order_items
  for select to authenticated using (private.can_read(private.order_restaurant(order_id)));

-- kitchen_settings
create policy "kitchen_settings: leitura" on public.kitchen_settings
  for select to authenticated using (private.can_read(restaurant_id));
create policy "kitchen_settings: gestão edita" on public.kitchen_settings
  for update to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));

-- ---------------------------------------------------------------------------
-- Realtime: cozinha e garçom escutam pedidos e comandas (respeitando o RLS)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.tabs;
  end if;
end;
$$;
