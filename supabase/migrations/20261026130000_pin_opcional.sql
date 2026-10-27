-- PIN da mesa opcional por restaurante (pedido do usuário em 26/10/2026, para a
-- fase de testes). Ligado por padrão: nada muda para quem já usa. Desligado, o
-- cliente só informa o nome; a mesa continua precisando de comanda aberta pelo
-- garçom, e fechar a comanda continua derrubando as sessões.

alter table public.restaurants add column pin_required boolean not null default true;

create or replace function public.verify_table_pin(p_slug text, p_qr text, p_pin text, p_device text, p_hash text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; needs_pin boolean; tab public.tabs; attempt public.pin_attempts; failures integer; v_name text; gid uuid;
begin
  v_name := nullif(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'), '');
  if char_length(v_name) > 40 then return jsonb_build_object('error','Nome muito longo','status',400); end if;
  select t.restaurant_id, t.id, r.pin_required into rid, tid, needs_pin from public.tables t join public.restaurants r on r.id=t.restaurant_id
    where r.slug=p_slug and r.status='active' and t.qr_token=p_qr and t.active;
  if tid is null then return jsonb_build_object('error','Mesa indisponível','status',404); end if;
  if private.restaurant_blocked(rid) then return jsonb_build_object('error','Cardápio temporariamente indisponível. Fale com o restaurante','status',403); end if;
  -- Sem PIN, o nome é o que identifica a pessoa na divisão da conta.
  if not needs_pin and v_name is null then return jsonb_build_object('error','Informe o nome','status',400); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device || rid::text, 0));
  insert into public.pin_attempts(device_id,restaurant_id) values(p_device,rid) on conflict do nothing;
  select * into attempt from public.pin_attempts where device_id=p_device and restaurant_id=rid for update;
  if needs_pin and attempt.locked_until > now() then return jsonb_build_object('error','Aguarde 5 minutos para tentar novamente','status',429); end if;
  select * into tab from public.tabs where id = public.tab_for_table(tid) and status='open' for update;
  if tab.id is null then return jsonb_build_object('error','Chame o garçom para abrir a mesa','status',409); end if;
  if needs_pin and tab.pin is distinct from p_pin then
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

-- Ligar ou desligar o PIN fica no registro de operações.
create or replace function private.audit_pin_required() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pin_required is distinct from old.pin_required then
    perform private.audit(new.id, case when new.pin_required then 'pin_exigido' else 'pin_dispensado' end,
      'restaurant', new.id, null, '{}'::jsonb);
  end if;
  return new;
end $$;

create trigger restaurants_audit_pin_required
  after update of pin_required on public.restaurants
  for each row execute function private.audit_pin_required();
