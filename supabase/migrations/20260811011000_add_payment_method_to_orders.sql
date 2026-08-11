alter table public.orders
  add column payment_method text not null default 'pix'
  check (payment_method in ('pix', 'cash', 'card'));

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
  pickup_code := 'PIBG-' || lpad(nextval('public.pickup_code_sequence')::text, 4, '0');
  insert into public.orders (sales_event_id, code, customer_name, customer_phone, source, service_mode, payment_method, payment_status, items, kitchen_note, confirmed_at)
  values (sale.id, pickup_code, trim(p_customer_name), trim(p_customer_phone), 'manual', p_service_mode, p_payment_method, 'confirmed', p_items, trim(coalesce(p_kitchen_note, '')), now());
  update public.sales_events set confirmed_quantity = confirmed_quantity + item_count where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;
  return query select pickup_code, remaining_stock;
end;
$$;

drop function public.list_team_orders();
create function public.list_team_orders()
returns table(
  id uuid, code text, customer_name text, customer_phone text, source text, service_mode text, payment_method text, payment_status text,
  kitchen_status text, items jsonb, kitchen_note text, withdrawn_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.code, o.customer_name, o.customer_phone, o.source, o.service_mode, o.payment_method, o.payment_status,
    o.kitchen_status, o.items, o.kitchen_note, o.withdrawn_at, o.created_at
  from public.orders o join public.sales_events s on s.id = o.sales_event_id
  where s.is_active and public.is_team_member() and o.payment_status = 'confirmed'
  order by o.created_at asc;
$$;

revoke all on function public.create_manual_order(text, text, jsonb, text, text, text) from public;
revoke all on function public.list_team_orders() from public;
grant execute on function public.create_manual_order(text, text, jsonb, text, text, text) to authenticated;
grant execute on function public.list_team_orders() to authenticated;
