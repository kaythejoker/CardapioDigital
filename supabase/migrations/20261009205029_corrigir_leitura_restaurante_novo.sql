-- INSERT RETURNING evaluates SELECT policy before a stable lookup can see the new row.
-- Ownership is already present in the inserted row, so check it directly.
drop policy "restaurants: leitura" on public.restaurants;
create policy "restaurants: leitura" on public.restaurants for select to authenticated
using (private.is_member(id) or private.is_reseller_member(reseller_id));
