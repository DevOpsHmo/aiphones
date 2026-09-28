-- Precio propio de extra por ingrediente. Vacío usa el extra general de Precios.
-- Pegar en el SQL Editor de Supabase.

alter table public.menu_ingredients
  add column if not exists extra_price numeric(10,2);
