create or replace function public.recover_tickets(
  p_public_token text,
  p_customer_name text,
  p_customer_phone text
)
returns table(
  code text,
  customer_name text,
  customer_phone text,
  items jsonb
)
language plpgsql
security definer
set search_path = public
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
  select order_row.code, order_row.customer_name, order_row.customer_phone, order_row.items
  from public.orders as order_row
  join public.sales_events as sale on sale.id = order_row.sales_event_id
  where sale.is_active
    and sale.public_token = p_public_token
    and order_row.payment_status = 'confirmed'
    and lower(regexp_replace(trim(order_row.customer_name), '\\s+', ' ', 'g')) = normalized_name
    and regexp_replace(order_row.customer_phone, '\\D', '', 'g') = normalized_phone
  order by order_row.created_at desc
  limit 10;
end;
$$;

revoke all on function public.recover_tickets(text, text, text) from public;
grant execute on function public.recover_tickets(text, text, text) to anon, authenticated;
