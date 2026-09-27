# Auditoría de precios y confirmación

Corrida: `node --test src/audit.test.js src/production-final.test.js src/catalog-price.test.js` en `voice-server`, 2026-09-27.

## Tests

- Total: 909
- PASS: 909
- FAIL: 0
- SKIPPED: 0
- Nuevas en esta pasada: 33, en `src/catalog-price.test.js`
- Anteriores que siguieron pasando: 876

## Catálogo real

- Mediana 200, grande 220, familiar 250.
- El único extra cobrable es champiñones, +25, una vez por pizza.
- Queso no existe. No se cobra. La frase pide dejarlo fuera.
- Repetir champiñones en la lista no suma 50. El catálogo no tiene un segundo extra de 25, así que dos extras distintos de 25 no se pueden probar con el menú real.

## Regla de cantidad

`priceLine` hace cantidad × (precio del tamaño + extras distintos). Dos pizzas mediana con champiñones son 450, no 200×2+25.

## Confirmación

`buildConfirmation` escribe el total. Si el total dicho no es el calculado, rechaza. `reviseDraft` invalida el texto anterior.

## Qué se encontró y se corrigió

- «Cambia los champiñones» se tomaba como agregar. Ahora pide aclaración y no mueve el precio.
- «Queso» no tiene precio. Ahora se rechaza en vez de ignorarse en silencio dentro de una frase que también dice champiñones.
- La cantidad dicha («dos», «tres») no entraba al estado. Ahora sí, y el total se vuelve a calcular.

## Qué se probó

- UNIT TESTED: las 909 pruebas.
- IN-MEMORY SIMULATED: el candado de `call_id` de la pasada anterior.
- INTEGRATION TESTED: no.
- DATABASE TESTED: no. `supabase/migration_orders_call_id_unique.sql` sigue sin aplicarse.
- NOT TESTED: Twilio, gpt-realtime, una llamada de teléfono.

## Riesgos

- Sin el índice único, dos procesos pueden guardar dos pedidos del mismo `call_id`.
- El modelo puede no leer el campo `spoken` en una llamada real.
- El ruido no se probó en un teléfono.

## Antes de confiar en llamadas reales

Aplicar el índice único en Supabase, desplegar este código y hacer una llamada de prueba. Hasta entonces la idempotencia de producción no está demostrada.
