"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import StatsBoard from "./StatsBoard";

type OrderItem = {
  name: string;
  quantity: number;
  subtotal: number;
  notes?: string | null;
};

type Order = {
  id: string;
  order_type: "pickup" | "delivery";
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  total: number;
  created_at: string;
  payment_method: "efectivo" | "transferencia" | "tarjeta" | null;
  paid: boolean;
  notes?: string | null;
  order_number: string;
  deleted_at?: string | null;
  stoppedAt?: number | null;
  call_id: string | null;
  customers: { name: string; phone?: string | null } | null;
  order_items: OrderItem[] | null;
};

type OrderRow = {
  id: string;
  order_type: "pickup" | "delivery";
  address: string | null;
  lat?: number | null;
  lng?: number | null;
  status: string;
  total: number;
  created_at: string;
  payment_method?: "efectivo" | "transferencia" | "tarjeta" | null;
  paid?: boolean | null;
  notes?: string | null;
  order_number?: string | null;
  deleted_at?: string | null;
  timer_paused_at?: string | null;
  call_id: string | null;
  customer_id: string | null;
};

type CallRow = {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  status: string;
};

function supabaseErrorText(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Error al cargar pedidos.";
  }

  const value = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  return (
    [value.message, value.details, value.hint, value.code]
      .filter(Boolean)
      .join(" — ") || JSON.stringify(error)
  );
}

async function hydrateOrders(rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = createClient();
  const orderIds = rows.map(row => row.id);
  const customerIds = [
    ...new Set(
      rows
        .map(row => row.customer_id)
        .filter((id): id is string => Boolean(id))
    )
  ];

  let items:
    | {
        order_id: string;
        name: string;
        quantity: number;
        subtotal: number;
        notes?: string | null;
      }[]
    | null = null;

  const withNotes = await supabase
    .from("order_items")
    .select("order_id,name,quantity,subtotal,notes")
    .in("order_id", orderIds);

  if (withNotes.error) {
    const withoutNotes = await supabase
      .from("order_items")
      .select("order_id,name,quantity,subtotal")
      .in("order_id", orderIds);
    items = withoutNotes.data;
  } else {
    items = withNotes.data;
  }

  const [{ data: customers }] = await Promise.all([
    customerIds.length
      ? supabase
          .from("customers")
          .select("id,name,phone")
          .in("id", customerIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; phone?: string | null }[]
        })
  ]);

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of items || []) {
    const list = itemsByOrder.get(item.order_id) || [];
    list.push({
      name: item.name,
      quantity: item.quantity,
      subtotal: item.subtotal,
      notes: item.notes ?? null
    });
    itemsByOrder.set(item.order_id, list);
  }

  const customerById = new Map(
    (customers || []).map(customer => [
      customer.id,
      { name: customer.name, phone: customer.phone ?? null }
    ])
  );

  const mapped = rows.map(row => ({
    id: row.id,
    order_type: row.order_type,
    address: row.address,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    status: row.status,
    total: row.total,
    created_at: row.created_at,
    payment_method: row.payment_method ?? null,
    paid: Boolean(row.paid),
    notes: row.notes ?? null,
    order_number: normalizeOrderNumber(row.order_number || ""),
    deleted_at: row.deleted_at ?? null,
    stoppedAt: row.timer_paused_at
      ? new Date(row.timer_paused_at).getTime()
      : TIMER_PAUSE_STATUSES.has(row.status)
        ? Date.now()
        : null,
    call_id: row.call_id,
    customers: row.customer_id
      ? customerById.get(row.customer_id) || { name: "Sin nombre", phone: null }
      : null,
    order_items: itemsByOrder.get(row.id) || []
  }));

  return assignOrderNumbers(mapped);
}

