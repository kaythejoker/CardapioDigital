-- Fase 2, etapa 1, correção: apagar um restaurante remove a equipe em cascata e o
-- registro de operações não pode apontar para um restaurante que já não existe.
create or replace function private.audit(rid uuid, p_action text, p_entity text, p_entity_id uuid, p_tab uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); actor text;
begin
  if not exists (select 1 from public.restaurants where id = rid) then return; end if;
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

