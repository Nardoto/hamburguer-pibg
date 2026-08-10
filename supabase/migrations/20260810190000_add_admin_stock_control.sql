create or replace function public.current_team_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.team_members where user_id = auth.uid();
$$;

create or replace function public.set_active_stock_total(p_stock_total integer)
returns table(id uuid, price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
begin
  if (select role from public.team_members where user_id = auth.uid()) <> 'admin' then
    raise exception 'Apenas o administrador pode alterar a quantidade.' using errcode = '42501';
  end if;
  if p_stock_total < 0 then
    raise exception 'A quantidade não pode ser negativa.' using errcode = '22023';
  end if;
  select * into sale from public.sales_events where is_active for update;
  if not found then
    raise exception 'Não há uma venda ativa no momento.' using errcode = 'P0001';
  end if;
  if p_stock_total < sale.reserved_quantity + sale.confirmed_quantity then
    raise exception 'A quantidade não pode ser menor que os pedidos já reservados ou confirmados.' using errcode = '22023';
  end if;
  update public.sales_events
  set stock_total = p_stock_total
  where sales_events.id = sale.id;
  return query
  select event.id, event.price_cents, event.stock_total, event.reserved_quantity, event.confirmed_quantity
  from public.sales_events as event
  where event.id = sale.id;
end;
$$;

revoke all on function public.current_team_role() from public;
revoke all on function public.set_active_stock_total(integer) from public;
grant execute on function public.current_team_role() to authenticated;
grant execute on function public.set_active_stock_total(integer) to authenticated;
