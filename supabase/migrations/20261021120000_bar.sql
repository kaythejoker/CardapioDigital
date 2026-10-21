-- Fase 2, etapa 4 (spec-fase2.md, seção 9): painel do bar.
-- Cada categoria tem um setor (cozinha ou bar) e o item pode sobrescrever. Ao
-- enviar, o servidor separa o carrinho em um pedido por setor, ligados pelo
-- mesmo batch_id, para a fila, o atraso, o status e o cancelamento continuarem
-- funcionando por pedido. O cliente vê o envio como um pedido só, com o status
-- de cada setor.

alter table public.categories
  add column station text not null default 'cozinha' check (station in ('cozinha', 'bar'));
alter table public.menu_items
  add column station text check (station in ('cozinha', 'bar'));
alter table public.orders
  add column station text not null default 'cozinha' check (station in ('cozinha', 'bar')),
  add column batch_id uuid;
create index orders_batch_idx on public.orders (batch_id) where batch_id is not null;
alter table public.order_items
  add column station text check (station in ('cozinha', 'bar'));

-- Um envio pode virar dois pedidos (um por setor) com o mesmo request_id.
alter table public.orders drop constraint orders_request_id_key;
create unique index orders_request_station_idx on public.orders (request_id, station) where request_id is not null;

-- Setor efetivo do item: o do item, senão o da categoria.
create function private.item_station(p_item uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(mi.station, c.station, 'cozinha')
  from public.menu_items mi join public.categories c on c.id = mi.category_id
  where mi.id = p_item;
$$;
revoke all on function private.item_station(uuid) from public;
grant execute on function private.item_station(uuid) to authenticated, service_role;

-- Editor do item: setor opcional (null = herda da categoria).
create or replace function public.save_menu_item(p_restaurant uuid,p_item uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare iid uuid; gid uuid; grp jsonb; modifier jsonb; previous public.menu_items; enable boolean; qty integer; threshold integer; v_station text;
begin
  if not private.can_edit_menu(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.categories where id=(p_data->>'category_id')::uuid and restaurant_id=p_restaurant) then raise exception 'Categoria inválida'; end if;
  enable := coalesce((p_data->>'stock_enabled')::boolean, false);
  qty := nullif(p_data->>'stock_quantity','')::integer;
  threshold := coalesce(nullif(p_data->>'low_stock_threshold','')::integer, 5);
  v_station := nullif(p_data->>'station','');
  if v_station is not null and v_station not in ('cozinha','bar') then raise exception 'Setor inválido'; end if;
  if enable and (qty is null or qty < 0) then raise exception 'Informe a quantidade em estoque'; end if;
  if p_item is null then
    insert into public.menu_items(restaurant_id,category_id,name,description,price_cents,photo_url,prep_minutes,active,featured,position,stock_enabled,stock_quantity,low_stock_threshold,sold_out,sold_out_auto,station)
    values(p_restaurant,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',(p_data->>'price_cents')::integer,p_data->>'photo_url',(p_data->>'prep_minutes')::integer,(p_data->>'active')::boolean,(p_data->>'featured')::boolean,coalesce((p_data->>'position')::integer,0),enable,case when enable then qty else null end,threshold,enable and qty = 0,enable and qty = 0,v_station) returning id into iid;
    if enable then
      perform private.log_stock(iid,'ajuste',qty,qty,'Estoque inicial');
    end if;
  else
    select * into previous from public.menu_items where id=p_item and restaurant_id=p_restaurant for update;
    if previous.id is null then raise exception 'Item indisponível'; end if;
    update public.menu_items set category_id=(p_data->>'category_id')::uuid,name=p_data->>'name',description=p_data->>'description',price_cents=(p_data->>'price_cents')::integer,photo_url=p_data->>'photo_url',prep_minutes=(p_data->>'prep_minutes')::integer,active=(p_data->>'active')::boolean,featured=(p_data->>'featured')::boolean,
      stock_enabled=enable,low_stock_threshold=threshold,
      stock_quantity=case when enable then qty else null end,
      sold_out=case when enable and qty = 0 then true when enable and previous.sold_out_auto then false when not enable and previous.sold_out_auto then false else sold_out end,
      sold_out_auto=enable and qty = 0,
      station=v_station
      where id=p_item returning id into iid;
    if enable and (not previous.stock_enabled or previous.stock_quantity is distinct from qty) then
      perform private.log_stock(iid,'ajuste',qty-coalesce(case when previous.stock_enabled then previous.stock_quantity end,0),qty,case when previous.stock_enabled then 'Ajuste pelo editor do item' else 'Estoque inicial' end);
    end if;
    delete from public.modifier_groups where menu_item_id=iid;
  end if;
  for grp in select value from jsonb_array_elements(p_data->'groups') loop
    insert into public.modifier_groups(menu_item_id,name,required,min_select,max_select,position)
    values(iid,grp->>'name',(grp->>'required')::boolean,(grp->>'min_select')::integer,(grp->>'max_select')::integer,(grp->>'position')::integer) returning id into gid;
    for modifier in select value from jsonb_array_elements(grp->'modifiers') loop
      insert into public.modifiers(group_id,name,price_cents,position) values(gid,modifier->>'name',(modifier->>'price_cents')::integer,(modifier->>'position')::integer);
    end loop;
  end loop;
  return iid;
end $$;

-- Pedido: um por setor, mesmo batch_id; retry devolve o mesmo envio.
create or replace function public.submit_table_order(p_slug text,p_qr text,p_hash text,p_request uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare tab public.tabs; rid uuid; session_tab uuid; session_guest uuid; oid uuid; line jsonb; item public.menu_items; grp public.modifier_groups;
  selected jsonb; snapshot jsonb; count_selected integer; qty integer; unit integer; lines jsonb:='[]'; line_id uuid; st text;
  batch uuid; created jsonb:='[]'; total_all integer:=0; prep_all integer:=1; st_total integer; st_prep integer; existing_batch uuid;
begin
  perform set_config('app.actor', 'customer', true);
  select t.restaurant_id,s.tab_id,s.guest_id into rid,session_tab,session_guest from public.tab_sessions s join public.tabs b on b.id=s.tab_id
    join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
    where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if session_tab is null then raise exception 'Sessão inválida. Digite o código da mesa' using errcode='28000'; end if;
  select * into tab from public.tabs where id=session_tab for update;
  if tab.status <> 'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  select id, batch_id into oid, existing_batch from public.orders where request_id=p_request and tab_id=tab.id order by created_at limit 1;
  if oid is not null then
    return jsonb_build_object('id',oid,'batch_id',existing_batch,
      'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'station',o.station)),'[]'::jsonb) from public.orders o where o.request_id=p_request and o.tab_id=tab.id));
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Pedido inválido'; end if;
  for line in select value from jsonb_array_elements(p_items) loop
    qty := (line->>'quantity')::integer;
    if qty not between 1 and 99 or length(coalesce(line->>'note',''))>200 then raise exception 'Quantidade ou observação inválida'; end if;
    if jsonb_typeof(coalesce(line->'shared','false'::jsonb))<>'boolean' then raise exception 'Pedido inválido'; end if;
    select mi.* into item from public.menu_items mi join public.categories c on c.id=mi.category_id
      where mi.id=(line->>'item_id')::uuid and mi.restaurant_id=rid and mi.active and not mi.sold_out and c.active for update of mi;
    if item.id is null then raise exception 'Um item ficou indisponível. Revise o carrinho'; end if;
    select coalesce(mi.station, c.station, 'cozinha') into st from public.menu_items mi join public.categories c on c.id=mi.category_id where mi.id=item.id;
    if item.stock_enabled and item.stock_quantity < qty then
      raise exception 'Restam % unidades de %', item.stock_quantity, item.name;
    end if;
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
    lines:=lines || jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'unit',unit,'qty',qty,'note',line->>'note','modifiers',snapshot,'shared',coalesce((line->>'shared')::boolean,false),'stock',item.stock_enabled,'station',st,'prep',item.prep_minutes));
  end loop;
  batch := gen_random_uuid();
  for st in select distinct value->>'station' from jsonb_array_elements(lines) order by 1 loop
    select coalesce(sum((value->>'unit')::integer*(value->>'qty')::integer),0), coalesce(max((value->>'prep')::integer),1)
      into st_total, st_prep from jsonb_array_elements(lines) where value->>'station'=st;
    insert into public.orders(restaurant_id,tab_id,guest_id,prep_minutes,total_cents,request_id,station,batch_id)
      values(rid,tab.id,session_guest,st_prep,st_total,p_request,st,batch) returning id into oid;
    for line in select value from jsonb_array_elements(lines) where value->>'station'=st loop
      insert into public.order_items(order_id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared,station)
        values(oid,(line->>'item_id')::uuid,line->>'name',(line->>'unit')::integer,(line->>'qty')::integer,line->>'note',line->'modifiers',(line->>'shared')::boolean,st) returning id into line_id;
      if (line->>'stock')::boolean then
        perform private.move_stock((line->>'item_id')::uuid, 'venda', -((line->>'qty')::integer), line_id, null, null);
      end if;
    end loop;
    total_all := total_all + st_total; prep_all := greatest(prep_all, st_prep);
    created := created || jsonb_build_array(jsonb_build_object('id',oid,'station',st,'prep_minutes',st_prep,'total_cents',st_total));
  end loop;
  return jsonb_build_object('id',(created->0->>'id')::uuid,'batch_id',batch,'prep_minutes',prep_all,'total_cents',total_all,'orders',created);
end $$;

-- O registro de pedidos passa a guardar o setor.
create or replace function private.audit_orders() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.restaurant_id, 'pedido_enviado', 'order', new.id, new.tab_id,
      jsonb_build_object('total_cents', new.total_cents, 'guest_id', new.guest_id, 'prep_minutes', new.prep_minutes, 'station', new.station, 'batch_id', new.batch_id));
  else
    if new.status is distinct from old.status then
      perform private.audit(new.restaurant_id, 'pedido_' || new.status::text, 'order', new.id, new.tab_id,
        jsonb_build_object('from', old.status, 'total_cents', new.total_cents, 'guest_id', new.guest_id, 'station', new.station));
    end if;
    if new.pinned is distinct from old.pinned then
      perform private.audit(new.restaurant_id, case when new.pinned then 'pedido_fixado' else 'pedido_desafixado' end, 'order', new.id, new.tab_id, '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
