-- Pegar en el SQL Editor de Supabase.

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (
    payment_method is null
    or payment_method in ('efectivo', 'transferencia', 'tarjeta')
  );

create unique index if not exists orders_business_order_number_uidx
on public.orders (business_id, order_number)
where order_number is not null and length(trim(order_number)) > 0;

create or replace function public.next_order_number(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform 1 from public.businesses where id = p_business_id for update;

  select coalesce(max(order_number::integer), 0) + 1
  into n
  from public.orders
  where business_id = p_business_id
    and order_number ~ '^[0-9]+$';

  return n::text;
end;
$$;

grant execute on function public.next_order_number(uuid) to service_role;
grant execute on function public.next_order_number(uuid) to authenticated;
