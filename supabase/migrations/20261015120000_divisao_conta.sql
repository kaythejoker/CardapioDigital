-- Divisão da conta: cada pessoa entra na comanda com o próprio nome e os pedidos
-- ficam no nome de quem pediu. Itens marcados como "da mesa" são divididos
-- igualmente entre quem já estava na comanda quando o pedido foi enviado (cálculo
-- em lib/split.ts). O garçom registra quanto cada pessoa já pagou.
--
-- Compatível com a versão anterior do app: o nome é opcional no banco; a API é
-- quem exige o nome antes de aceitar pedidos.

create table public.tab_guests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  tab_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- Valor registrado pelo garçom ao marcar "pago"; null = ainda não pagou.
  paid_cents integer check (paid_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tab_guests_tab_fkey foreign key (tab_id, restaurant_id)
    references public.tabs (id, restaurant_id) on delete cascade,
  unique (id, tab_id),
  check ((paid_cents is null) = (paid_at is null))
);
-- Mesmo nome na mesma comanda = mesma pessoa (ex.: entrou de novo por outro celular).
create unique index tab_guests_unique_name on public.tab_guests (tab_id, (lower(btrim(name))));
create index tab_guests_restaurant_idx on public.tab_guests (restaurant_id);

alter table public.tab_sessions add column guest_id uuid,
  add constraint tab_sessions_guest_fkey foreign key (guest_id, tab_id)
    references public.tab_guests (id, tab_id) on delete cascade;
create index tab_sessions_guest_idx on public.tab_sessions (guest_id) where guest_id is not null;

-- Pedidos antigos ficam sem pessoa (guest_id null).
alter table public.orders add column guest_id uuid,
  add constraint orders_guest_fkey foreign key (guest_id, tab_id)
    references public.tab_guests (id, tab_id);
create index orders_guest_idx on public.orders (guest_id) where guest_id is not null;

alter table public.order_items add column shared boolean not null default false;

-- A equipe só registra o pagamento, e só com a comanda aberta.
create function private.guard_tab_guest_update() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new) - array['paid_cents','paid_at']) is distinct from (to_jsonb(old) - array['paid_cents','paid_at']) then
    raise exception 'Só o pagamento da pessoa pode ser alterado' using errcode='42501';
  end if;
  if not exists(select 1 from public.tabs where id=old.tab_id and status='open') then
    raise exception 'A comanda foi fechada' using errcode='23514';
  end if;
  if new.paid_cents is distinct from old.paid_cents then
    new.paid_at := case when new.paid_cents is null then null else now() end;
  end if;
  return new;
end $$;
create trigger tab_guests_guard_update before update on public.tab_guests
  for each row execute function private.guard_tab_guest_update();

alter table public.tab_guests enable row level security;
revoke all on public.tab_guests from anon;
grant select, update on public.tab_guests to authenticated;
grant select, insert, update, delete on public.tab_guests to service_role;
create policy "tab_guests: leitura" on public.tab_guests
  for select to authenticated using (private.can_read(restaurant_id));
create policy "tab_guests: garçom ou gestor registra pagamento" on public.tab_guests
  for update to authenticated
  using (private.is_member(restaurant_id, array['waiter','manager']::public.member_role[]))
  with check (private.is_member(restaurant_id, array['waiter','manager']::public.member_role[]));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tab_guests;
  end if;
end;
$$;

