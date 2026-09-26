import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import { config } from "./config.js";
import { normalizePhone, supabase } from "./supabase.js";

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/hermosillo-cp.json"
);

let hermosilloCatalog = {};

function loadHermosilloCatalog() {
  hermosilloCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  return hermosilloCatalog;
}

loadHermosilloCatalog();

export async function refreshHermosilloCatalog() {
  try {
    const response = await fetch(
      "https://postali.app/api/v1/mx/municipio/sonora/hermosillo"
    );

    if (!response.ok) {
      return loadHermosilloCatalog();
    }

    const data = await response.json();

    if (data.truncated || !Array.isArray(data.colonias)) {
      return loadHermosilloCatalog();
    }

    const next = {};

    for (const colonia of data.colonias) {
      if (!next[colonia.cp]) {
        next[colonia.cp] = [];
      }

      next[colonia.cp].push(colonia.nombre);
    }

    writeFileSync(catalogPath, JSON.stringify(next));
    hermosilloCatalog = next;
    return next;
  } catch (error) {
    console.error(
      "Postali no respondió, se usa la lista local:",
      error.message
    );
    return loadHermosilloCatalog();
  }
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SIZE_PRICES = {
  mediana: 200,
  grande: 220,
  familiar: 250
};

function isPizza(product) {
  return (
    product.category === "Pizzas" ||
    /^pizza\b/i.test(product.name || "")
  );
}

function needsSauce(product) {
  return /boneless/i.test(product.name || "");
}

function pizzaPrice(size) {
  const price = SIZE_PRICES[String(size || "").toLowerCase()];

  if (!price) {
    throw new Error(
      "Indica el tamaño: mediana, grande o familiar."
    );
  }

  return price;
}

function itemNotes(size, sauce) {
  return [size, sauce].filter(Boolean).join(", ");
}

export async function getMenuTool(businessId) {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,name,description,category,price,available"
    )
    .eq("business_id", businessId)
    .eq("available", true)
    .order("category")
    .order("name");

  if (error) {
    throw error;
  }

  return {
    pizza_sizes: SIZE_PRICES,
    products: (data || []).map(product => ({
      ...product,
      price: isPizza(product) ? null : Number(product.price),
      sizes: isPizza(product) ? SIZE_PRICES : undefined,
      sauce_options: needsSauce(product)
        ? ["bbq", "buffalo"]
        : undefined
    }))
  };
}

export function formatMenuForPrompt(menu) {
  const lines = [
    "Pizzas: mediana 200, grande 220, familiar 250. Di el número solo, por ejemplo: la pizza grande está en 220. Nunca digas dólares, pesos ni el signo de dinero."
  ];

  for (const product of menu.products || []) {
    const price = product.sizes
      ? "precio por tamaño"
      : `${Number(product.price).toFixed(0)}`;
    const sauce = product.sauce_options
      ? " Salsas: bbq o buffalo."
      : "";

    lines.push(
      `- ${product.name} | id ${product.id} | ${product.category} | ${price}.${sauce} ${product.description || ""}`.trim()
    );
  }

  return lines.join("\n");
}

const SPANISH_NUMBERS = {
  cero: 0,
  un: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100
};

export function parseSpokenPostalCode(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (hermosilloCatalog[digits]) {
    return digits;
  }

  const tokens = foldText(value)
    .replace(/\btrescientos\b/g, "tres ciento")
    .split(" ")
    .filter(token => token && token !== "y");

  const groups = [];
  let current = null;

  for (const token of tokens) {
    if (!(token in SPANISH_NUMBERS)) {
      continue;
    }

    const number = SPANISH_NUMBERS[token];

    if (current === null) {
      current = number;
    } else if (number >= 100) {
      if (current < 100) {
        groups.push(current);
      }

      current = number;
    } else if (current >= 100 && number < 100) {
      current += number;
    } else if (current >= 20 && current % 10 === 0 && number < 10) {
      current += number;
    } else {
      groups.push(current);
      current = number;
    }
  }

  if (current !== null) {
    groups.push(current);
  }

  const spoken = groups.map(number => String(number)).join("");

  if (hermosilloCatalog[spoken]) {
    return spoken;
  }

  if (digits.length === 5) {
    return digits;
  }

  return spoken || digits;
}

