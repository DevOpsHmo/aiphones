-- Migracion inicial: 4 tablas + RLS + Realtime

create extension if not exists "pgcrypto";

-- 1. CLIENTES
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique,
  name        text,
  address     text,
  created_at  timestamptz not null default now()
);

-- 2. PRODUCTOS
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price       numeric(10,2) not null check (price >= 0),
  category    text not null default 'General',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 3. PEDIDOS
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  items       jsonb not null default '[]'::jsonb,
  total       numeric(10,2) not null default 0,
  status      text not null default 'PENDIENTE'
              check (status in ('PENDIENTE','CONFIRMADO','PREPARANDO','LISTO','ENTREGADO')),
  order_type  text not null default 'pickup' check (order_type in ('pickup','delivery')),
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 4. LLAMADAS
create table if not exists public.calls (
  id          uuid primary key default gen_random_uuid(),
  call_sid    text not null unique,
  "from"      text not null,
  "to"        text not null,
  duration    integer not null default 0,
  transcript  text,
  order_id    uuid references public.orders(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists calls_created_at_idx on public.calls (created_at desc);

-- RLS: un solo usuario autenticado (el dueño del negocio)
alter table public.customers enable row level security;
alter table public.products  enable row level security;
alter table public.orders    enable row level security;
alter table public.calls     enable row level security;

create policy "auth full access" on public.customers for all to authenticated using (true) with check (true);
create policy "auth full access" on public.products  for all to authenticated using (true) with check (true);
create policy "auth full access" on public.orders    for all to authenticated using (true) with check (true);
create policy "auth full access" on public.calls     for all to authenticated using (true) with check (true);

-- updated_at automatico en orders
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Realtime para el dashboard de pedidos
alter table public.orders replica identity full;
alter publication supabase_realtime add table public.orders;
