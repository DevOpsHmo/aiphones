-- Cierra la política abierta de 0001_init.sql y deja solo el aislamiento por negocio.
-- Idempotente. No toca datos. Ejecutar en el SQL Editor de Supabase.

alter table public.businesses enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.calls enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "auth full access" on public.customers;
drop policy if exists "auth full access" on public.products;
drop policy if exists "auth full access" on public.orders;
drop policy if exists "auth full access" on public.calls;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "business_select_own" on public.businesses;
create policy "business_select_own"
on public.businesses
for select
to authenticated
using (
  id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "products_select_own" on public.products;
create policy "products_select_own"
on public.products
for select
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own"
on public.products
for insert
to authenticated
with check (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own"
on public.products
for update
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
)
with check (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "customers_select_own" on public.customers;
create policy "customers_select_own"
on public.customers
for select
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "calls_select_own" on public.calls;
create policy "calls_select_own"
on public.calls
for select
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
on public.orders
for select
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "orders_update_own" on public.orders;
create policy "orders_update_own"
on public.orders
for update
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
)
with check (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "orders_delete_own" on public.orders;
create policy "orders_delete_own"
on public.orders
for delete
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
);

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own"
on public.order_items
for select
to authenticated
using (
  order_id in (
    select o.id
    from public.orders o
    where o.business_id in (
      select business_id from public.profiles where id = auth.uid()
    )
  )
);
