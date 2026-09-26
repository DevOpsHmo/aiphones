-- Pegar en el SQL Editor de Supabase (después de schema.sql).

alter table public.businesses
  add column if not exists twilio_phone text,
  add column if not exists overflow_phone text,
  add column if not exists monthly_minute_limit integer not null default 1000,
  add column if not exists minute_warning integer not null default 800;

create unique index if not exists businesses_twilio_phone_idx
on public.businesses (twilio_phone)
where twilio_phone is not null;

alter table public.orders
  add column if not exists payment_method text;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (
    payment_method is null
    or payment_method in ('efectivo', 'transferencia')
  );

create index if not exists calls_business_started_idx
on public.calls (business_id, started_at);

drop policy if exists "orders_delete_own" on public.orders;

create policy "orders_delete_own"
on public.orders
for delete
to authenticated
using (
  business_id in (
    select business_id
    from public.profiles
    where id = auth.uid()
  )
);

-- Pizzería Hermosillo: número Twilio de prueba que ya tienes.
update public.businesses
set twilio_phone = '+14632620761'
where name in ('Pizzería Hermosillo', 'Pizza Demo')
  and twilio_phone is null;

update public.businesses
set name = 'Pizzería Hermosillo'
where name = 'Pizza Demo';
