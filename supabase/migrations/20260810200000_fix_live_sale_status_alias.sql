create or replace function public.live_sale_status(p_public_token text)
returns table(
  id uuid, name text, event_date date, product_name text, public_token text,
  price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer,
  last_purchase_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
  expired_count integer;
begin
  select * into sale from public.sales_events as active_event
  where active_event.is_active and active_event.public_token = p_public_token
  for update;
  if not found then
    raise exception 'Esta venda foi encerrada. Use o QR Code do domingo atual.' using errcode = 'P0001';
  end if;
  with expired as (
    update public.orders set payment_status = 'expired'
    where sales_event_id = sale.id and payment_status = 'reserved' and reserved_until < now()
    returning jsonb_array_length(items) as quantity
  ) select coalesce(sum(quantity), 0)::integer into expired_count from expired;
  if expired_count > 0 then
    update public.sales_events as event
    set reserved_quantity = greatest(0, event.reserved_quantity - expired_count)
    where event.id = sale.id;
  end if;
  return query
  select event.id, event.name, event.event_date, event.product_name, event.public_token,
    event.price_cents, event.stock_total, event.reserved_quantity, event.confirmed_quantity,
    max(order_row.confirmed_at) filter (where order_row.payment_status = 'confirmed') as last_purchase_at
  from public.sales_events as event
  left join public.orders as order_row on order_row.sales_event_id = event.id
  where event.id = sale.id
  group by event.id;
end;
$$;
