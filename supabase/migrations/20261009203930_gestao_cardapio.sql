create function public.save_menu_item(p_restaurant uuid,p_item uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare iid uuid; gid uuid; grp jsonb; modifier jsonb;
begin
  if not private.can_manage(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.categories where id=(p_data->>'category_id')::uuid and restaurant_id=p_restaurant) then raise exception 'Categoria inválida'; end if;
  if p_item is null then
    insert into public.menu_items(restaurant_id,category_id,name,description,price_cents,photo_url,prep_minutes,active,featured,position)
    values(p_restaurant,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',(p_data->>'price_cents')::integer,p_data->>'photo_url',(p_data->>'prep_minutes')::integer,(p_data->>'active')::boolean,(p_data->>'featured')::boolean,coalesce((p_data->>'position')::integer,0)) returning id into iid;
  else
    update public.menu_items set category_id=(p_data->>'category_id')::uuid,name=p_data->>'name',description=p_data->>'description',price_cents=(p_data->>'price_cents')::integer,photo_url=p_data->>'photo_url',prep_minutes=(p_data->>'prep_minutes')::integer,active=(p_data->>'active')::boolean,featured=(p_data->>'featured')::boolean
      where id=p_item and restaurant_id=p_restaurant returning id into iid;
    if iid is null then raise exception 'Item indisponível'; end if;
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
revoke all on function public.save_menu_item(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_menu_item(uuid,uuid,jsonb) to authenticated;

create function public.reorder_menu(p_restaurant uuid,p_kind text,p_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare iid uuid; pos integer:=0;
begin
  if not private.can_manage(p_restaurant) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_kind not in ('categories','menu_items') then raise exception 'Lista inválida'; end if;
  if cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'IDs duplicados'; end if;
  foreach iid in array p_ids loop
    if p_kind='categories' then
      update public.categories set position=pos where id=iid and restaurant_id=p_restaurant;
    else
      update public.menu_items set position=pos where id=iid and restaurant_id=p_restaurant;
    end if;
    if not found then raise exception 'Item inválido'; end if;
    pos:=pos+1;
  end loop;
end $$;
revoke all on function public.reorder_menu(uuid,text,uuid[]) from public,anon;
grant execute on function public.reorder_menu(uuid,text,uuid[]) to authenticated;

create function public.cancel_table_order(p_slug text,p_qr text,p_hash text,p_order uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bid uuid; tab public.tabs;
begin
  select s.tab_id into bid from public.tab_sessions s join public.tabs b on b.id=s.tab_id join public.tables t on t.id=b.table_id join public.restaurants r on r.id=t.restaurant_id
  where s.token_hash=p_hash and s.expires_at>now() and t.qr_token=p_qr and t.active and r.slug=p_slug and r.status='active';
  if bid is null then raise exception 'Sessão inválida' using errcode='28000'; end if;
  select * into tab from public.tabs where id=bid for update;
  if tab.status<>'open' then raise exception 'A comanda foi fechada' using errcode='28000'; end if;
  update public.orders set status='cancelado' where id=p_order and tab_id=bid and status='recebido';
  return found;
end $$;
revoke all on function public.cancel_table_order(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_table_order(text,text,text,uuid) to service_role;
