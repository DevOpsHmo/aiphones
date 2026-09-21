-- Pegar en el SQL Editor de Supabase.

alter table public.orders
  add column if not exists paid boolean not null default false;

alter table public.orders
  add column if not exists notes text;

alter table public.orders
  add column if not exists order_number text;

alter table public.orders
  add column if not exists deleted_at timestamptz;

create index if not exists orders_deleted_at_idx
on public.orders (business_id, deleted_at);

alter table public.businesses
  add column if not exists minutes_reset_at date not null default '2026-10-31';
