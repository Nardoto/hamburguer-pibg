create or replace function public.active_sale_status(p_public_token text)
returns table(
  id uuid, name text, event_date date, product_name text, public_token text,
  price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
  expired_count integer;
begin
  select * into sale
  from public.sales_events as event
  where event.is_active and event.public_token = p_public_token
  for update;
  if not found then
    raise exception 'Esta venda foi encerrada. Use o QR Code do domingo atual.' using errcode = 'P0001';
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
    update public.sales_events as event
    set reserved_quantity = greatest(0, event.reserved_quantity - expired_count)
    where event.id = sale.id;
  end if;

  return query
  select event.id, event.name, event.event_date, event.product_name, event.public_token,
    event.price_cents, event.stock_total, event.reserved_quantity, event.confirmed_quantity
  from public.sales_events as event
  where event.id = sale.id;
end;
$$;

create or replace function public.start_sale_event(p_name text, p_event_date date, p_stock_total integer)
returns table(
  id uuid, name text, event_date date, product_name text, public_token text,
  price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_sale public.sales_events;
begin
  if (select role from public.team_members where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Apenas o administrador pode criar um novo domingo.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 100 or p_event_date is null or p_stock_total < 1 then
    raise exception 'Informe nome, data e quantidade inicial válidos.' using errcode = '22023';
  end if;

  update public.orders
  set payment_status = 'expired'
  where payment_status = 'reserved'
    and sales_event_id in (select event.id from public.sales_events as event where event.is_active);

  update public.sales_events as event set is_active = false where event.is_active;

  insert into public.sales_events (name, event_date, stock_total, public_token)
  values (trim(p_name), p_event_date, p_stock_total, encode(extensions.gen_random_bytes(18), 'hex'))
  returning * into new_sale;

  return query
  select new_sale.id, new_sale.name, new_sale.event_date, new_sale.product_name, new_sale.public_token,
    new_sale.price_cents, new_sale.stock_total, new_sale.reserved_quantity, new_sale.confirmed_quantity;
end;
$$;
