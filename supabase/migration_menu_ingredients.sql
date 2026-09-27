-- Ingredientes que el restaurante puede apagar desde la pantalla Menú.
-- Pegar en el SQL Editor de Supabase. No borra productos ni pedidos.

create table if not exists public.menu_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create index if not exists menu_ingredients_business_id_idx
on public.menu_ingredients(business_id);

alter table public.menu_ingredients enable row level security;

drop policy if exists "menu_ingredients_select_own" on public.menu_ingredients;
create policy "menu_ingredients_select_own"
on public.menu_ingredients
for select
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
  or not exists (select 1 from public.profiles where id = auth.uid())
);

drop policy if exists "menu_ingredients_insert_own" on public.menu_ingredients;
create policy "menu_ingredients_insert_own"
on public.menu_ingredients
for insert
to authenticated
with check (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
  or not exists (select 1 from public.profiles where id = auth.uid())
);

drop policy if exists "menu_ingredients_update_own" on public.menu_ingredients;
create policy "menu_ingredients_update_own"
on public.menu_ingredients
for update
to authenticated
using (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
  or not exists (select 1 from public.profiles where id = auth.uid())
)
with check (
  business_id in (
    select business_id from public.profiles where id = auth.uid()
  )
  or not exists (select 1 from public.profiles where id = auth.uid())
);

grant select, insert, update on public.menu_ingredients to authenticated;

insert into public.menu_ingredients (business_id, name)
select businesses.id, ingredient.name
from public.businesses
cross join (
  values
    ('pollo salsa bbq'),
    ('tocino'),
    ('pechuga pollo cilantro'),
    ('pollo salsa chipotle'),
    ('cebolla'),
    ('ostiones'),
    ('pimiento'),
    ('champinones'),
    ('pepperoni'),
    ('jamon'),
    ('pina'),
    ('cereza'),
    ('aceitunas'),
    ('pollo'),
    ('salsa tomate'),
    ('queso mozzarella'),
    ('salsa bufalo'),
    ('tomate'),
    ('albahaca'),
    ('jalapenos'),
    ('chorizo'),
    ('frijoles'),
    ('peperoni'),
    ('chilorio'),
    ('espinacas'),
    ('queso'),
    ('salami'),
    ('orilla rellena de queso'),
    ('queso extra')
) as ingredient(name)
on conflict (business_id, name) do nothing;
