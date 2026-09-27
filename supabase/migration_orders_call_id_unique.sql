create unique index if not exists orders_call_id_uidx
on public.orders (call_id)
where call_id is not null;
