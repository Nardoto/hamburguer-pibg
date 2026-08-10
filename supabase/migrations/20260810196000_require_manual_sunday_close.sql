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
  if exists (select 1 from public.sales_events as event where event.is_active) then
    raise exception 'Encerre o domingo atual antes de criar outro.' using errcode = 'P0001';
  end if;

  insert into public.sales_events (name, event_date, stock_total, public_token)
  values (trim(p_name), p_event_date, p_stock_total, encode(extensions.gen_random_bytes(18), 'hex'))
  returning * into new_sale;

  return query
  select new_sale.id, new_sale.name, new_sale.event_date, new_sale.product_name, new_sale.public_token,
    new_sale.price_cents, new_sale.stock_total, new_sale.reserved_quantity, new_sale.confirmed_quantity;
end;
$$;

create or replace function public.end_active_sale_event()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.sales_events;
begin
  if (select role from public.team_members where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Apenas o administrador pode encerrar o domingo.' using errcode = '42501';
  end if;

  select * into sale from public.sales_events as event where event.is_active for update;
  if not found then
    raise exception 'Não há domingo ativo para encerrar.' using errcode = 'P0001';
  end if;

  update public.orders
  set payment_status = 'expired'
  where sales_event_id = sale.id and payment_status = 'reserved';

  update public.sales_events as event set is_active = false where event.id = sale.id;
end;
$$;

revoke all on function public.end_active_sale_event() from public;
grant execute on function public.end_active_sale_event() to authenticated;