function formatLongDate(key: string) {
  const text = new Date(`${key}T12:00:00-07:00`).toLocaleDateString("es-MX", {
    timeZone: "America/Hermosillo",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function minutesCycleWindow(resetAt: string | null | undefined) {
  const today = hermosilloDateKey();
  const fallback = `${today.slice(0, 4)}-10-31`;
  const raw = (resetAt || fallback).slice(0, 10);
  const monthDay = raw.slice(5);
  const year = Number(today.slice(0, 4));
  const thisYearReset = `${year}-${monthDay}`;
  if (today <= thisYearReset) {
    return {
      fromIso: `${year - 1}-${monthDay}T00:00:00-07:00`,
      nextReset: thisYearReset
    };
  }
  return {
    fromIso: `${thisYearReset}T00:00:00-07:00`,
    nextReset: `${year + 1}-${monthDay}`
  };
}

function hermosilloDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Hermosillo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function monthStartHermosilloIso() {
  const key = hermosilloDateKey();
  return `${key.slice(0, 7)}-01T00:00:00-07:00`;
}

function formatDayHeading(key: string) {
  const text = new Date(`${key}T12:00:00-07:00`).toLocaleDateString("es-MX", {
    timeZone: "America/Hermosillo",
    weekday: "long",
    day: "numeric",
    month: "long"
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function monthLabel(year: number, month: number) {
  const text = new Date(Date.UTC(year, month, 1, 19)).toLocaleDateString("es-MX", {
    timeZone: "America/Hermosillo",
    month: "long",
    year: "numeric"
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateKeyFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarCells(year: number, month: number) {
  const start = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array(start).fill(null);

  for (let day = 1; day <= days; day += 1) {
    cells.push(day);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const STORE_LOCATION = {
  address:
    "Blvd. Luis Encinas Johnson 210, Col. San Benito, C.P. 83190, Hermosillo, Sonora, México",
  lat: 29.089412,
  lng: -110.961287
};

function normalizeOrderNumber(value: string) {
  return value.trim().replace(/^#+\s*/, "");
}

function assignOrderNumbers(orders: Order[]) {
  const used = new Set(
    orders
      .map(order => normalizeOrderNumber(order.order_number).toLowerCase())
      .filter(Boolean)
  );
  let next = 142;
  return orders.map(order => {
    if (normalizeOrderNumber(order.order_number)) {
      return order;
    }
    while (used.has(String(next))) {
      next += 1;
    }
    const order_number = String(next);
    used.add(order_number);
    next += 1;
    return { ...order, order_number };
  });
}

function isOrderNumberTaken(
  orders: Order[],
  value: string,
  exceptId: string
) {
  const normalized = normalizeOrderNumber(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return orders.some(
    order =>
      order.id !== exceptId &&
      normalizeOrderNumber(order.order_number).toLowerCase() === normalized
  );
}

function paymentLabel(
  method: Order["payment_method"]
) {
  if (method === "transferencia") return "Transferencia";
  if (method === "efectivo") return "Efectivo";
  if (method === "tarjeta") return "Tarjeta";
  return "No indicado";
}

const DEMO_ORDERS: Order[] = [
  {
    id: "demo-new",
    order_type: "delivery",
    address:
      "Blvd. Luis Encinas Johnson 312, Col. Pitic, C.P. 83150, Hermosillo, Sonora, México",
    lat: 29.102186,
    lng: -110.977418,
    status: "new",
    total: 219,
    created_at: new Date().toISOString(),
    payment_method: "efectivo",
    paid: false,
    notes: "Dejar con el vecino",
    order_number: "142",
    call_id: "demo-call-new",
    customers: { name: "Diana López", phone: "6621112233" },
    order_items: [
      {
        name: "Pizza Pepperoni Grande",
        quantity: 1,
        subtotal: 189
      },
      { name: "Coca-Cola 600ml", quantity: 1, subtotal: 30 }
    ]
  },
  {
    id: "demo-preparing",
    order_type: "pickup",
    address: STORE_LOCATION.address,
    lat: STORE_LOCATION.lat,
    lng: STORE_LOCATION.lng,
    status: "preparing",
    total: 418,
    created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    payment_method: "transferencia",
    paid: false,
    order_number: "143",
    call_id: "demo-call-preparing",
    customers: { name: "Alfonso Ruiz", phone: "6622223344" },
    order_items: [
      {
        name: "Pizza Hawaiana Grande",
        quantity: 2,
        subtotal: 398,
        notes: "Sin jamón"
      },
      { name: "Agua 600ml", quantity: 1, subtotal: 20 }
    ]
  },
  {
    id: "demo-ready",
    order_type: "pickup",
    address: STORE_LOCATION.address,
    lat: STORE_LOCATION.lat,
    lng: STORE_LOCATION.lng,
    status: "ready",
    total: 239,
    created_at: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
    payment_method: "efectivo",
    paid: false,
    order_number: "144",
    stoppedAt: Date.now(),
    call_id: "demo-call-ready",
    customers: { name: "Sofía Navarro", phone: "6623334455" },
    order_items: [
      {
        name: "Pizza Pepperoni Grande",
        quantity: 1,
        subtotal: 189,
        notes: "Sin cebolla"
      },
      { name: "Agua 600ml", quantity: 1, subtotal: 20 },
      { name: "Coca-Cola 600ml", quantity: 1, subtotal: 30 }
    ]
  },
  {
    id: "demo-delivering",
    order_type: "delivery",
    address:
      "Calle Reforma 88, Col. Centro, C.P. 83000, Hermosillo, Sonora, México",
    lat: 29.075541,
    lng: -110.958724,
    status: "delivering",
    total: 418,
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    payment_method: "transferencia",
    paid: false,
    order_number: "145",
    call_id: "demo-call-delivering",
    customers: { name: "Carlos Méndez", phone: "6624445566" },
    order_items: [
      { name: "Pizza Hawaiana Grande", quantity: 1, subtotal: 199 },
      { name: "Pizza Pepperoni Grande", quantity: 1, subtotal: 189 },
      { name: "Coca-Cola 600ml", quantity: 1, subtotal: 30 }
    ]
  },
  {
    id: "demo-completed",
    order_type: "delivery",
    address:
      "Av. Universidad 1500, Col. Sahuaro, C.P. 83170, Hermosillo, Sonora, México",
    lat: 29.083214,
    lng: -110.960452,
    status: "completed",
    total: 249,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    payment_method: "efectivo",
    paid: false,
    order_number: "146",
    call_id: "demo-call-completed",
    customers: { name: "Ana Gutiérrez", phone: "6625556677" },
    order_items: [
      { name: "Pizza Hawaiana Grande", quantity: 1, subtotal: 199 },
      { name: "Coca-Cola 600ml", quantity: 1, subtotal: 30 },
      { name: "Agua 600ml", quantity: 1, subtotal: 20 }
    ]
  },
  {
    id: "demo-cancelled",
    order_type: "pickup",
    address: STORE_LOCATION.address,
    lat: STORE_LOCATION.lat,
    lng: STORE_LOCATION.lng,
    status: "cancelled",
    total: 189,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    payment_method: "efectivo",
    paid: false,
    order_number: "147",
    call_id: "demo-call-cancelled",
    customers: { name: "Luis Juarez", phone: "6626667788" },
    order_items: [
      { name: "Pizza Pepperoni Grande", quantity: 1, subtotal: 189 }
    ]
  }
];

const DEMO_TRANSCRIPTS: Record<string, string> = {
  "demo-call-new": `IA: Buenas tardes, Pizzería Hermosillo, ¿en qué le ayudo?
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
IA: Listo, ya quedó. Gracias por llamar a Pizzería Hermosillo.`,
  "demo-call-preparing": `IA: Pizzería Hermosillo, buenas tardes.
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
IA: Quedó registrado. Te esperamos aquí en sucursal.`,
  "demo-call-ready": `IA: Pizzería Hermosillo, ¿qué se le ofrece?
Cliente: Hola, una pepperoni, un agua y una coca, para recoger.
IA: Pepperoni grande, agua y coca. ¿Nombre?
Cliente: Sofía Navarro.
IA: Sofía, ¿efectivo, transferencia o tarjeta?
Cliente: Efectivo.
IA: Son 239 pesos, para recoger, en efectivo. ¿Confirmas?
Cliente: Sí.
IA: Listo, Sofía. En unos minutos te avisamos.`,
  "demo-call-delivering": `IA: Buenas, Pizzería Hermosillo.
Cliente: Quiero una hawaiana y una pepperoni… y una coca, a domicilio.
IA: Las dos grandes, ¿verdad?
Cliente: Sí, las grandes.
IA: ¿A nombre de quién y a qué dirección?
Cliente: Carlos Méndez. Calle Reforma 88, colonia Centro.
IA: Reforma 88, Centro. ¿Cómo paga?
Cliente: Transferencia.
IA: Una hawaiana, una pepperoni y una coca, 418 pesos a Reforma 88. ¿Confirmas el pedido?
Cliente: Sí, mande.
IA: Ya quedó. Gracias, Carlos.`,
  "demo-call-completed": `IA: Pizzería Hermosillo, buenas tardes.
Cliente: Una hawaiana, una coca y un agua, porfa.
IA: ¿Para recoger o se la llevamos?
Cliente: A domicilio. Ana Gutiérrez.
IA: ¿La dirección, Ana?
Cliente: Avenida Universidad 1500, colonia Sahuaro.
IA: Universidad 1500, Sahuaro. ¿Pago?
Cliente: Efectivo.
IA: 249 pesos a domicilio, efectivo. ¿Lo confirmas?
Cliente: Sí, confirmo.
IA: Perfecto, ya está en sistema. Gracias por llamar.`,
  "demo-call-cancelled": `IA: Pizzería Hermosillo, ¿en qué le ayudo?
Cliente: Una pepperoni para recoger. Luis Juarez.
IA: Una Pizza Pepperoni Grande, 189 pesos, para recoger. ¿Efectivo?
Cliente: Sí… ay, espérame.
IA: Claro.
Cliente: Mejor cancélalo, al rato marco.
IA: No hay problema, Luis. Pedido cancelado. Cuando guste volvemos a tomarlo.`
};

function isDemoOrder(id: string) {
  return id.startsWith("demo-");
}

const STATUS_QUEUE_KEY = "ai-phone-status-queue";

type StatusQueueItem = {
  id: string;
  status: string;
  timer_paused_at: string | null;
};

function readStatusQueue(): StatusQueueItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STATUS_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStatusQueue(items: StatusQueueItem[]) {
  window.localStorage.setItem(STATUS_QUEUE_KEY, JSON.stringify(items));
}

function enqueueStatusChange(item: StatusQueueItem) {
  const next = readStatusQueue().filter(row => row.id !== item.id);
  next.push(item);
  writeStatusQueue(next);
}

const TIMER_PAUSE_STATUSES = new Set(["ready"]);
const TIMER_HIDE_STATUSES = new Set([
  "delivering",
  "completed",
  "cancelled"
]);

function fullDeliveryAddress(address: string) {
  const trimmed = address.trim();
  if (/hermosillo|sonora|méxico|mexico/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}, Hermosillo, Sonora, México`;
}

function orderItemsLines(order: Order) {
  return (order.order_items || []).map(item => {
    const note = item.notes?.trim() ? ` (${item.notes.trim()})` : "";
    return `• ${item.quantity} × ${item.name} ($${Number(item.subtotal).toFixed(2)})${note}`;
  });
}

function mapsPinUrl(order: Order) {
  if (order.address?.trim()) {
    return `https://www.google.com/maps/place/${encodeURIComponent(
      fullDeliveryAddress(order.address)
    )}`;
  }
  if (order.lat != null && order.lng != null) {
    return `https://www.google.com/maps?q=${order.lat},${order.lng}&z=19`;
  }
  return "";
}

function whatsappShareUrl(order: Order) {
  const address = order.address
    ? fullDeliveryAddress(order.address)
    : "";
  const maps = mapsPinUrl(order);
  const name = order.customers?.name || "cliente";
  const coords =
    order.lat != null && order.lng != null
      ? `${order.lat.toFixed(6)}, ${order.lng.toFixed(6)}`
      : "";
  const items = orderItemsLines(order);
  const text = [
    `Pedido #${order.order_number} para ${name}`,
    order.order_type === "pickup" ? "Recoger en sucursal" : "Entrega a domicilio",
    address
      ? order.order_type === "pickup"
        ? `Sucursal: ${address}`
        : `Dirección: ${address}`
      : "",
    items.length ? "Orden:" : "",
    ...items,
    order.notes?.trim() ? `Notas: ${order.notes.trim()}` : "",
    `Total: $${Number(order.total).toFixed(2)} · ${paymentLabel(order.payment_method)}`,
    coords ? `Coordenadas GPS: ${coords}` : "",
    maps ? `Pin exacto: ${maps}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const STATUS_OPTIONS = [
  { value: "new", label: "Nuevo" },
  { value: "preparing", label: "Preparando" },
  { value: "ready", label: "Listo" },
  { value: "delivering", label: "En camino" },
  { value: "completed", label: "Completado" },
  { value: "cancelled", label: "Cancelado" }
] as const;

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  ...STATUS_OPTIONS
] as const;

let doorbellCtx: AudioContext | null = null;

function unlockDoorbell() {
  if (typeof window === "undefined") {
    return;
  }
  const AudioApi =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioApi) {
    return;
  }
  if (!doorbellCtx) {
    doorbellCtx = new AudioApi();
  }
  if (doorbellCtx.state === "suspended") {
    void doorbellCtx.resume();
  }
}

function playDoorbell() {
  unlockDoorbell();
  if (!doorbellCtx) {
    return;
  }
  const ctx = doorbellCtx;
  const now = ctx.currentTime;
  [0, 0.22].forEach((offset, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = index === 0 ? 880 : 1174;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.3);
  });
}

function formatOrderStamp(iso: string) {
  return new Date(iso)
    .toLocaleString("es-MX", {
      timeZone: "America/Hermosillo",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    })
    .replace(/\s+(a\.\s?m\.|p\.\s?m\.)/gi, "\u00a0$1");
}

function relativeTime(iso: string, now: number) {
  const diff = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diff < 60) {
    return `hace ${Math.max(1, diff)} s`;
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} h`;
  }
  return `hace ${Math.floor(hours / 24)} d`;
}

function whatsappDigits(phone?: string | null) {
  if (!phone) {
    return "";
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `52${digits}`;
  }
  return digits;
}

function whatsappCallUrl(phone?: string | null) {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}` : "";
}

function whatsappMessageUrl(phone?: string | null, name?: string | null) {
  const digits = whatsappDigits(phone);
  if (!digits) {
    return "";
  }
  const text = `Hola${name ? ` ${name}` : ""}, te escribimos de Pizzería Hermosillo por tu pedido.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const DEMO_CALLS: CallRow[] = [
  {
    id: "demo-call-new",
    started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    duration_seconds: 95,
    status: "completed"
  },
  {
    id: "demo-call-preparing",
    started_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    duration_seconds: 110,
    status: "completed"
  },
  {
    id: "demo-call-ready",
    started_at: new Date(Date.now() - 34 * 60 * 1000).toISOString(),
    duration_seconds: 80,
    status: "completed"
  },
  {
    id: "demo-call-delivering",
    started_at: new Date(Date.now() - 52 * 60 * 1000).toISOString(),
    duration_seconds: 120,
    status: "completed"
  },
  {
    id: "demo-call-completed",
    started_at: new Date(Date.now() - 2.2 * 60 * 60 * 1000).toISOString(),
    duration_seconds: 90,
    status: "completed"
  },
  {
    id: "demo-call-cancelled",
    started_at: new Date(Date.now() - 3.2 * 60 * 60 * 1000).toISOString(),
    duration_seconds: 45,
    status: "completed"
  }
];

function formatCallClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseTranscript(text: string) {
  let elapsed = 2;
  return text
    .replace(/Pizza Demo/gi, "Pizzería Hermosillo")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      let who = "";
      let body = line;
      if (/^Cliente:/i.test(line)) {
        who = "Cliente";
        body = line.replace(/^Cliente:\s*/i, "");
      } else if (/^(IA|Asistente):/i.test(line)) {
        who = "IA";
        body = line.replace(/^(IA|Asistente):\s*/i, "");
      }
      elapsed += 2 + Math.min(11, Math.ceil(body.length / 22));
      return {
        who,
        text: body,
        at: formatCallClock(elapsed)
      };
    });
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [minutesUsed, setMinutesUsed] = useState(18);
  const [minutesLimit, setMinutesLimit] = useState(1000);
  const [minuteWarning, setMinuteWarning] = useState(800);
  const [chatOrder, setChatOrder] = useState<Order | null>(null);
  const [chatLines, setChatLines] = useState<
    { who: string; text: string; at?: string }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [locationOrder, setLocationOrder] = useState<Order | null>(null);
  const [contactOrder, setContactOrder] = useState<Order | null>(null);
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const todayKey = hermosilloDateKey();
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const [year, month] = todayKey.split("-").map(Number);
    return { year, month: month - 1 };
  });
  const [view, setView] = useState<"orders" | "stats">("orders");
  const [navOpen, setNavOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [nowTick, setNowTick] = useState(0);
  const [trashOpen, setTrashOpen] = useState(false);
  const [minutesResetLabel, setMinutesResetLabel] = useState("31 de octubre 2026");
  const [editingNumberId, setEditingNumberId] = useState<string | null>(null);
  const [numberDraft, setNumberDraft] = useState("");
  const [numberError, setNumberError] = useState("");

  const overlayOpen = Boolean(
    chatOrder ||
      locationOrder ||
      deleteOrderId ||
      contactOrder ||
      payOrder ||
      trashOpen ||
      editingNumberId
  );

  const visibleOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orders
      .filter(order => {
        if (order.deleted_at) {
          return false;
        }
        if (hermosilloDateKey(new Date(order.created_at)) !== selectedDay) {
          return false;
        }
        if (statusFilter !== "all" && order.status !== statusFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [
          order.customers?.name,
          order.order_number,
          order.address,
          ...(order.order_items || []).map(item => item.name)
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const na = Number.parseInt(a.order_number, 10);
        const nb = Number.parseInt(b.order_number, 10);
        const aNum = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
        const bNum = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
        if (aNum !== bNum) {
          return aNum - bNum;
        }
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
  }, [orders, selectedDay, statusFilter, searchQuery]);

  const trashedToday = useMemo(
    () =>
      orders.filter(
        order =>
          Boolean(order.deleted_at) &&
          hermosilloDateKey(new Date(order.created_at)) === selectedDay
      ),
    [orders, selectedDay]
  );

  const support =
    process.env.NEXT_PUBLIC_SUPPORT_CONTACT ||
    "soporte";

  const loadUsage = useCallback(async () => {
    const supabase = createClient();

    const { data: business } = await supabase
      .from("businesses")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (business) {
      setMinutesLimit(Number(business.monthly_minute_limit) || 1000);
      setMinuteWarning(Number(business.minute_warning) || 800);
    }

    const cycle = minutesCycleWindow(
      (business as { minutes_reset_at?: string | null } | null)?.minutes_reset_at
    );
    setMinutesResetLabel(formatLongDate(cycle.nextReset));

    const { data: calls } = await supabase
      .from("calls")
      .select("status,duration_seconds,started_at")
      .neq("status", "overflow")
      .gte("started_at", cycle.fromIso);

    const now = Date.now();
    let seconds = 0;

    for (const call of calls || []) {
      if (call.status === "in_progress" && call.started_at) {
        const elapsed = Math.max(
          0,
          Math.round((now - new Date(call.started_at).getTime()) / 1000)
        );
        if (elapsed <= 20 * 60) {
          seconds += elapsed;
        }
      } else {
        seconds += Number(call.duration_seconds) || 0;
      }
    }

    setMinutesUsed(Math.ceil(seconds / 60));
  }, []);

  const loadOrderById = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const [hydrated] = await hydrateOrders([data as OrderRow]);
    return hydrated || null;
  }, []);

  const loadOrders = useCallback(async () => {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", {
        ascending: false
      });

    if (error) {
      const message = supabaseErrorText(error);
      console.error("loadOrders", message);
      setLoadError(message);
      setOrders(DEMO_ORDERS);
      setLoading(false);
      return;
    }

    setLoadError("");
    const rows = (data || []) as OrderRow[];
    const hydrated = await hydrateOrders(rows);
    setOrders(hydrated.length > 0 ? hydrated : DEMO_ORDERS);
    setLoading(false);

    if (hydrated.length > 0) {
      const missing = rows.filter(
        row => !normalizeOrderNumber(row.order_number || "")
      );
      await Promise.all(
        missing.map(row => {
          const assigned = hydrated.find(order => order.id === row.id);
          if (!assigned?.order_number) {
            return Promise.resolve();
          }
          return supabase
            .from("orders")
            .update({ order_number: assigned.order_number })
            .eq("id", row.id);
        })
      );
    }
  }, []);

  const loadCalls = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("calls")
      .select("id,started_at,duration_seconds,status")
      .neq("status", "overflow")
      .order("started_at", { ascending: false });

    if (error || !data || data.length === 0) {
      setCalls(DEMO_CALLS);
      return;
    }

    setCalls(data as CallRow[]);
  }, []);

  async function updateStatus(id: string, status: string) {
    setOpenStatusId(null);
    const stoppedAt = TIMER_PAUSE_STATUSES.has(status) ? Date.now() : null;
    const timerPausedAt = stoppedAt ? new Date(stoppedAt).toISOString() : null;

    setOrders(current =>
      current.map(order =>
        order.id === id ? { ...order, status, stoppedAt } : order
      )
    );

    if (isDemoOrder(id)) {
      return;
    }

    const payload: StatusQueueItem = {
      id,
      status,
      timer_paused_at: timerPausedAt
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueueStatusChange(payload);
      setToast({
        type: "success",
        message: "Se guardará al reconectar"
      });
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("orders")
      .update({
        status,
        timer_paused_at: timerPausedAt
      })
      .eq("id", id);

    if (error) {
      enqueueStatusChange(payload);
      setToast({
        type: "success",
        message: "Se guardará al reconectar"
      });
      return;
    }
  }

  async function flushStatusQueue() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    const pending = readStatusQueue();
    if (pending.length === 0) {
      return;
    }

    const supabase = createClient();
    const remaining: StatusQueueItem[] = [];

    for (const item of pending) {
      const { error } = await supabase
        .from("orders")
        .update({
          status: item.status,
          timer_paused_at: item.timer_paused_at
        })
        .eq("id", item.id);

      if (error) {
        remaining.push(item);
      }
    }

    writeStatusQueue(remaining);
  }

  async function deleteOrder(id: string) {
    setDeleteOrderId(id);
  }

  async function confirmDeleteOrder() {
    const id = deleteOrderId;
    if (!id) {
      return;
    }

    setDeleteOrderId(null);
    const deletedAt = new Date().toISOString();

    if (isDemoOrder(id)) {
      setOrders(current =>
        current.map(order =>
          order.id === id ? { ...order, deleted_at: deletedAt } : order
        )
      );
      setToast({ type: "success", message: "Pedido enviado a la papelera" });
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("orders")
      .update({ deleted_at: deletedAt })
      .eq("id", id);

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setOrders(current =>
      current.map(order =>
        order.id === id ? { ...order, deleted_at: deletedAt } : order
      )
    );
    setToast({ type: "success", message: "Pedido enviado a la papelera" });
  }

  async function restoreOrder(id: string) {
    const closeIfLast = (remaining: number) => {
      if (remaining === 0) {
        setTrashOpen(false);
      }
    };

    if (isDemoOrder(id)) {
      setOrders(current => {
        const next = current.map(order =>
          order.id === id ? { ...order, deleted_at: null } : order
        );
        closeIfLast(
          next.filter(
            order =>
              Boolean(order.deleted_at) &&
              hermosilloDateKey(new Date(order.created_at)) === selectedDay
          ).length
        );
        return next;
      });
      setToast({ type: "success", message: "Pedido recuperado" });
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("orders")
      .update({ deleted_at: null })
      .eq("id", id);

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setOrders(current => {
      const next = current.map(order =>
        order.id === id ? { ...order, deleted_at: null } : order
      );
      closeIfLast(
        next.filter(
          order =>
            Boolean(order.deleted_at) &&
            hermosilloDateKey(new Date(order.created_at)) === selectedDay
        ).length
      );
      return next;
    });
    setToast({ type: "success", message: "Pedido recuperado" });
  }

  async function openChat(order: Order) {
    setChatOrder(order);
    setChatLines([]);

    if (order.call_id && DEMO_TRANSCRIPTS[order.call_id]) {
      setChatLines(parseTranscript(DEMO_TRANSCRIPTS[order.call_id]));
      return;
    }

    if (!order.call_id) {
      setChatLines([
        {
          who: "",
          text: "Esta orden no tiene transcripción de llamada."
        }
      ]);
      return;
    }

    setChatLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("calls")
      .select("transcript")
      .eq("id", order.call_id)
      .maybeSingle();

    setChatLoading(false);

    if (error || !data?.transcript) {
      setChatLines([
        {
          who: "",
          text: "No hay conversación guardada todavía."
        }
      ]);
      return;
    }

    setChatLines(parseTranscript(data.transcript));
  }

  async function setPaid(
    id: string,
    paid: boolean,
    method?: Order["payment_method"]
  ) {
    setPayOrder(null);
    const payment_method = paid && method ? method : undefined;
    if (isDemoOrder(id)) {
      setOrders(current =>
        current.map(order =>
          order.id === id
            ? {
                ...order,
                paid,
                ...(payment_method ? { payment_method } : {})
              }
            : order
        )
      );
      return;
    }

    const supabase = createClient();
    const patch: { paid: boolean; payment_method?: Order["payment_method"] } = {
      paid
    };
    if (payment_method) {
      patch.payment_method = payment_method;
    }

    const { error } = await supabase.from("orders").update(patch).eq("id", id);

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setOrders(current =>
      current.map(order =>
        order.id === id
          ? {
              ...order,
              paid,
              ...(payment_method ? { payment_method } : {})
            }
          : order
      )
    );
  }

  function startEditOrderNumber(order: Order) {
    setEditingNumberId(order.id);
    setNumberDraft(order.order_number);
    setNumberError("");
  }

  function cancelEditOrderNumber() {
    setEditingNumberId(null);
    setNumberDraft("");
    setNumberError("");
  }

  async function saveOrderNumber(id: string) {
    const nextNumber = normalizeOrderNumber(numberDraft);
    if (!nextNumber) {
      setNumberError("Escribe un número de pedido.");
      return;
    }
    if (isOrderNumberTaken(orders, nextNumber, id)) {
      setNumberError("Ese número ya existe.");
      return;
    }

    if (isDemoOrder(id)) {
      setOrders(current =>
        current.map(order =>
          order.id === id ? { ...order, order_number: nextNumber } : order
        )
      );
      cancelEditOrderNumber();
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("orders")
      .update({ order_number: nextNumber })
      .eq("id", id);

    if (error) {
      setNumberError(error.message);
      return;
    }

    setOrders(current =>
      current.map(order =>
        order.id === id ? { ...order, order_number: nextNumber } : order
      )
    );
    cancelEditOrderNumber();
  }

  useEffect(() => {
    loadOrders();
    loadUsage();
    loadCalls();

    const supabase = createClient();
    for (const existing of supabase.getChannels()) {
      if (existing.topic.includes("orders-live")) {
        void supabase.removeChannel(existing);
      }
    }

    const channel = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders"
        },
        async payload => {
          const full = await loadOrderById(
            (payload.new as { id: string }).id
          );
          if (full) {
            setOrders(current => [
              full,
              ...current.filter(o => o.id !== full.id)
            ]);
          }
          loadUsage();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders"
        },
        async payload => {
          const full = await loadOrderById(
            (payload.new as { id: string }).id
          );
          if (full) {
            setOrders(current =>
              current.map(order =>
                order.id === full.id
                  ? {
                      ...full,
                      stoppedAt: TIMER_PAUSE_STATUSES.has(full.status)
                        ? order.stoppedAt ?? Date.now()
                        : null
                    }
                  : order
              )
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "orders"
        },
        payload => {
          const id = (payload.old as { id?: string }).id;
          if (id) {
            setOrders(current =>
              current.filter(order => order.id !== id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadOrders, loadUsage, loadOrderById, loadCalls]);

  const newOrderIds = orders
    .filter(order => order.status === "new" && !order.deleted_at)
    .map(order => order.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!newOrderIds || typeof window === "undefined") {
      return;
    }

    const storageKey = "announced-new-orders";
    const announced = new Set(
      JSON.parse(window.localStorage.getItem(storageKey) || "[]") as string[]
    );
    const unseen = newOrderIds.split(",").filter(id => id && !announced.has(id));

    if (!unseen.length) {
      return;
    }

    playDoorbell();
    unseen.forEach(id => announced.add(id));
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([...announced].slice(-200))
    );
  }, [newOrderIds]);

  useEffect(() => {
    void flushStatusQueue();
    function onOnline() {
      void flushStatusQueue();
    }
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onOnline);
    };
  }, []);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const showWarning = minutesUsed >= minuteWarning;

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest(".status-select")) {
        setOpenStatusId(null);
      }
      if (target && !target.closest(".orders-daypicker")) {
        setCalendarOpen(false);
      }
      if (target && !target.closest(".orders-nav")) {
        setNavOpen(false);
      }
      if (target && !target.closest(".orders-status-filter")) {
        setStatusMenuOpen(false);
      }
      if (target && !target.closest(".orders-search") && !target.closest(".orders-search-input")) {
        setSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setChatOrder(null);
      setLocationOrder(null);
      setDeleteOrderId(null);
      setOpenStatusId(null);
      setToast(null);
      setCalendarOpen(false);
      setNavOpen(false);
      setStatusMenuOpen(false);
      setContactOrder(null);
      setPayOrder(null);
      setSearchOpen(false);
      setTrashOpen(false);
      cancelEditOrderNumber();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("overlay-open", overlayOpen);
    document.body.classList.toggle("stats-locked", view === "stats" && !overlayOpen);
    return () => {
      document.body.classList.remove("overlay-open");
      document.body.classList.remove("stats-locked");
    };
  }, [overlayOpen, view]);

  useEffect(() => {
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    const unlock = () => unlockDoorbell();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <div className="page-blobs" aria-hidden="true">
        <span className="page-blob page-blob-bottom" />
      </div>
    <main className={`orders-page${view === "stats" ? " is-stats" : ""}`}>
      <div className="orders-chrome">
      <header className={`orders-header${calendarOpen || navOpen || statusMenuOpen ? " is-calendar-open" : ""}${searchOpen ? " is-search-open" : ""}`}>
        <div className="orders-header-left">
          <div className="orders-nav">
            <div className="orders-nav-tabs">
              <button
                type="button"
                className={view === "orders" ? "is-active" : ""}
                onClick={() => setView("orders")}
              >
                Pedidos
              </button>
              <button
                type="button"
                className={view === "stats" ? "is-active" : ""}
                onClick={() => setView("stats")}
              >
                Dashboard
              </button>
            </div>
            <button
              type="button"
              className="orders-nav-trigger"
              onClick={() => setNavOpen(open => !open)}
            >
              {view === "stats" ? "Dashboard" : "Pedidos"}
            </button>
            {navOpen && (
              <ul className="orders-nav-menu">
                <li>
                  <button
                    type="button"
                    className={view === "orders" ? "is-active" : ""}
                    onClick={() => {
                      setView("orders");
                      setNavOpen(false);
                    }}
                  >
                    Pedidos
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={view === "stats" ? "is-active" : ""}
                    onClick={() => {
                      setView("stats");
                      setNavOpen(false);
                    }}
                  >
                    Dashboard
                  </button>
                </li>
              </ul>
            )}
          </div>
          <div className="orders-minutes-row">
          <p className={`orders-minutes${showWarning ? " is-warning" : ""}`}>
            {minutesUsed} min / {minutesLimit} min este mes
            <span className="orders-minutes-tip" role="tooltip">
              Reinicio: {minutesResetLabel}
            </span>
          </p>
          {view === "orders" && trashedToday.length > 0 && (
            <button
              type="button"
              className="orders-trash-btn"
              aria-label="Pedidos eliminados"
              onClick={() => setTrashOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 7h14M10 7V5h4v2M8 7l.7 12h6.6L16 7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{trashedToday.length}</span>
            </button>
          )}
          </div>
        </div>

        <div className="orders-daypicker">
          {view === "stats" ? (
            <p className="orders-daypicker-trigger is-static" suppressHydrationWarning>
              {formatDayHeading(todayKey)}
            </p>
          ) : (
            <>
          <button
            type="button"
            className="orders-daypicker-trigger"
            suppressHydrationWarning
            onClick={() => {
              const [year, month] = selectedDay.split("-").map(Number);
              setCalendarMonth({ year, month: month - 1 });
              setCalendarOpen(open => !open);
            }}
          >
            {formatDayHeading(selectedDay)}
          </button>
          {calendarOpen && (
            <>
              <div
                className="orders-calendar-backdrop"
                onPointerDown={() => setCalendarOpen(false)}
              />
              <div className="orders-calendar" role="dialog" aria-label="Calendario">
              <div className="orders-calendar-nav">
                <button
                  type="button"
                  className="orders-calendar-nav-btn"
                  onClick={() =>
                    setCalendarMonth(current => {
                      const next = new Date(current.year, current.month - 1, 1);
                      return {
                        year: next.getFullYear(),
                        month: next.getMonth()
                      };
                    })
                  }
                  aria-label="Mes anterior"
                >
                  ‹
                </button>
                <p>{monthLabel(calendarMonth.year, calendarMonth.month)}</p>
                <button
                  type="button"
                  className="orders-calendar-nav-btn"
                  onClick={() =>
                    setCalendarMonth(current => {
                      const next = new Date(current.year, current.month + 1, 1);
                      return {
                        year: next.getFullYear(),
                        month: next.getMonth()
                      };
                    })
                  }
                  aria-label="Mes siguiente"
                >
                  ›
                </button>
              </div>
              <div className="orders-calendar-week">
                {WEEKDAYS.map(day => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="orders-calendar-grid">
                {calendarCells(calendarMonth.year, calendarMonth.month).map(
                  (day, index) => {
                    if (day == null) {
                      return <span key={`empty-${index}`} />;
                    }

                    const key = dateKeyFromParts(
                      calendarMonth.year,
                      calendarMonth.month,
                      day
                    );
                    const isSelected = key === selectedDay;
                    const isToday = key === todayKey;

                    return (
                      <button
                        key={key}
                        type="button"
                        className={`orders-calendar-day${
                          isSelected ? " is-selected" : ""
                        }${isToday ? " is-today" : ""}`}
                        onClick={() => {
                          setSelectedDay(key);
                          setCalendarOpen(false);
                        }}
                      >
                        {day}
                      </button>
                    );
                  }
                )}
              </div>
              {selectedDay !== todayKey && (
                <button
                  type="button"
                  className="orders-calendar-today"
                  onClick={() => {
                    setSelectedDay(todayKey);
                    const [year, month] = todayKey.split("-").map(Number);
                    setCalendarMonth({ year, month: month - 1 });
                    setCalendarOpen(false);
                  }}
                >
                  Hoy
                </button>
              )}
            </div>
            </>
          )}
            </>
          )}
        </div>

        <div className="orders-header-right">
          {view === "orders" && (
            <>
              <div className="orders-search">
                <button
                  type="button"
                  className="orders-search-toggle"
                  aria-label="Buscar pedido"
                  onClick={() => setSearchOpen(open => !open)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {searchOpen && (
                <input
                  id="order-search"
                  name="order-search"
                  type="search"
                  autoComplete="off"
                  className="orders-search-input"
                  autoFocus
                  placeholder="Buscar pedido…"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                />
              )}
              <div className="orders-status-filter">
                <button
                  type="button"
                  className="orders-filter-trigger"
                  onClick={() => setStatusMenuOpen(open => !open)}
                >
                  {STATUS_FILTERS.find(option => option.value === statusFilter)
                    ?.label || "Todos"}
                </button>
                {statusMenuOpen && (
                  <ul className="orders-filter-menu">
                    {STATUS_FILTERS.map(option => (
                      <li key={option.value}>
                        <button
                          type="button"
                          className={
                            option.value === statusFilter ? "is-active" : ""
                          }
                          onClick={() => {
                            setStatusFilter(option.value);
                            setStatusMenuOpen(false);
                          }}
                        >
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            className="orders-logout"
            onClick={logout}
          >
            Salir
          </button>
        </div>
      </header>
      <div id="orders-chrome-extra" />
      </div>

      <div className={`orders-body${view === "stats" ? " is-stats" : ""}`}>
      {loadError && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            color: "#b91c1c"
          }}
        >
          {loadError}
          {/columna|column|schema cache|PGRST204/i.test(loadError) && (
            <div style={{ marginTop: 8, fontSize: 14 }}>
              Si menciona una columna nueva, pega en Supabase
              supabase/migration_dashboard_persistence.sql
            </div>
          )}
        </div>
      )}

      {showWarning && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20
          }}
        >
          Llevas {minutesUsed} de {minutesLimit} minutos.
          Contacta a soporte para conseguir más minutos: {support}
        </div>
      )}

      {view === "stats" ? (
        <StatsBoard
          orders={orders}
          calls={calls}
          minutesUsed={minutesUsed}
          minutesLimit={minutesLimit}
          onOpenCall={callId => {
            const order = orders.find(item => item.call_id === callId);
            if (order) {
              void openChat(order);
              return;
            }
            void openChat({
              id: `call-${callId}`,
              order_type: "pickup",
              address: null,
              lat: null,
              lng: null,
              status: "new",
              total: 0,
              created_at: new Date().toISOString(),
              payment_method: null,
              paid: false,
              order_number: "",
              call_id: callId,
              customers: { name: "Llamada", phone: null },
              order_items: []
            });
          }}
        />
      ) : (
        <>
      {loading && (
        <div className="page-spinner" role="status" aria-label="Cargando">
          <span className="page-spinner-ring" />
        </div>
      )}

      {!loading && !loadError && visibleOrders.length === 0 && (
        <div className="orders-empty">
          {searchQuery.trim()
            ? "No hay pedidos que coincidan."
            : orders.length === 0
              ? "No hay pedidos todavía."
              : "No hay pedidos en este día."}
        </div>
      )}

      <div className="orders-grid">
        {visibleOrders.map(order => (
          <article
            key={order.id}
            className={`orders-card orders-card--${order.status}`}
          >
            <div className="orders-card-body">
              <div className="orders-card-info">
                <div className="orders-card-heading">
                  <h2>{order.customers?.name || "Sin nombre"}</h2>
                  <button
                    type="button"
                    className="order-number"
                    title="Cambiar número de pedido"
                    onClick={() => startEditOrderNumber(order)}
                  >
                    #{order.order_number}
                  </button>
                </div>

                <p>
                  {order.order_type === "delivery"
                    ? "Domicilio"
                    : "Recoger"}
                </p>

                {order.address && (
                  <p>
                    <strong>
                      {order.order_type === "delivery"
                        ? "Dirección:"
                        : "Sucursal:"}
                    </strong>{" "}
                    {order.address}
                  </p>
                )}

                <div className="orders-card-items">
                  <strong>Orden:</strong>
                  <ul>
                    {(order.order_items || []).map((item, index) => (
                      <li key={`${order.id}-${index}`}>
                        {item.quantity} × {item.name} ($
                        {Number(item.subtotal).toFixed(2)})
                        {item.notes ? (
                          <span className="order-item-note">
                            {" "}
                            ({item.notes})
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {order.notes ? (
                      <li className="order-item-note">
                        {order.notes}
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>

              <div className="orders-card-actions">
                <div className="status-select">
                  <button
                    type="button"
                    className={`status-select-trigger status-select-trigger--${order.status}`}
                    onClick={() =>
                      setOpenStatusId(
                        openStatusId === order.id ? null : order.id
                      )
                    }
                  >
                    {STATUS_OPTIONS.find(
                      option => option.value === order.status
                    )?.label || order.status}
                  </button>
                  {openStatusId === order.id && (
                    <ul className="status-select-menu">
                      {STATUS_OPTIONS.map(option => (
                        <li key={option.value}>
                          <button
                            type="button"
                            className={
                              option.value === order.status
                                ? "status-select-option is-active"
                                : "status-select-option"
                            }
                            onClick={() =>
                              updateStatus(order.id, option.value)
                            }
                          >
                            {option.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  className="orders-btn-location"
                  onClick={() => {
                    if (!order.address?.trim() && (order.lat == null || order.lng == null)) {
                      setToast({
                        type: "error",
                        message: "Este pedido no tiene ubicación GPS."
                      });
                      return;
                    }
                    setLocationOrder(order);
                  }}
                >
                  Ubicación
                </button>

                <button
                  type="button"
                  className="orders-btn-chat"
                  onClick={() => openChat(order)}
                >
                  Conversación
                </button>

                <button
                  type="button"
                  className="orders-btn-delete"
                  onClick={() => deleteOrder(order.id)}
                >
                  Eliminar
                </button>
              </div>
            </div>

            <div className="orders-card-footer">
              <small>
                {formatOrderStamp(order.created_at)}
              </small>
              {!TIMER_HIDE_STATUSES.has(order.status) && (
              <p className="orders-card-elapsed">
                {nowTick ? relativeTime(order.created_at, nowTick) : "\u00a0"}
              </p>
              )}
              <div className="orders-card-total">
                <p className="orders-card-payment">
                  {paymentLabel(order.payment_method)}
                </p>
                <button
                  type="button"
                  className={`orders-card-price${order.paid ? " is-paid" : ""}`}
                  onClick={() => setPayOrder(order)}
                >
                  ${Number(order.total).toFixed(2)}
                  {order.paid && (
                    <svg
                      className="orders-paid-check"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <circle cx="8" cy="8" r="8" fill="#16a34a" />
                      <path
                        d="M4.5 8.2l2.2 2.2 4.8-5"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
        </>
      )}
      </div>

      {chatOrder && (
        <div
          className="chat-overlay"
          onClick={() => setChatOrder(null)}
        >
          <div
            className="chat-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="chat-modal-header">
              <div className="chat-header-person">
                <span className="chat-avatar" aria-hidden="true">
                  {(chatOrder.customers?.name || "C").slice(0, 1).toUpperCase()}
                </span>
                <div className="chat-header-copy">
                  <h2>
                    {chatOrder.customers?.name || "Cliente"}
                    {chatOrder.order_number
                      ? ` · #${chatOrder.order_number}`
                      : ""}
                  </h2>
                  <p>
                    Llamada con Pizzería Hermosillo
                    {chatLines.at(-1)?.at ? ` · ${chatLines.at(-1)?.at}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="chat-contact-btn"
                onClick={() => setContactOrder(chatOrder)}
              >
                Contactar
              </button>
              <button
                type="button"
                className="chat-close-btn"
                onClick={() => setChatOrder(null)}
              >
                ×
              </button>
            </div>
            <div className="chat-modal-body">
              {chatLoading && <p>Cargando...</p>}

              {!chatLoading && (
                <div className="chat-day-chip">Transcripción de la llamada</div>
              )}

              {!chatLoading &&
                chatLines.map((line, index) => {
                  const isIa = line.who === "IA";
                  const isClient = line.who === "Cliente";
                  const speaker = isIa
                    ? "Pizzería"
                    : isClient
                      ? (chatOrder.customers?.name || "Cliente").split(" ")[0]
                      : "";
                  return (
                    <div
                      key={index}
                      className={
                        isIa
                          ? "chat-bubble-row chat-bubble-row--ia"
                          : isClient
                            ? "chat-bubble-row chat-bubble-row--client"
                            : "chat-bubble-row chat-bubble-row--note"
                      }
                    >
                      {isIa && (
                        <span className="chat-mini-avatar chat-mini-avatar--ia">
                          PH
                        </span>
                      )}
                      <div
                        className={
                          isIa
                            ? "chat-bubble chat-bubble--ia"
                            : isClient
                              ? "chat-bubble chat-bubble--client"
                              : "chat-bubble chat-bubble--note"
                        }
                      >
                        {speaker && (
                          <div className="chat-bubble-who">{speaker}</div>
                        )}
                        <p className="chat-bubble-text">{line.text}</p>
                        {line.at && (
                          <time className="chat-bubble-time">{line.at}</time>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </main>
      {locationOrder && (
        <div
          className="notice-overlay"
          onClick={() => setLocationOrder(null)}
        >
          <div
            className="notice-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Ubicación exacta</h2>
            <p>
              {locationOrder.order_type === "pickup"
                ? "Recoger en sucursal"
                : "Entrega a domicilio"}
            </p>
            {locationOrder.address && (
              <p>{fullDeliveryAddress(locationOrder.address)}</p>
            )}
            {locationOrder.lat != null && locationOrder.lng != null && (
              <p>
                GPS: {locationOrder.lat.toFixed(6)},{" "}
                {locationOrder.lng.toFixed(6)}
              </p>
            )}
            <div className="notice-actions notice-actions-stack">
              <a
                className="notice-btn notice-btn-maps"
                href={mapsPinUrl(locationOrder)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir pin en Google Maps
              </a>
              <a
                className="notice-btn notice-btn-whatsapp"
                href={whatsappShareUrl(locationOrder)}
                target="_blank"
                rel="noreferrer"
              >
                Compartir por WhatsApp
              </a>
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={() => setLocationOrder(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteOrderId && (
        <div
          className="notice-overlay"
          onClick={() => setDeleteOrderId(null)}
        >
          <div
            className="notice-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Eliminar pedido</h2>
            <p>
              ¿Seguro que quieres eliminar este pedido? Podrás recuperarlo
              desde la papelera de este día.
            </p>
            <div className="notice-actions">
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={() => setDeleteOrderId(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-danger"
                onClick={() => confirmDeleteOrder()}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {contactOrder && (
        <div
          className="notice-overlay"
          onClick={() => setContactOrder(null)}
        >
          <div
            className="notice-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Contactar</h2>
            <p>
              Elige cómo quieres hablar con{" "}
              {contactOrder.customers?.name || "el cliente"}.
            </p>
            <div className="notice-actions notice-actions-stack">
              <a
                className="notice-btn notice-btn-whatsapp"
                href={whatsappCallUrl(contactOrder.customers?.phone) || "#"}
                target="_blank"
                rel="noreferrer"
                onClick={event => {
                  if (!whatsappCallUrl(contactOrder.customers?.phone)) {
                    event.preventDefault();
                    setToast({
                      type: "error",
                      message: "Este pedido no tiene teléfono."
                    });
                  }
                }}
              >
                Llamada por WhatsApp
              </a>
              <a
                className="notice-btn notice-btn-maps"
                href={
                  whatsappMessageUrl(
                    contactOrder.customers?.phone,
                    contactOrder.customers?.name
                  ) || "#"
                }
                target="_blank"
                rel="noreferrer"
                onClick={event => {
                  if (!whatsappDigits(contactOrder.customers?.phone)) {
                    event.preventDefault();
                    setToast({
                      type: "error",
                      message: "Este pedido no tiene teléfono."
                    });
                  }
                }}
              >
                Mensaje por WhatsApp
              </a>
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={() => setContactOrder(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {trashOpen && (
        <div
          className="notice-overlay"
          onClick={() => setTrashOpen(false)}
        >
          <div
            className="notice-dialog trash-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Pedidos eliminados</h2>
            <p>Pedidos de este día que puedes recuperar.</p>
            {trashedToday.length === 0 ? (
              <p className="stats-empty">No hay pedidos en la papelera.</p>
            ) : (
              <ul className="trash-list">
                {trashedToday.map(order => (
                  <li key={order.id}>
                    <div>
                      <strong>
                        {order.customers?.name || "Sin nombre"}
                      </strong>
                      <span>
                        ${Number(order.total).toFixed(2)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="notice-btn notice-btn-cancel"
                      onClick={() => restoreOrder(order.id)}
                    >
                      Recuperar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="notice-actions">
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={() => setTrashOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {payOrder && (
        <div
          className="notice-overlay"
          onClick={() => setPayOrder(null)}
        >
          <div
            className="notice-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Pago</h2>
            <p>
              ${Number(payOrder.total).toFixed(2)} ·{" "}
              {paymentLabel(payOrder.payment_method)}
            </p>
            <div className="notice-actions notice-actions-stack">
              <button
                type="button"
                className="notice-btn notice-btn-whatsapp"
                onClick={() => setPaid(payOrder.id, true, "efectivo")}
              >
                Efectivo
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-whatsapp"
                onClick={() => setPaid(payOrder.id, true, "transferencia")}
              >
                Transferencia
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-whatsapp"
                onClick={() => setPaid(payOrder.id, true, "tarjeta")}
              >
                Tarjeta
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={() => setPaid(payOrder.id, false)}
              >
                Pendiente
              </button>
            </div>
          </div>
        </div>
      )}
      {editingNumberId && (
        <div
          className="notice-overlay"
          onClick={cancelEditOrderNumber}
        >
          <div
            className="notice-dialog"
            onClick={event => event.stopPropagation()}
          >
            <h2>Número de pedido</h2>
            <p>
              {orders.find(order => order.id === editingNumberId)?.customers
                ?.name || "Sin nombre"}
            </p>
            <label className="order-number-label" htmlFor="order-number-edit">
              Número
            </label>
            <input
              id="order-number-edit"
              name="order_number"
              className="order-number-dialog-input"
              value={numberDraft}
              autoFocus
              autoComplete="off"
              onChange={event => {
                setNumberDraft(event.target.value);
                setNumberError("");
              }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveOrderNumber(editingNumberId);
                }
              }}
            />
            {numberError ? (
              <p className="order-number-dialog-error">{numberError}</p>
            ) : null}
            <div className="notice-actions">
              <button
                type="button"
                className="notice-btn notice-btn-cancel"
                onClick={cancelEditOrderNumber}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-whatsapp"
                onClick={() => void saveOrderNumber(editingNumberId)}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`app-toast app-toast--${toast.type}`}>
          {toast.message}
        </div>
      )}
    </>
  );
}

