-- Horario de la cocina. Pegar en el SQL Editor de Supabase.

alter table public.menu_settings
  add column if not exists open_time text,
  add column if not exists close_time text;
