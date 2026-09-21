# AI Phone

Una llamada telefónica produce un pedido en Supabase. Varios negocios comparten el mismo servidor; cada uno ve solo sus pedidos.

```
Cliente marca 662 del negocio
  → Telcel desvía al DID Twilio de ESE negocio
  → Voice server (cuota de minutos)
      → hay minutos: OpenAI toma el pedido
      → no hay minutos: Twilio marca overflow_phone
  → Dashboard del usuario de ese negocio
```

## Lo que ya hace el código

- Un login por negocio (Supabase Auth + `profiles.business_id`)
- Pedidos con ítems, domicilio o recoger, nombre, total, efectivo/transferencia
- Eliminar pedido
- Modal de conversación (transcripción IA–cliente)
- Aviso al llegar a 800 min; tope 900 min/mes (Hermosillo)
- Sin minutos: no entra la IA; se hace `<Dial>` a `overflow_phone`

## Tú pegas en Supabase

1. Si el proyecto es nuevo: `supabase/schema.sql`
2. Después **siempre**: [`supabase/migration_multitenant.sql`](supabase/migration_multitenant.sql)

Eso agrega `twilio_phone`, `overflow_phone`, límites y `payment_method`. Pizza Demo queda con `twilio_phone = +14632620761` si aún no tenía DID.

Para probar el desvío sin gastar 900 min:

```sql
update public.businesses
set monthly_minute_limit = 1,
    minute_warning = 1,
    overflow_phone = '+52XXXXXXXXXX'
where name = 'Pizza Demo';
```

(`overflow_phone` debe ser **otro** celular, sin desvío a Twilio. Si pones el mismo 662 desviado incondicionalmente, la llamada se cicla.)

## Por cada negocio (tú en consolas)

| Campo | Dónde |
|--------|--------|
| Nombre, 662 | `businesses.phone` |
| Número Twilio E.164 (`+1...`) | `businesses.twilio_phone` **único** |
| Celular de respaldo | `businesses.overflow_phone` |
| Usuario Auth email/password | Authentication → Users |
| `profiles` | `id` = UID Auth, `business_id` del local |
| Menú | `products` de ese `business_id` |
| Webhook de voz POST | `https://TU-NGROK/twilio/voice` (el mismo URL para todos los DID) |

Tabla para copiar:

```
negocio | 662 | twilio_phone | overflow_phone | email
--------|-----|--------------|----------------|------
Pizza Demo | +52662... | +14632620761 | +52... | dueño@...
```

### Desvío 662

En Telcel: desvío **hacia el DID Twilio de ese local**.  
El 662 público se queda; Twilio identifica el negocio por el `To` del webhook.

Sin minutos, el código marca `overflow_phone`. Ese número **no** debe estar desviado a Twilio.

### Cobro

$2,500–$3,000/mes y conseguir clientes **no está en el software**. Recargar minutos = tú subes `monthly_minute_limit` en SQL (el dashboard dice “contacta a soporte”).

## Apps locales

Voice server (`BUSINESS_ID` es opcional; el DID en la tabla manda):

```bash
cd voice-server
npm install
npm run dev
```

Dashboard:

```bash
cd dashboard
```

`.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPPORT_CONTACT` (texto del aviso de 800 min)

```bash
npm install
npm run dev
```

Login: `http://localhost:3000` con el email/password de Auth de **ese** negocio.

ngrok al 3001. En producción usa un VPS, no ngrok gratis, para 20 locales.

`VALIDATE_TWILIO_SIGNATURE=false` en local; `true` en producción.

## Lo que el código no hace

- Comprar 20 números Twilio
- Configurar desvío Telcel
- Crear 20 usuarios y contraseñas
- Stripe / facturación
- Hosting
