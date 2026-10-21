-- Fase 2, etapa 3 (spec-fase2.md, seção 12): o cliente chama o garçom ou pede
-- a conta pelo celular; o garçom atende. Uma chamada aberta por mesa e tipo;
-- sem atendimento em 30 minutos ela expira. Mesa livre só pode chamar para
-- abrir a mesa, uma vez a cada 2 minutos por aparelho.

create table public.service_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid not null,
  tab_id uuid references public.tabs (id) on delete set null,
  guest_id uuid references public.tab_guests (id) on delete set null,
  -- Identifica o celular (hash de cookie + IP), para limitar chamadas sem PIN.
  device_id text,
  kind text not null check (kind in ('garcom', 'conta', 'ajuda')),
  note text check (char_length(note) <= 80),
  status text not null default 'aberta' check (status in ('aberta', 'atendida', 'expirada', 'cancelada')),
  created_at timestamptz not null default now(),
  attended_by uuid,
  attended_at timestamptz,
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade
);
create index service_calls_open_idx on public.service_calls (restaurant_id, created_at) where status = 'aberta';
create index service_calls_table_idx on public.service_calls (table_id, created_at desc);
create unique index service_calls_one_open_per_kind on public.service_calls (table_id, kind) where status = 'aberta';

alter table public.service_calls enable row level security;
revoke all on public.service_calls from anon, authenticated;
grant select, update on public.service_calls to authenticated;
grant select, insert, update on public.service_calls to service_role;
create policy "service_calls: equipe lê" on public.service_calls
  for select to authenticated using (private.can_read(restaurant_id));
create policy "service_calls: garçom ou gestor atende" on public.service_calls
  for update to authenticated
  using (private.is_member(restaurant_id, array['waiter', 'manager']::public.member_role[]))
  with check (private.is_member(restaurant_id, array['waiter', 'manager']::public.member_role[]));

-- A equipe só marca como atendida; o resto é do servidor.
create function private.guard_service_call_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
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
create trigger service_calls_guard_update before update on public.service_calls
for each row execute function private.guard_service_call_update();

create function private.audit_service_calls() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'chamada_criada', 'service_call', new.id, new.tab_id,
      jsonb_build_object('table_id', new.table_id, 'kind', new.kind, 'note', new.note));
  elsif new.status is distinct from old.status then
    perform private.audit(new.restaurant_id, 'chamada_' || new.status, 'service_call', new.id, new.tab_id,
      jsonb_build_object('table_id', new.table_id, 'kind', new.kind,
        'seconds', extract(epoch from (coalesce(new.attended_at, now()) - new.created_at))::integer));
  end if;
  return null;
end $$;
create trigger service_calls_audit after insert or update on public.service_calls
for each row execute function private.audit_service_calls();

-- Cliente chama. Sem sessão só vale "garcom" (abrir a mesa), com limite por aparelho.
create function public.create_service_call(p_slug text, p_qr text, p_hash text, p_device text, p_kind text, p_note text default null)
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
    select s.tab_id, s.guest_id into bid, gid from public.tab_sessions s join public.tabs b on b.id = s.tab_id
      where s.token_hash = p_hash and s.expires_at > now() and b.table_id = tid and b.status = 'open';
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
revoke all on function public.create_service_call(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_service_call(text, text, text, text, text, text) to service_role;

-- Cliente cancela a própria chamada (mesmo aparelho ou mesma comanda).
create function public.cancel_service_call(p_slug text, p_qr text, p_hash text, p_device text, p_call uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare tid uuid; bid uuid;
begin
  perform set_config('app.actor', 'customer', true);
  select t.id into tid from public.tables t join public.restaurants r on r.id = t.restaurant_id
    where r.slug = p_slug and t.qr_token = p_qr;
  if tid is null then return false; end if;
  if p_hash is not null then
    select s.tab_id into bid from public.tab_sessions s where s.token_hash = p_hash and s.expires_at > now();
  end if;
  update public.service_calls set status = 'cancelada'
    where id = p_call and table_id = tid and status = 'aberta'
      and (device_id = p_device or (bid is not null and tab_id = bid));
  return found;
end $$;
revoke all on function public.cancel_service_call(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_service_call(text, text, text, text, uuid) to service_role;

-- Chamadas sem atendimento em 30 minutos expiram; a equipe chama ao carregar o painel.
create function public.expire_service_calls(p_restaurant uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.is_member(p_restaurant) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  perform set_config('app.actor', 'system', true);
  update public.service_calls set status = 'expirada'
    where restaurant_id = p_restaurant and status = 'aberta' and created_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_service_calls(uuid) from public, anon;
grant execute on function public.expire_service_calls(uuid) to authenticated;

-- Fechar a comanda encerra as chamadas abertas da mesa.
create or replace function private.revoke_tab_sessions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tab_sessions where tab_id = new.id;
  update public.service_calls set status = 'atendida', attended_at = now() where tab_id = new.id and status = 'aberta';
  return null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.service_calls;
  end if;
end;
$$;
