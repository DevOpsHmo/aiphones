-- Permite borrar productos e ingredientes desde la pantalla Menú.
-- Pegar en el SQL Editor de Supabase.

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own"
on public.products
for delete
to authenticated
using (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
);

drop policy if exists "menu_ingredients_delete_own" on public.menu_ingredients;
create policy "menu_ingredients_delete_own"
on public.menu_ingredients
for delete
to authenticated
using (
  business_id in (select business_id from public.profiles where id = auth.uid())
  or not exists (select 1 from public.profiles where id = auth.uid())
);

grant delete on public.products to authenticated;
grant delete on public.menu_ingredients to authenticated;
