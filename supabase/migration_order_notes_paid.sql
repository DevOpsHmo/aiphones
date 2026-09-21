alter table public.order_items
  add column if not exists notes text;

alter table public.orders
  add column if not exists paid boolean not null default false;

alter table public.orders
  add column if not exists notes text;
