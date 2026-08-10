create or replace function public.active_sale_status()
returns table(id uuid, price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
  expired_count integer;
begin
  select * into sale from public.sales_events where is_active for update;
  if not found then
    raise exception 'Não há uma venda ativa no momento.' using errcode = 'P0001';
  end if;

  with expired as (
    update public.orders
    set payment_status = 'expired'
    where sales_event_id = sale.id
      and payment_status = 'reserved'
      and reserved_until < now()
    returning jsonb_array_length(items) as quantity
  )
  select coalesce(sum(quantity), 0)::integer into expired_count from expired;

  if expired_count > 0 then
    update public.sales_events
    set reserved_quantity = greatest(0, reserved_quantity - expired_count)
    where id = sale.id;
  end if;

  return query
  select s.id, s.price_cents, s.stock_total, s.reserved_quantity, s.confirmed_quantity
  from public.sales_events s
  where s.id = sale.id;
end;
$$;

revoke all on function public.active_sale_status() from public;
grant execute on function public.active_sale_status() to anon, authenticated;
