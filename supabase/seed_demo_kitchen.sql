-- Pegar en el SQL Editor DESPUÉS de migration_dashboard_persistence.sql.
-- No vuelvas a pegar schema.sql si ya tienes tablas (error 42P07).

alter table public.orders
  add column if not exists lat double precision;

alter table public.orders
  add column if not exists lng double precision;

alter table public.orders
  add column if not exists timer_paused_at timestamptz;

alter table public.order_items
  add column if not exists notes text;

do $$
declare
  bid uuid;
begin
  select id into bid from public.businesses where name in ('Pizzería Hermosillo', 'Pizza Demo') limit 1;
  if bid is null then
    select id into bid from public.businesses order by created_at limit 1;
  end if;
  if bid is null then
    insert into public.businesses (name, phone)
    values ('Pizzería Hermosillo', '6620000000')
    returning id into bid;
  end if;

  update public.businesses
  set
    name = 'Pizzería Hermosillo',
    monthly_minute_limit = coalesce(monthly_minute_limit, 900),
    minute_warning = coalesce(minute_warning, 800),
    minutes_reset_at = coalesce(minutes_reset_at, '2026-10-31')
  where id = bid;

  insert into public.products (id, business_id, name, description, category, price)
  values
    ('11111111-1111-4111-8111-111111111101', bid, 'Pizza Pepperoni Grande', 'Pizza grande de pepperoni', 'Pizzas', 189),
    ('11111111-1111-4111-8111-111111111102', bid, 'Pizza Hawaiana Grande', 'Pizza grande hawaiana', 'Pizzas', 199),
    ('11111111-1111-4111-8111-111111111103', bid, 'Coca-Cola 600ml', 'Refresco Coca-Cola 600ml', 'Bebidas', 30),
    ('11111111-1111-4111-8111-111111111104', bid, 'Agua 600ml', 'Agua embotellada 600ml', 'Bebidas', 20)
  on conflict (id) do update
  set
    business_id = excluded.business_id,
    name = excluded.name,
    price = excluded.price,
    available = true;

  insert into public.customers (id, business_id, name, phone, address)
  values
    ('22222222-2222-4222-8222-222222222201', bid, 'Diana López', '6621112233', 'Blvd. Luis Encinas Johnson 312, Col. Pitic, C.P. 83150, Hermosillo, Sonora, México'),
    ('22222222-2222-4222-8222-222222222202', bid, 'Alfonso Ruiz', '6622223344', 'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México'),
    ('22222222-2222-4222-8222-222222222203', bid, 'Sofía Navarro', '6623334455', 'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México'),
    ('22222222-2222-4222-8222-222222222204', bid, 'Carlos Méndez', '6624445566', 'Calle Reforma 88, Col. Centro, C.P. 83000, Hermosillo, Sonora, México'),
    ('22222222-2222-4222-8222-222222222205', bid, 'Ana Gutiérrez', '6625556677', 'Av. Universidad 1500, Col. Sahuaro, C.P. 83170, Hermosillo, Sonora, México'),
    ('22222222-2222-4222-8222-222222222206', bid, 'Luis Juarez', '6626667788', 'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México')
  on conflict (id) do update
  set name = excluded.name, phone = excluded.phone, address = excluded.address, business_id = excluded.business_id;

  insert into public.calls (
    id, business_id, twilio_call_sid, caller_phone, status, transcript, duration_seconds, started_at, ended_at
  )
  values
    (
      '33333333-3333-4333-8333-333333333301', bid, 'demo-sid-new', '6621112233', 'completed',
      $t$IA: Buenas tardes, Pizzería Hermosillo, ¿en qué le ayudo?
Cliente: Eh… buenas, ¿sí me oyen?
IA: Sí, sí le escucho. Dime.
Cliente: Quiero una pepperoni grande… y una coca.
IA: Una Pizza Pepperoni Grande y una Coca-Cola de seiscientos. ¿Algo más?
Cliente: No, eso es todo.
IA: ¿A nombre de quién va el pedido?
Cliente: Diana López.
IA: Gracias, Diana. ¿Es para recoger o a domicilio?
Cliente: A domicilio.
IA: ¿Me da la dirección completa?
Cliente: Está en el Kino… bueno, Blvd. Luis Encinas Johnson 312, colonia Pitic.
IA: Luis Encinas 312, Pitic. ¿Paga en efectivo, transferencia o tarjeta?
Cliente: Efectivo.
IA: Perfecto. Entonces: una pepperoni grande, una coca, 219 pesos, a Encinas 312, Pitic, en efectivo. ¿Confirmas tu pedido?
Cliente: Sí, así está bien.
IA: Listo, ya quedó. Gracias por llamar a Pizzería Hermosillo.$t$,
      190, now() - interval '8 minutes', now() - interval '5 minutes'
    ),
    (
      '33333333-3333-4333-8333-333333333302', bid, 'demo-sid-preparing', '6622223344', 'completed',
      $t$IA: Pizzería Hermosillo, buenas tardes.
Cliente: Qué tal, quiero dos hawaianas grandes para recoger.
IA: Dos Pizza Hawaiana Grande para recoger. ¿Con todo?
Cliente: Sin jamón, por favor.
IA: Ok, las dos sin jamón. ¿Llevan bebida?
Cliente: Un agua.
IA: Un Agua de seiscientos. ¿A nombre de quién?
Cliente: Alfonso Ruiz.
IA: Alfonso. ¿Cómo va a pagar?
Cliente: Transferencia.
IA: Dos hawaianas grandes sin jamón y un agua, 418 pesos, para recoger, transferencia. ¿Lo confirmas?
Cliente: Sí, correcto.
IA: Quedó registrado. Te esperamos aquí en sucursal.$t$,
      220, now() - interval '18 minutes', now() - interval '14 minutes'
    ),
    (
      '33333333-3333-4333-8333-333333333303', bid, 'demo-sid-ready', '6623334455', 'completed',
      $t$IA: Pizzería Hermosillo, ¿qué se le ofrece?
Cliente: Hola, una pepperoni, un agua y una coca, para recoger.
IA: Pepperoni grande, agua y coca. ¿Nombre?
Cliente: Sofía Navarro.
IA: Sofía, ¿efectivo, transferencia o tarjeta?
Cliente: Efectivo.
IA: Son 239 pesos, para recoger, en efectivo. ¿Confirmas?
Cliente: Sí.
IA: Listo, Sofía. En unos minutos te avisamos.$t$,
      160, now() - interval '34 minutes', now() - interval '31 minutes'
    ),
    (
      '33333333-3333-4333-8333-333333333304', bid, 'demo-sid-delivering', '6624445566', 'completed',
      $t$IA: Buenas, Pizzería Hermosillo.
Cliente: Quiero una hawaiana y una pepperoni… y una coca, a domicilio.
IA: Las dos grandes, ¿verdad?
Cliente: Sí, las grandes.
IA: ¿A nombre de quién y a qué dirección?
Cliente: Carlos Méndez. Calle Reforma 88, colonia Centro.
IA: Reforma 88, Centro. ¿Cómo paga?
Cliente: Transferencia.
IA: Una hawaiana, una pepperoni y una coca, 418 pesos a Reforma 88. ¿Confirmas el pedido?
Cliente: Sí, mande.
IA: Ya quedó. Gracias, Carlos.$t$,
      240, now() - interval '52 minutes', now() - interval '48 minutes'
    ),
    (
      '33333333-3333-4333-8333-333333333305', bid, 'demo-sid-completed', '6625556677', 'completed',
      $t$IA: Pizzería Hermosillo, buenas tardes.
Cliente: Una hawaiana, una coca y un agua, porfa.
IA: ¿Para recoger o se la llevamos?
Cliente: A domicilio. Ana Gutiérrez.
IA: ¿La dirección, Ana?
Cliente: Avenida Universidad 1500, colonia Sahuaro.
IA: Universidad 1500, Sahuaro. ¿Pago?
Cliente: Efectivo.
IA: 249 pesos a domicilio, efectivo. ¿Lo confirmas?
Cliente: Sí, confirmo.
IA: Perfecto, ya está en sistema. Gracias por llamar.$t$,
      180, now() - interval '132 minutes', now() - interval '129 minutes'
    ),
    (
      '33333333-3333-4333-8333-333333333306', bid, 'demo-sid-cancelled', '6626667788', 'completed',
      $t$IA: Pizzería Hermosillo, ¿en qué le ayudo?
Cliente: Una pepperoni para recoger. Luis Juarez.
IA: Una Pizza Pepperoni Grande, 189 pesos, para recoger. ¿Efectivo?
Cliente: Sí… ay, espérame.
IA: Claro.
Cliente: Mejor cancélalo, al rato marco.
IA: No hay problema, Luis. Pedido cancelado. Cuando guste volvemos a tomarlo.$t$,
      90, now() - interval '192 minutes', now() - interval '190 minutes'
    )
  on conflict (id) do update
  set
    transcript = excluded.transcript,
    duration_seconds = excluded.duration_seconds,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    status = excluded.status,
    business_id = excluded.business_id;

  insert into public.orders (
    id, business_id, call_id, customer_id, order_type, address, lat, lng,
    status, total, payment_method, paid, notes, order_number, created_at, timer_paused_at, deleted_at
  )
  values
    (
      '44444444-4444-4444-8444-444444444401', bid,
      '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201',
      'delivery',
      'Blvd. Luis Encinas Johnson 312, Col. Pitic, C.P. 83150, Hermosillo, Sonora, México',
      29.102186, -110.977418, 'new', 219, 'efectivo', false, 'Dejar con el vecino', '142',
      now(), null, null
    ),
    (
      '44444444-4444-4444-8444-444444444402', bid,
      '33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222202',
      'pickup',
      'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México',
      29.089412, -110.961287, 'preparing', 418, 'transferencia', false, null, '143',
      now() - interval '12 minutes', null, null
    ),
    (
      '44444444-4444-4444-8444-444444444403', bid,
      '33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222203',
      'pickup',
      'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México',
      29.089412, -110.961287, 'ready', 239, 'efectivo', false, null, '144',
      now() - interval '28 minutes', now(), null
    ),
    (
      '44444444-4444-4444-8444-444444444404', bid,
      '33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222204',
      'delivery',
      'Calle Reforma 88, Col. Centro, C.P. 83000, Hermosillo, Sonora, México',
      29.075541, -110.958724, 'delivering', 418, 'transferencia', false, null, '145',
      now() - interval '45 minutes', null, null
    ),
    (
      '44444444-4444-4444-8444-444444444405', bid,
      '33333333-3333-4333-8333-333333333305', '22222222-2222-4222-8222-222222222205',
      'delivery',
      'Av. Universidad 1500, Col. Sahuaro, C.P. 83170, Hermosillo, Sonora, México',
      29.083214, -110.960452, 'completed', 249, 'efectivo', false, null, '146',
      now() - interval '2 hours', null, null
    ),
    (
      '44444444-4444-4444-8444-444444444406', bid,
      '33333333-3333-4333-8333-333333333306', '22222222-2222-4222-8222-222222222206',
      'pickup',
      'Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México',
      29.089412, -110.961287, 'cancelled', 189, 'efectivo', false, null, '147',
      now() - interval '3 hours', null, null
    )
  on conflict (id) do update
  set
    business_id = excluded.business_id,
    call_id = excluded.call_id,
    customer_id = excluded.customer_id,
    order_type = excluded.order_type,
    address = excluded.address,
    lat = excluded.lat,
    lng = excluded.lng,
    status = excluded.status,
    total = excluded.total,
    payment_method = excluded.payment_method,
    paid = excluded.paid,
    notes = excluded.notes,
    order_number = excluded.order_number,
    created_at = excluded.created_at,
    timer_paused_at = excluded.timer_paused_at,
    deleted_at = null;

  delete from public.order_items
  where order_id in (
    '44444444-4444-4444-8444-444444444401',
    '44444444-4444-4444-8444-444444444402',
    '44444444-4444-4444-8444-444444444403',
    '44444444-4444-4444-8444-444444444404',
    '44444444-4444-4444-8444-444444444405',
    '44444444-4444-4444-8444-444444444406'
  );

  insert into public.order_items (order_id, product_id, name, quantity, unit_price, subtotal, notes)
  values
    ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111101', 'Pizza Pepperoni Grande', 1, 189, 189, null),
    ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111103', 'Coca-Cola 600ml', 1, 30, 30, null),
    ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111102', 'Pizza Hawaiana Grande', 2, 199, 398, 'Sin jamón'),
    ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111104', 'Agua 600ml', 1, 20, 20, null),
    ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111101', 'Pizza Pepperoni Grande', 1, 189, 189, 'Sin cebolla'),
    ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'Agua 600ml', 1, 20, 20, null),
    ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111103', 'Coca-Cola 600ml', 1, 30, 30, null),
    ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111102', 'Pizza Hawaiana Grande', 1, 199, 199, null),
    ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111101', 'Pizza Pepperoni Grande', 1, 189, 189, null),
    ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111103', 'Coca-Cola 600ml', 1, 30, 30, null),
    ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111102', 'Pizza Hawaiana Grande', 1, 199, 199, null),
    ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111103', 'Coca-Cola 600ml', 1, 30, 30, null),
    ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111104', 'Agua 600ml', 1, 20, 20, null),
    ('44444444-4444-4444-8444-444444444406', '11111111-1111-4111-8111-111111111101', 'Pizza Pepperoni Grande', 1, 189, 189, null);
end $$;

-- Vincula tu usuario de Auth al negocio (reemplaza el UUID):
-- insert into public.profiles (id, business_id, full_name)
-- select 'PEGA_AQUI_EL_UUID_DE_AUTH_USERS', id, 'Admin'
-- from public.businesses
-- where name = 'Pizzería Hermosillo'
-- on conflict (id) do update set business_id = excluded.business_id;
