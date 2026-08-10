create extension if not exists pgcrypto;

create table public.sales_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date not null,
  product_name text not null default 'Combo Hambúrguer PIBG',
  price_cents integer not null default 2500 check (price_cents > 0),
  stock_total integer not null check (stock_total >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  confirmed_quantity integer not null default 0 check (confirmed_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reserved_quantity + confirmed_quantity <= stock_total)
);

create unique index sales_events_one_active_idx on public.sales_events (is_active) where is_active;

create sequence public.pickup_code_sequence start with 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  sales_event_id uuid not null references public.sales_events(id),
  code text unique,
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  customer_phone text not null check (char_length(customer_phone) between 10 and 24),
  source text not null check (source in ('online', 'manual')),
  payment_status text not null check (payment_status in ('reserved', 'confirmed', 'expired')),
  kitchen_status text not null default 'new' check (kitchen_status in ('new', 'grill', 'ready')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 10),
  kitchen_note text not null default '' check (char_length(kitchen_note) <= 300),
  access_token uuid not null default gen_random_uuid() unique,
  reserved_until timestamptz,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_status = 'reserved' and reserved_until is not null) or payment_status <> 'reserved')
);

create index orders_sales_event_idx on public.orders (sales_event_id, created_at desc);
create index orders_reserved_until_idx on public.orders (reserved_until) where payment_status = 'reserved';

create table public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'team')),
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sales_events_touch_updated_at
before update on public.sales_events
for each row execute function public.touch_updated_at();

create trigger orders_touch_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

alter table public.sales_events enable row level security;
alter table public.orders enable row level security;
alter table public.team_members enable row level security;

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members where user_id = auth.uid()
  );
$$;

create policy "Public reads the active sale" on public.sales_events
for select to anon, authenticated
using (is_active = true);

create policy "Team members read orders" on public.orders
for select to authenticated
using (public.is_team_member());

revoke all on public.sales_events, public.orders, public.team_members from anon, authenticated;
grant select on public.sales_events to anon, authenticated;
grant select on public.orders to authenticated;

create or replace function public.reserve_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
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
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Itens inválidos.' using errcode = '22023';
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

  select * into sale from public.sales_events where id = sale.id for update;
  if sale.stock_total - sale.reserved_quantity - sale.confirmed_quantity < item_count then
    raise exception 'Estoque esgotado para esta quantidade.' using errcode = 'P0001';
  end if;

  insert into public.orders (
    sales_event_id, customer_name, customer_phone, source, payment_status, items, reserved_until
  ) values (
    sale.id, trim(p_customer_name), trim(p_customer_phone), 'online', 'reserved', p_items, reservation_expiry
  ) returning * into new_order;

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

  select * into sale from public.sales_events where id = current_order.sales_event_id for update;
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

create or replace function public.create_manual_order(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_kitchen_note text default ''
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
    or length(regexp_replace(coalesce(p_customer_phone, ''), '\\D', '', 'g')) not between 10 and 15 then
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

  insert into public.orders (
    sales_event_id, code, customer_name, customer_phone, source, payment_status, items, kitchen_note, confirmed_at
  ) values (
    sale.id, pickup_code, trim(p_customer_name), trim(p_customer_phone), 'manual', 'confirmed', p_items,
    trim(coalesce(p_kitchen_note, '')), now()
  );

  update public.sales_events
  set confirmed_quantity = confirmed_quantity + item_count
  where id = sale.id
  returning stock_total - reserved_quantity - confirmed_quantity into remaining_stock;

  return query select pickup_code, remaining_stock;
end;
$$;

create or replace function public.list_team_orders()
returns table(
  id uuid, code text, customer_name text, customer_phone text, source text, payment_status text,
  kitchen_status text, items jsonb, kitchen_note text, withdrawn_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.code, o.customer_name, o.customer_phone, o.source, o.payment_status,
    o.kitchen_status, o.items, o.kitchen_note, o.withdrawn_at, o.created_at
  from public.orders o
  join public.sales_events s on s.id = o.sales_event_id
  where s.is_active and public.is_team_member() and o.payment_status = 'confirmed'
  order by o.created_at asc;
$$;

create or replace function public.set_kitchen_status(p_order_id uuid, p_kitchen_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_member() or p_kitchen_status not in ('new', 'grill', 'ready') then
    raise exception 'Ação não autorizada.' using errcode = '42501';
  end if;
  update public.orders set kitchen_status = p_kitchen_status
  where id = p_order_id and payment_status = 'confirmed' and withdrawn_at is null;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.mark_order_withdrawn(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_member() then
    raise exception 'Ação não autorizada.' using errcode = '42501';
  end if;
  update public.orders set withdrawn_at = coalesce(withdrawn_at, now())
  where id = p_order_id and payment_status = 'confirmed';
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.reserve_order(text, text, jsonb) from public;
revoke all on function public.confirm_order(uuid, uuid) from public;
revoke all on function public.create_manual_order(text, text, jsonb, text) from public;
revoke all on function public.list_team_orders() from public;
revoke all on function public.set_kitchen_status(uuid, text) from public;
revoke all on function public.mark_order_withdrawn(uuid) from public;
grant execute on function public.reserve_order(text, text, jsonb) to anon, authenticated;
grant execute on function public.confirm_order(uuid, uuid) to anon, authenticated;
grant execute on function public.create_manual_order(text, text, jsonb, text) to authenticated;
grant execute on function public.list_team_orders() to authenticated;
grant execute on function public.set_kitchen_status(uuid, text) to authenticated;
grant execute on function public.mark_order_withdrawn(uuid) to authenticated;

insert into public.sales_events (name, event_date, stock_total)
values ('Hambúrguer PIBG — Próximo domingo', current_date, 150)
on conflict do nothing;

do $$
begin
  alter publication supabase_realtime add table public.sales_events;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end;
$$;
