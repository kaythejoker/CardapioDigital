-- RPCs privileged only by the calling server role, never SECURITY DEFINER.
alter table public.orders add column request_id uuid unique;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

create function public.verify_table_pin(p_slug text, p_qr text, p_pin text, p_device text, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid; tid uuid; tab public.tabs; attempt public.pin_attempts; failures integer;
begin
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
  insert into public.tab_sessions(tab_id,token_hash) values(tab.id,p_hash);
  return jsonb_build_object('tab_id',tab.id);
end $$;
revoke all on function public.verify_table_pin(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.verify_table_pin(text,text,text,text,text) to service_role;

create function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; total integer:=0; prep integer:=1; lines jsonb:='[]';
begin
  select t.restaurant_id,s.tab_id into rid,session_tab from public.tab_sessions s join public.tabs b on b.id=s.tab_id
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
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot));
  end loop;
  insert into public.orders(restaurant_id,tab_id,prep_minutes,total_cents,request_id) values(rid,tab.id,prep,total,p_request) returning id into oid;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot)
      values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers');
  end loop;
  return jsonb_build_object('id',oid,'prep_minutes',prep,'total_cents',total);
end $$;
revoke all on function public.submit_table_order(text,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.submit_table_order(text,text,text,uuid,jsonb) to service_role;

create function public.open_table(p_table uuid)
returns public.tabs language plpgsql security invoker set search_path='' as $$
declare t public.tables; result public.tabs; candidate text;
begin
  select * into t from public.tables where id=p_table and active for update;
  if t.id is null then raise exception 'Mesa indisponível'; end if;
  if not private.is_member(t.restaurant_id,array['waiter','manager']::public.member_role[]) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if exists(select 1 from public.tabs where table_id=t.id and status='open') then raise exception 'A mesa já está aberta'; end if;
  for i in 1..100 loop
    candidate:=lpad(floor(random()*10000)::integer::text,4,'0');
    begin
      insert into public.tabs(restaurant_id,table_id,pin,opened_by) values(t.restaurant_id,t.id,candidate,auth.uid()) returning * into result;
      return result;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Não foi possível gerar um código. Tente novamente';
end $$;
revoke all on function public.open_table(uuid) from public,anon;
grant execute on function public.open_table(uuid) to authenticated;

-- Enforce staff responsibilities even when calling PostgREST directly.
create function private.guard_order_role() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is not null and new.status is distinct from old.status then
    if new.status in ('em_preparo','pronto') and not private.is_member(old.restaurant_id,array['kitchen','manager']::public.member_role[]) then raise exception 'Apenas cozinha ou gestor' using errcode='42501'; end if;
    if new.status in ('entregue','cancelado') and not private.is_member(old.restaurant_id,array['waiter','manager']::public.member_role[]) then raise exception 'Apenas garçom ou gestor' using errcode='42501'; end if;
  end if;
  if auth.uid() is not null and new.pinned is distinct from old.pinned and not private.is_member(old.restaurant_id,array['kitchen','manager']::public.member_role[]) then raise exception 'Apenas cozinha ou gestor' using errcode='42501'; end if;
  return new;
end $$;
create trigger orders_guard_role before update on public.orders for each row execute function private.guard_order_role();