-- PIN + nome: o nome cria (ou reaproveita) a pessoa na comanda e fica na sessão.
drop function public.verify_table_pin(text,text,text,text,text);
create function public.verify_table_pin(p_slug text, p_qr text, p_pin text, p_device text, p_hash text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; tab public.tabs; attempt public.pin_attempts; failures integer; v_name text; gid uuid;
begin
  v_name := nullif(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'), '');
  if char_length(v_name) > 40 then return jsonb_build_object('error','Nome muito longo','status',400); end if;
  select t.restaurant_id, t.id into rid, tid from public.tables t join public.restaurants r on r.id=t.restaurant_id
    where r.slug=p_slug and r.status='active' and t.qr_token=p_qr and t.active;
  if tid is null then return jsonb_build_object('error','Mesa indisponível','status',404); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device || rid::text, 0));
  insert into public.pin_attempts(device_id,restaurant_id) values(p_device,rid) on conflict do nothing;
  select * into attempt from public.pin_attempts where device_id=p_device and restaurant_id=rid for update;
  if attempt.locked_until > now() then return jsonb_build_object('error','Aguarde 5 minutos para tentar novamente','status',429); end if;
  select * into tab from public.tabs where table_id=tid and status='open' for update;
  if tab.id is null then return jsonb_build_object('error','Chame o garçom para abrir a mesa','status',409); end if;
  if tab.pin <> p_pin then
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
revoke all on function public.verify_table_pin(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.verify_table_pin(text,text,text,text,text,text) to service_role;

-- Pedido: grava quem pediu e quais itens são divididos com a mesa.
create or replace function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; session_guest uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; total integer:=0; prep integer:=1; lines jsonb:='[]';
begin
  select t.restaurant_id,s.tab_id,s.guest_id into rid,session_tab,session_guest from public.tab_sessions s join public.tabs b on b.id=s.tab_id
    join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
    where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if session_tab is null then raise exception 'Sessão inválida. Digite o código da mesa' using errcode='28000'; end if;
  select * into tab from public.tabs where id=session_tab for update;
  if tab.status <> 'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  select id into oid from public.orders where request_id=p_request and tab_id=tab.id;
  if oid is not null then return jsonb_build_object('id',oid); end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Pedido inválido'; end if;
  for line in select value from jsonb_array_elements(p_items) loop
    qty := (line->>'quantity')::integer;
    if qty not between 1 and 99 or length(coalesce(line->>'note',''))>200 then raise exception 'Quantidade ou observação inválida'; end if;
    if jsonb_typeof(coalesce(line->'shared','false'::jsonb))<>'boolean' then raise exception 'Pedido inválido'; end if;
    select mi.* into item from public.menu_items mi join public.categories c on c.id=mi.category_id
      where mi.id=(line->>'item_id')::uuid and mi.restaurant_id=rid and mi.active and not mi.sold_out and c.active for share of mi,c;
    if item.id is null then raise exception 'Um item ficou indisponível. Revise o carrinho'; end if;
    selected := coalesce(line->'modifier_ids','[]'::jsonb);
    if jsonb_typeof(selected)<>'array' then raise exception 'Adicionais inválidos'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(selected)) <> jsonb_array_length(selected) then raise exception 'Adicional duplicado'; end if;
    if exists(select 1 from jsonb_array_elements_text(selected) v where not exists(select 1 from public.modifiers m join public.modifier_groups g on g.id=m.group_id where m.id=v.value::uuid and g.menu_item_id=item.id)) then raise exception 'Adicional inválido'; end if;
    for grp in select * from public.modifier_groups where menu_item_id=item.id for share loop
      select count(*) into count_selected from public.modifiers m where m.group_id=grp.id and selected ? m.id::text;
      if count_selected < grp.min_select or count_selected > grp.max_select then raise exception 'Revise os adicionais de %',grp.name; end if;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('group',g.name,'name',m.name,'price_cents',m.price_cents)),'[]'::jsonb),item.price_cents+coalesce(sum(m.price_cents),0)
      into snapshot,unit from public.modifiers m join public.modifier_groups g on g.id=m.group_id where g.menu_item_id=item.id and selected ? m.id::text;
    total:=total+unit*qty; prep:=greatest(prep,item.prep_minutes);
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot,'shared',coalesce((line->>'shared')::boolean,false)));
  end loop;
  insert into public.orders(restaurant_id,tab_id,guest_id,prep_minutes,total_cents,request_id) values(rid,tab.id,session_guest,prep,total,p_request) returning id into oid;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared)
      values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers',(line->>'shared')::boolean);
  end loop;
  return jsonb_build_object('id',oid,'prep_minutes',prep,'total_cents',total);
end $$;

-- Cada pessoa só cancela os próprios pedidos.
create or replace function public.cancel_table_order(p_slug text,p_qr text,p_hash text,p_order uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; gid uuid; tab public.tabs;
begin
  select s.tab_id,s.guest_id into bid,gid from public.tab_sessions s join public.tabs b on b.id=s.tab_id join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
  where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if bid is null then raise exception 'Sessão inválida' using errcode='28000'; end if;
  select * into tab from public.tabs where id=bid for update;
  if tab.status<>'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  update public.orders set status='cancelado' where id=p_order and tab_id=bid and status='recebido' and guest_id is not distinct from gid;
  return found;
end $$;