export async function checkAddressTool({
  postalCode,
  street,
  colony
}) {
  const cp = parseSpokenPostalCode(postalCode);
  const colonias = hermosilloCatalog[cp];

  if (!colonias) {
    return {
      ok: false,
      error: "Ese código postal no es de Hermosillo, Sonora. Pídelo otra vez."
    };
  }

  if (!colony?.trim()) {
    return {
      ok: true,
      postal_code_valid: true,
      address: `C.P. ${cp}, Hermosillo, Sonora`,
      note: "El código postal es de Hermosillo. Pregunta solo cuál es la colonia. No menciones ni sugieras colonias."
    };
  }

  const said = foldText(colony);
  const match = colonias.find(name => {
    const official = foldText(name);
    return official === said || official.includes(said) || said.includes(official);
  });

  const dictatedStreet = street?.trim() || "";

  if (!match) {
    return {
      ok: true,
      postal_code_valid: true,
      colony_match: false,
      colonias,
      address: [dictatedStreet, colony.trim(), `C.P. ${cp}`, "Hermosillo, Sonora"]
        .filter(Boolean)
        .join(", "),
      note: "El código es de Hermosillo. La colonia no coincide. Ofrece las colonias de la lista para que elija."
    };
  }

  return {
    ok: true,
    postal_code_valid: true,
    colony_match: true,
    colony: match,
    address: [dictatedStreet, match, `C.P. ${cp}`, "Hermosillo, Sonora"]
      .filter(Boolean)
      .join(", ")
  };
}

export async function createOrderTool({
  businessId,
  callId,
  customerName,
  customerPhone,
  orderType,
  address,
  items,
  confirmed,
  paymentMethod
}) {
  if (confirmed === false) {
    throw new Error(
      "El pedido no se guardó porque no está confirmado."
    );
  }

  paymentMethod = paymentMethod || "efectivo";
  orderType = orderType || "delivery";

  if (!customerName?.trim()) {
    throw new Error(
      "El nombre del cliente es obligatorio."
    );
  }

  if (
    paymentMethod !== "efectivo" &&
    paymentMethod !== "transferencia" &&
    paymentMethod !== "tarjeta"
  ) {
    throw new Error(
      "El pago debe ser efectivo, transferencia o tarjeta."
    );
  }

  if (
    orderType !== "pickup" &&
    orderType !== "delivery"
  ) {
    throw new Error(
      "El tipo de pedido debe ser pickup o delivery."
    );
  }

  if (
    orderType === "delivery" &&
    !address?.trim()
  ) {
    throw new Error(
      "La dirección es obligatoria para delivery."
    );
  }

  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      "El pedido debe contener productos."
    );
  }

  const productIds = [
    ...new Set(
      items.map(item => item.product_id)
    )
  ];

  const { data: products, error } =
    await supabase
      .from("products")
      .select(
        "id,name,price,available,business_id,category"
      )
      .eq("business_id", businessId)
      .in("id", productIds);

  if (error) {
    throw error;
  }

  if (
    !products ||
    products.length !== productIds.length
  ) {
    throw new Error(
      "Uno o más productos no existen."
    );
  }

  const calculatedItems = [];
  let total = 0;

  for (const item of items) {
    const product = products.find(
      p => p.id === item.product_id
    );

    if (!product) {
      throw new Error(
        "Producto no encontrado."
      );
    }

    if (!product.available) {
      throw new Error(
        `El producto ${product.name} no está disponible.`
      );
    }

    const quantity =
      Number(item.quantity);

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > 50
    ) {
      throw new Error(
        `Cantidad inválida para ${product.name}.`
      );
    }

    let unitPrice = Number(product.price);
    let sauce = null;
    const size = item.size
      ? String(item.size).toLowerCase()
      : null;

    if (isPizza(product)) {
      unitPrice = pizzaPrice(size);
    }

    if (needsSauce(product)) {
      sauce = String(item.sauce || "").toLowerCase();

      if (sauce !== "bbq" && sauce !== "buffalo") {
        throw new Error(
          "La pizza boneless necesita salsa bbq o buffalo."
        );
      }
    }

    const subtotal =
      unitPrice * quantity;

    total += subtotal;

    calculatedItems.push({
      product_id: product.id,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(size, sauce) || null
    });
  }

  const { data: customer, error: customerError } =
    await supabase
      .from("customers")
      .insert({
        business_id: businessId,
        name: customerName,
        phone: customerPhone || null,
        address: address || null
      })
      .select()
      .single();

  if (customerError) {
    throw customerError;
  }

  const { data: nextNumber, error: numberError } =
    await supabase.rpc("next_order_number", {
      p_business_id: businessId
    });

  if (numberError) {
    throw numberError;
  }

  const { data: order, error: orderError } =
    await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        call_id:
          callId || null,
        customer_id:
          customer.id,
        order_type: orderType,
        address:
          orderType === "delivery"
            ? address
            : null,
        status: "new",
        total,
        payment_method: paymentMethod,
        order_number: String(nextNumber || "1")
      })
      .select()
      .single();

  if (orderError) {
    throw orderError;
  }

  const rows =
    calculatedItems.map(item => ({
      order_id: order.id,
      ...item
    }));

  const { error: itemsError } =
    await supabase
      .from("order_items")
      .insert(rows);

  if (itemsError) {
    await supabase
      .from("orders")
      .delete()
      .eq("id", order.id);

    throw itemsError;
  }

  return {
    success: true,
    order_id: order.id,
    total,
    currency: "MXN",
    payment_method: paymentMethod,
    customer_name: customerName
  };
}

