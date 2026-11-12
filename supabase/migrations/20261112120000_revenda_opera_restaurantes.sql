-- A revenda dona do restaurante passa a contar como equipe completa
-- (garçom, cozinha, bar e gestor): abre e fecha mesas, une mesas, muda o
-- status dos pedidos, atende chamadas e registra pagamentos em todos os
-- restaurantes dela, sem precisar de vínculo em restaurant_members.
-- Todas as regras de operação (RLS, RPCs e triggers) passam por is_member,
-- então basta ampliar esta função.
create or replace function private.is_member(rid uuid, roles public.member_role[] default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = $1
      and m.user_id = (select auth.uid())
      and m.active
      and ($2 is null or m.roles && $2)
  ) or private.is_reseller_of($1);
$$;
