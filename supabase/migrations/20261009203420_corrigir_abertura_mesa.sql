create or replace function public.open_table(p_table uuid)
returns public.tabs language plpgsql security invoker set search_path='' as $$
declare t public.tables; result public.tabs; candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_table::text, 1));
  select * into t from public.tables where id=p_table and active;
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

