alter table public.sales_events add column public_token text;

update public.sales_events
set public_token = encode(extensions.gen_random_bytes(18), 'hex')
where public_token is null;

alter table public.sales_events alter column public_token set not null;
create unique index sales_events_public_token_idx on public.sales_events (public_token);

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
  from public.sales_events
  where is_active and public_token = p_public_token
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

create or replace function public.team_active_sale_status()
returns table(
  id uuid, name text, event_date date, product_name text, public_token text,
  price_cents integer, stock_total integer, reserved_quantity integer, confirmed_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_member() then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  return query
  select event.id, event.name, event.event_date, event.product_name, event.public_token,
    event.price_cents, event.stock_total, event.reserved_quantity, event.confirmed_quantity
  from public.sales_events as event
  where event.is_active;
end;
$$;

create or replace function public.reserve_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_public_token text
)
returns table(order_id uuid, access_token uuid, expires_at timestamptz, available_stock integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
  new_order public.orders;
  item_count integer;
  expired_count integer;
  remaining_stock integer;
  reservation_expiry timestamptz := now() + interval '10 minutes';
begin
  if char_length(trim(coalesce(p_customer_name, ''))) not between 2 and 100 then
    raise exception 'Informe um nome entre 2 e 100 caracteres.' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g')) not between 10 and 15 then
    raise exception 'Informe um celular válido.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_public_token, '')) < 24 or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Link de venda inválido.' using errcode = '22023';
  end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 10 then
    raise exception 'Escolha entre 1 e 10 combos.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
      or jsonb_typeof(coalesce(item->'removed', '[]'::jsonb)) <> 'array'
      or char_length(coalesce(item->>'note', '')) > 180
  ) then
    raise exception 'Itens inválidos.' using errcode = '22023';
  end if;

  select * into sale
  from public.sales_events
  where is_active and public_token = p_public_token
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

  select * into sale from public.sales_events where id = sale.id for update;
  if sale.stock_total - sale.reserved_quantity - sale.confirmed_quantity < item_count then
    raise exception 'Estoque esgotado para esta quantidade.' using errcode = 'P0001';
  end if;

  insert into public.orders (sales_event_id, customer_name, customer_phone, source, payment_status, items, reserved_until)
  values (sale.id, trim(p_customer_name), trim(p_customer_phone), 'online', 'reserved', p_items, reservation_expiry)
  returning * into new_order;

  update public.sales_events
  set reserved_quantity = reserved_quantity + item_count
  where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;

  return query select new_order.id, new_order.access_token, reservation_expiry, remaining_stock;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid, p_access_token uuid)
returns table(code text, available_stock integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders;
  sale public.sales_events;
  item_count integer;
  pickup_code text;
  remaining_stock integer;
begin
  select * into current_order
  from public.orders
  where id = p_order_id and access_token = p_access_token
  for update;
  if not found or current_order.payment_status <> 'reserved' or current_order.reserved_until < now() then
    raise exception 'Esta reserva expirou. Faça um novo pedido.' using errcode = 'P0001';
  end if;

  select * into sale from public.sales_events where id = current_order.sales_event_id and is_active for update;
  if not found then
    raise exception 'Esta venda foi encerrada. Faça o pedido pelo QR Code do domingo atual.' using errcode = 'P0001';
  end if;
  item_count := jsonb_array_length(current_order.items);
  pickup_code := 'PIBG-' || lpad(nextval('public.pickup_code_sequence')::text, 4, '0');

  update public.orders
  set payment_status = 'confirmed', code = pickup_code, confirmed_at = now(), reserved_until = null
  where id = current_order.id;

  update public.sales_events
  set reserved_quantity = greatest(0, reserved_quantity - item_count), confirmed_quantity = confirmed_quantity + item_count
  where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;

  return query select pickup_code, remaining_stock;
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
    and sales_event_id in (select id from public.sales_events where is_active);

  update public.sales_events set is_active = false where is_active;

  insert into public.sales_events (name, event_date, stock_total, public_token)
  values (trim(p_name), p_event_date, p_stock_total, encode(extensions.gen_random_bytes(18), 'hex'))
  returning * into new_sale;

  return query
  select new_sale.id, new_sale.name, new_sale.event_date, new_sale.product_name, new_sale.public_token,
    new_sale.price_cents, new_sale.stock_total, new_sale.reserved_quantity, new_sale.confirmed_quantity;
end;
$$;

revoke all on function public.active_sale_status() from public;
revoke all on function public.reserve_order(text, text, jsonb) from public;
revoke all on function public.active_sale_status(text) from public;
revoke all on function public.team_active_sale_status() from public;
revoke all on function public.reserve_order(text, text, jsonb, text) from public;
revoke all on function public.start_sale_event(text, date, integer) from public;
grant execute on function public.active_sale_status(text) to anon, authenticated;
grant execute on function public.team_active_sale_status() to authenticated;
grant execute on function public.reserve_order(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.start_sale_event(text, date, integer) to authenticated;
