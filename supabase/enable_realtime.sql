-- Si sale error de que ya está en la publicación, ignóralo.

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then
    null;
end $$;
