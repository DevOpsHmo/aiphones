create extension if not exists pgcrypto;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  category text,
  price numeric(10,2) not null check (price >= 0),
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create index products_business_id_idx
on public.products(business_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create index customers_business_id_idx
on public.customers(business_id);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  twilio_call_sid text unique,
  caller_phone text,
  status text not null default 'in_progress',
  transcript text,
  duration_seconds integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index calls_business_id_idx
on public.calls(business_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,

  order_type text not null
    check (order_type in ('pickup', 'delivery')),

  address text,

  status text not null default 'new'
    check (status in ('new', 'preparing', 'ready', 'delivering', 'completed', 'cancelled')),

  total numeric(10,2) not null check (total >= 0),

  created_at timestamptz not null default now()
);

create index orders_business_id_idx
on public.orders(business_id);

create index orders_created_at_idx
on public.orders(created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.orders(id) on delete cascade,

  product_id uuid not null references public.products(id),

  name text not null,

  quantity integer not null check (quantity > 0),

  unit_price numeric(10,2) not null check (unit_price >= 0),

  subtotal numeric(10,2) not null check (subtotal >= 0)
);

create index order_items_order_id_idx
on public.order_items(order_id);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  business_id uuid not null references public.businesses(id) on delete cascade,

  full_name text,

  created_at timestamptz not null default now()
);

create index profiles_business_id_idx
on public.profiles(business_id);

alter table public.businesses enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.calls enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
);

create policy "business_select_own"
on public.businesses
for select
to authenticated
using (
  id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "products_select_own"
on public.products
for select
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "products_insert_own"
on public.products
for insert
to authenticated
with check (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "products_update_own"
on public.products
for update
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
)
with check (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "customers_select_own"
on public.customers
for select
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "calls_select_own"
on public.calls
for select
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "orders_select_own"
on public.orders
for select
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "orders_update_own"
on public.orders
for update
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
)
with check (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

create policy "order_items_select_own"
on public.order_items
for select
to authenticated
using (
  order_id in (
    select o.id
    from public.orders o
    where o.business_id in (
      select business_id
      from public.profiles
      where id = auth.uid()
    )
  )
);

alter publication supabase_realtime
add table public.orders;

insert into public.businesses (
  name,
  phone
)
values (
  'Pizzería Hermosillo',
  '6620000000'
)
returning id;

-- Después agrega los productos con el business_id que Supabase te devuelva:
--
-- insert into public.products
-- (business_id, name, description, category, price)
-- values
-- (
--   'PEGA_BUSINESS_ID',
--   'Pizza Pepperoni Grande',
--   'Pizza grande de pepperoni',
--   'Pizzas',
--   189
-- ),
-- (
--   'PEGA_BUSINESS_ID',
--   'Pizza Hawaiana Grande',
--   'Pizza grande hawaiana',
--   'Pizzas',
--   199
-- ),
-- (
--   'PEGA_BUSINESS_ID',
--   'Coca-Cola 600ml',
--   'Refresco Coca-Cola 600ml',
--   'Bebidas',
--   30
-- ),
-- (
--   'PEGA_BUSINESS_ID',
--   'Agua 600ml',
--   'Agua embotellada 600ml',
--   'Bebidas',
--   20
-- );
