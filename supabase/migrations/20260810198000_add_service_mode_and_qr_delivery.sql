alter table public.orders
  add column service_mode text not null default 'local'
  check (service_mode in ('local', 'takeaway'));

create or replace function public.reserve_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_public_token text,
  p_service_mode text
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
  if length(regexp_replace(coalesce(p_customer_phone, ''), '\\D', '', 'g')) not between 10 and 15 then
    raise exception 'Informe um celular válido.' using errcode = '22023';
  end if;
  if p_service_mode not in ('local', 'takeaway') then
    raise exception 'Informe como o pedido será retirado.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_public_token, '')) < 24 or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Link de venda inválido.' using errcode = '22023';
  end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 10 then
    raise exception 'Escolha entre 1 e 10 combos.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
      or jsonb_typeof(coalesce(item->'removed', '[]'::jsonb)) <> 'array'
      or char_length(coalesce(item->>'note', '')) > 180
  ) then
    raise exception 'Itens inválidos.' using errcode = '22023';
  end if;

  select * into sale from public.sales_events where is_active and public_token = p_public_token for update;
  if not found then
    raise exception 'Esta venda foi encerrada. Use o QR Code do domingo atual.' using errcode = 'P0001';
  end if;
  with expired as (
    update public.orders set payment_status = 'expired'
    where sales_event_id = sale.id and payment_status = 'reserved' and reserved_until < now()
    returning jsonb_array_length(items) as quantity
  ) select coalesce(sum(quantity), 0)::integer into expired_count from expired;
  if expired_count > 0 then
    update public.sales_events as event set reserved_quantity = greatest(0, event.reserved_quantity - expired_count) where event.id = sale.id;
  end if;
  select * into sale from public.sales_events where id = sale.id for update;
  if sale.stock_total - sale.reserved_quantity - sale.confirmed_quantity < item_count then
    raise exception 'Estoque esgotado para esta quantidade.' using errcode = 'P0001';
  end if;
  insert into public.orders (sales_event_id, customer_name, customer_phone, source, service_mode, payment_status, items, reserved_until)
  values (sale.id, trim(p_customer_name), trim(p_customer_phone), 'online', p_service_mode, 'reserved', p_items, reservation_expiry)
  returning * into new_order;
  update public.sales_events set reserved_quantity = reserved_quantity + item_count where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;
  return query select new_order.id, new_order.access_token, reservation_expiry, remaining_stock;
end;
$$;

create or replace function public.create_manual_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_kitchen_note text,
  p_service_mode text
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
  remaining_stock integer;
begin
  if not public.is_team_member() then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_customer_name, ''))) not between 2 and 100
    or length(regexp_replace(coalesce(p_customer_phone, ''), '\\D', '', 'g')) not between 10 and 15
    or p_service_mode not in ('local', 'takeaway') then
    raise exception 'Dados do cliente inválidos.' using errcode = '22023';
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
  pickup_code := 'PIBG-' || lpad(nextval('public.pickup_code_sequence')::text, 4, '0');
  insert into public.orders (sales_event_id, code, customer_name, customer_phone, source, service_mode, payment_status, items, kitchen_note, confirmed_at)
  values (sale.id, pickup_code, trim(p_customer_name), trim(p_customer_phone), 'manual', p_service_mode, 'confirmed', p_items, trim(coalesce(p_kitchen_note, '')), now());
  update public.sales_events set confirmed_quantity = confirmed_quantity + item_count where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;
  return query select pickup_code, remaining_stock;
end;
$$;

drop function public.list_team_orders();
create function public.list_team_orders()
returns table(
  id uuid, code text, customer_name text, customer_phone text, source text, service_mode text, payment_status text,
  kitchen_status text, items jsonb, kitchen_note text, withdrawn_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.code, o.customer_name, o.customer_phone, o.source, o.service_mode, o.payment_status,
    o.kitchen_status, o.items, o.kitchen_note, o.withdrawn_at, o.created_at
  from public.orders o join public.sales_events s on s.id = o.sales_event_id
  where s.is_active and public.is_team_member() and o.payment_status = 'confirmed'
  order by o.created_at asc;
$$;

drop function public.recover_tickets(text, text, text);
create function public.recover_tickets(p_public_token text, p_customer_name text, p_customer_phone text)
returns table(code text, customer_name text, customer_phone text, service_mode text, items jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  normalized_name text := lower(regexp_replace(trim(coalesce(p_customer_name, '')), '\\s+', ' ', 'g'));
  normalized_phone text := regexp_replace(coalesce(p_customer_phone, ''), '\\D', '', 'g');
begin
  if char_length(trim(coalesce(p_public_token, ''))) < 20 then
    raise exception 'Não foi possível localizar o comprovante.' using errcode = '22023';
  end if;
  if char_length(normalized_name) not between 2 and 100 or char_length(normalized_phone) not between 10 and 15 then
    raise exception 'Informe nome completo e celular válido.' using errcode = '22023';
  end if;
  return query
  select order_row.code, order_row.customer_name, order_row.customer_phone, order_row.service_mode, order_row.items
  from public.orders as order_row join public.sales_events as sale on sale.id = order_row.sales_event_id
  where sale.is_active and sale.public_token = p_public_token and order_row.payment_status = 'confirmed'
    and lower(regexp_replace(trim(order_row.customer_name), '\\s+', ' ', 'g')) = normalized_name
    and regexp_replace(order_row.customer_phone, '\\D', '', 'g') = normalized_phone
  order by order_row.created_at desc limit 10;
end;
$$;

revoke all on function public.reserve_order(text, text, jsonb, text) from public;
revoke all on function public.create_manual_order(text, text, jsonb, text) from public;
revoke all on function public.reserve_order(text, text, jsonb, text, text) from public;
revoke all on function public.create_manual_order(text, text, jsonb, text, text) from public;
revoke all on function public.list_team_orders() from public;
revoke all on function public.recover_tickets(text, text, text) from public;
grant execute on function public.reserve_order(text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.create_manual_order(text, text, jsonb, text, text) to authenticated;
grant execute on function public.list_team_orders() to authenticated;
grant execute on function public.recover_tickets(text, text, text) to anon, authenticated;