export async function getLastOrderTool({
  businessId,
  callerPhone
}) {
  const phone = normalizePhone(callerPhone);

  if (!businessId || !phone) {
    return { found: false };
  }

  const since = new Date(
    Date.now() - 2 * 60 * 60 * 1000
  ).toISOString();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id,customer_id,address,total,created_at,status")
    .eq("business_id", businessId)
    .gte("created_at", since)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    throw error;
  }

  for (const order of orders || []) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name,phone")
      .eq("id", order.customer_id)
      .maybeSingle();

    if (normalizePhone(customer?.phone) !== phone) {
      continue;
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("id,product_id,name,quantity,notes,unit_price")
      .eq("order_id", order.id);

    if (itemsError) {
      throw itemsError;
    }

    return {
      found: true,
      order_id: order.id,
      customer_name: customer?.name || "",
      address: order.address,
      items: items || []
    };
  }

  return { found: false };
}

export async function updateLastOrderTool({
  businessId,
  callerPhone,
  customerName,
  productId,
  size,
  sauce,
  quantity
}) {
  const last = await getLastOrderTool({
    businessId,
    callerPhone
  });

  if (!last.found) {
    throw new Error(
      "No hay un pedido reciente de este teléfono."
    );
  }

  const expected = (last.customer_name || "").trim().toLowerCase();
  const given = (customerName || "").trim().toLowerCase();

  if (expected && given && expected !== given) {
    throw new Error(
      `El pedido está a nombre de ${last.customer_name}.`
    );
  }

  const item = (last.items || [])[0];

  if (!item) {
    throw new Error("El pedido no tiene productos.");
  }

  const nextProductId = productId || item.product_id;
  const { data: product, error } = await supabase
    .from("products")
    .select("id,name,price,available,category")
    .eq("id", nextProductId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error || !product || !product.available) {
    throw new Error("Ese producto no está disponible.");
  }

  const nextQuantity = Number(quantity || item.quantity);
  let unitPrice = Number(product.price);
  let nextSauce = null;
  const nextSize = size
    ? String(size).toLowerCase()
    : (item.notes || "").split(",")[0]?.trim() || null;

  if (isPizza(product)) {
    unitPrice = pizzaPrice(nextSize);
  }

  if (needsSauce(product)) {
    nextSauce = String(sauce || "").toLowerCase();

    if (nextSauce !== "bbq" && nextSauce !== "buffalo") {
      const previous = (item.notes || "").toLowerCase();
      nextSauce = previous.includes("bbq")
        ? "bbq"
        : previous.includes("buffalo")
          ? "buffalo"
          : "";
    }

    if (nextSauce !== "bbq" && nextSauce !== "buffalo") {
      throw new Error(
        "Indica si la salsa es bbq o buffalo."
      );
    }
  }

  const subtotal = unitPrice * nextQuantity;
  const { error: itemError } = await supabase
    .from("order_items")
    .update({
      product_id: product.id,
      name: product.name,
      quantity: nextQuantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce) || null
    })
    .eq("id", item.id);

  if (itemError) {
    throw itemError;
  }

  const { error: orderError } = await supabase
    .from("orders")
    .update({ total: subtotal })
    .eq("id", last.order_id);

  if (orderError) {
    throw orderError;
  }

  return {
    success: true,
    order_id: last.order_id,
    customer_name: last.customer_name,
    item: product.name,
    notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce),
    total: subtotal
  };
}

export async function endCallTool(callSid) {
  if (!callSid) {
    return { success: false };
  }

  await new Promise(resolve => setTimeout(resolve, 8000));

  await twilio(
    config.twilioAccountSid,
    config.twilioAuthToken
  )
    .calls(callSid)
    .update({ status: "completed" });

  return { success: true };
}
