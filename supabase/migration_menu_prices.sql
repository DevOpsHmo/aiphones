-- Precios editables desde la pantalla Menú.
-- Pegar en el SQL Editor de Supabase.

create table if not exists public.menu_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  mediana numeric(10,2) not null default 200,
  grande numeric(10,2) not null default 220,
  familiar numeric(10,2) not null default 250,
  extra numeric(10,2) not null default 25,
  promo_pair numeric(10,2) not null default 400
);

alter table public.menu_settings enable row level security;

drop policy if exists "menu_settings_select_own" on public.menu_settings;
create policy "menu_settings_select_own"
on public.menu_settings
for select
to authenticated
using (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
);

drop policy if exists "menu_settings_insert_own" on public.menu_settings;
create policy "menu_settings_insert_own"
on public.menu_settings
for insert
to authenticated
with check (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
);

drop policy if exists "menu_settings_update_own" on public.menu_settings;
create policy "menu_settings_update_own"
on public.menu_settings
for update
to authenticated
using (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
)
with check (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
);

grant select, insert, update on public.menu_settings to authenticated;

insert into public.menu_settings (business_id)
select id from public.businesses
on conflict (business_id) do nothing;

insert into public.menu_ingredients (business_id, name)
select businesses.id, ingredient.name
from public.businesses
cross join (
  values
    ('orilla rellena de queso'),
    ('queso extra')
) as ingredient(name)
on conflict (business_id, name) do nothing;
