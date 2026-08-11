alter table public.orders drop constraint if exists orders_code_key;

create unique index if not exists orders_sale_event_code_idx
  on public.orders (sales_event_id, code)
  where code is not null;

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
  next_code_number integer;
  remaining_stock integer;
begin
  select * into current_order
  from public.orders
  where id = p_order_id and access_token = p_access_token
  for update;

  if not found or current_order.payment_status <> 'reserved' or current_order.reserved_until < now() then
    raise exception 'Esta reserva expirou. Faça um novo pedido.' using errcode = 'P0001';
  end if;

  select * into sale
  from public.sales_events
  where id = current_order.sales_event_id and is_active
  for update;

  if not found then
    raise exception 'Esta venda foi encerrada. Faça o pedido pelo QR Code do domingo atual.' using errcode = 'P0001';
  end if;

  item_count := jsonb_array_length(current_order.items);
  select count(*)::integer + 1 into next_code_number
  from public.orders
  where sales_event_id = sale.id and payment_status = 'confirmed';

  pickup_code := 'PIBG-' || lpad(next_code_number::text, 4, '0');

  update public.orders
  set payment_status = 'confirmed', code = pickup_code, confirmed_at = now(), reserved_until = null
  where id = current_order.id;

  update public.sales_events
  set reserved_quantity = greatest(0, reserved_quantity - item_count),
      confirmed_quantity = confirmed_quantity + item_count
  where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;

  return query select pickup_code, remaining_stock;
end;
$$;

create or replace function public.create_manual_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_kitchen_note text,
  p_service_mode text,
  p_payment_method text
)
returns table(code text, available_stock integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
  item_count integer;
  pickup_code text;
  next_code_number integer;
  remaining_stock integer;
begin
  if not public.is_team_member() then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_customer_name, ''))) not between 2 and 100
    or length(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g')) not between 10 and 15
    or p_service_mode not in ('local', 'takeaway')
    or p_payment_method not in ('pix', 'cash', 'card') then
    raise exception 'Dados do pedido inválidos.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Itens inválidos.' using errcode = '22023';
  end if;

  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 10 or char_length(coalesce(p_kitchen_note, '')) > 300 then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;

  select * into sale from public.sales_events where is_active for update;
  if not found or sale.stock_total - sale.reserved_quantity - sale.confirmed_quantity < item_count then
    raise exception 'Não há combos suficientes disponíveis.' using errcode = 'P0001';
  end if;

  select count(*)::integer + 1 into next_code_number
  from public.orders
  where sales_event_id = sale.id and payment_status = 'confirmed';

  pickup_code := 'PIBG-' || lpad(next_code_number::text, 4, '0');

  insert into public.orders (
    sales_event_id, code, customer_name, customer_phone, source,
    service_mode, payment_method, payment_status, items,
    kitchen_note, confirmed_at
  )
  values (
    sale.id, pickup_code, trim(p_customer_name), trim(p_customer_phone),
    'manual', p_service_mode, p_payment_method, 'confirmed',
    p_items, trim(coalesce(p_kitchen_note, '')), now()
  );

  update public.sales_events
  set confirmed_quantity = confirmed_quantity + item_count
  where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;

  return query select pickup_code, remaining_stock;
end;
$$;
