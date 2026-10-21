-- Fase 2, etapa 9 (spec-fase2.md, seção 7): domínio próprio.
-- A revenda cadastra um domínio (ex.: cardapio.marca.com.br) que serve
-- /{slug}/m/{qr} de todos os restaurantes dela; um restaurante pode ter o seu
-- (módulo custom_domain) em que a raiz abre o cardápio para consulta e /m/{qr}
-- abre a mesa. O app registra o domínio no projeto público da Vercel e guarda
-- aqui o status da verificação de DNS. A URL antiga continua valendo sempre.

alter table public.resellers
  add column domain_status text not null default 'pending' check (domain_status in ('pending', 'verifying', 'active', 'error')),
  add column domain_checked_at timestamptz,
  add column domain_error text check (char_length(domain_error) <= 300);

alter table public.restaurants
  add column custom_domain text unique check (custom_domain ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  add column custom_domain_status text not null default 'pending' check (custom_domain_status in ('pending', 'verifying', 'active', 'error')),
  add column custom_domain_checked_at timestamptz,
  add column custom_domain_error text check (char_length(custom_domain_error) <= 300);

-- Resolver o host da requisição: só o servidor (chave secreta) consulta.
create function public.resolve_host(p_host text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('kind', 'restaurant', 'slug', r.slug, 'restaurant_id', r.id, 'status', r.status)
       from public.restaurants r where r.custom_domain = lower(p_host) and r.custom_domain_status = 'active' limit 1),
    (select jsonb_build_object('kind', 'reseller', 'reseller_id', s.id)
       from public.resellers s where s.domain = lower(p_host) and s.domain_status = 'active' limit 1)
  );
$$;
revoke all on function public.resolve_host(text) from public, anon, authenticated;
grant execute on function public.resolve_host(text) to service_role;

-- O gestor só mexe no próprio domínio (módulo do plano); status é do servidor.
create or replace function private.guard_restaurant_update()
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
  if (select auth.uid()) is not null and new.custom_domain is distinct from old.custom_domain
     and not private.feature_enabled(old.id, 'custom_domain') and not private.is_reseller_of(old.id) then
    raise exception 'Domínio próprio não está incluído no seu plano' using errcode = '42501';
  end if;
  if new.custom_domain is distinct from old.custom_domain then
    new.custom_domain_status := 'pending';
    new.custom_domain_checked_at := null;
    new.custom_domain_error := null;
  end if;
  return new;
end;
$$;

create function private.guard_reseller_domain()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.domain is distinct from old.domain then
    new.domain_status := 'pending';
    new.domain_checked_at := null;
    new.domain_error := null;
  end if;
  return new;
end;
$$;
create trigger resellers_guard_domain before update on public.resellers
for each row execute function private.guard_reseller_domain();
