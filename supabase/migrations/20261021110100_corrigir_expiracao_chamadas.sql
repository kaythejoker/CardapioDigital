-- Fase 2, etapa 3, correção: expire_service_calls roda com o auth.uid() de quem
-- abriu o painel e o guard recusava "expirada". O servidor se identifica como
-- sistema (app.actor) e o guard deixa passar.
create or replace function private.guard_service_call_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and coalesce(current_setting('app.actor', true), '') <> 'system' then
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
