import { readFileSync } from "fs";
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
  return loadHermosilloCatalog();
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

function itemNotes(size, sauce, extra) {
  const topping = extra === "champinones" ? "champiñones" : extra;
  return [size, sauce, topping].filter(Boolean).join(", ");
}

export function priceWithMushrooms(size) {
  const base = pizzaPrice(size);
  return { base, total: base + 25 };
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

function postalChunks(atoms) {
  const groups = [];
  let current = null;

  for (const number of atoms) {
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

  return groups;
}

function fiveDigit(candidate) {
  const cp = String(candidate || "");
  if (!/^\d{5}$/.test(cp)) {
    return "";
  }
  return cp;
}

function inCatalog(cp) {
  return /^\d{5}$/.test(cp) && Boolean(hermosilloCatalog[cp]);
}

function insertions(cp) {
  if (!/^\d{4}$/.test(cp)) {
    return [];
  }
  const found = [];
  for (let index = 0; index <= cp.length; index += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      const next = `${cp.slice(0, index)}${digit}${cp.slice(index)}`;
      if (inCatalog(next)) {
        found.push(next);
      }
    }
  }
  return found;
}

export function parseSpokenPostalCode(value) {
  const folded = foldText(value)
    .replace(/\btrescientos\b/g, "tres ciento")
    .replace(/\bcuatrocientos\b/g, "cuatro ciento")
    .replace(/\bquinientos\b/g, "cinco ciento")
    .replace(/\bseiscientos\b/g, "seis ciento")
    .replace(/\bsetecientos\b/g, "siete ciento")
    .replace(/\bochocientos\b/g, "ocho ciento")
    .replace(/\bnovecientos\b/g, "nueve ciento");
  const digits = String(value || "").replace(/\D/g, "");
  const direct = fiveDigit(digits);

  const tokens = folded.split(" ").filter(token => token && token !== "y");
  const atoms = [];
  let milAt = -1;
  for (const token of tokens) {
    if (token === "mil" || token === "miles") {
      milAt = atoms.length;
      continue;
    }
    if (token in SPANISH_NUMBERS) {
      atoms.push(SPANISH_NUMBERS[token]);
    } else if (/^\d+$/.test(token)) {
      atoms.push(Number(token));
    }
  }

  const candidates = [];
  const joined = postalChunks(atoms).map(number => String(number)).join("");
  if (fiveDigit(joined)) {
    candidates.push(joined);
  }
  if (atoms.length === 5 && atoms.every(number => number < 10)) {
    candidates.push(atoms.join(""));
  }
  if (milAt > 0) {
    const prefix = Number(postalChunks(atoms.slice(0, milAt)).join(""));
    const restChunks = postalChunks(atoms.slice(milAt));
    const rest = restChunks.length ? Number(restChunks.join("")) : 0;
    const fromThousands = fiveDigit(prefix * 1000 + rest);
    if (fromThousands) {
      candidates.push(fromThousands);
    }
  }
  if (direct) {
    candidates.push(direct);
  }

  const catalogHits = [...new Set(candidates.filter(inCatalog))];
  if (catalogHits.length === 1) {
    return catalogHits[0];
  }
  if (catalogHits.length > 1) {
    const spoken = catalogHits.find(cp => cp === joined);
    return spoken || catalogHits[0];
  }

  const repaired = [...new Set(
    [joined, digits].flatMap(insertions)
  )];
  if (repaired.length === 1) {
    return repaired[0];
  }
  if (/\bciento\b/.test(folded)) {
    const withOne = repaired.find(cp => /^\d{2}1\d{2}$/.test(cp));
    if (withOne) {
      return withOne;
    }
  }
  if (/\bcero\b/.test(folded)) {
    const withZero = repaired.find(cp => /^\d{2}0\d{2}$/.test(cp));
    if (withZero) {
      return withZero;
    }
  }

  return "";
}

function foldColony(value) {
  let text = foldText(value)
    .replace(/\bi\s+ese\s+ese\s+ese\s+te\s+e\b/g, "issste")
    .replace(/\bi\s+ese\s+ese\s+te\s+e\b/g, "issste")
    .replace(/\bcero\b/g, "0")
    .replace(/\buno\b/g, "1")
    .replace(/\bdos\b/g, "2")
    .replace(/\btres\b/g, "3")
    .replace(/\bcuatro\b/g, "4")
    .replace(/\bcinco\b/g, "5")
    .replace(/\bseis\b/g, "6")
    .replace(/\bsiete\b/g, "7")
    .replace(/\bocho\b/g, "8")
    .replace(/\bnueve\b/g, "9");

  if (/\bissste\b/.test(text) && !/\bfederal\b/.test(text)) {
    text = text.replace(/\bissste\b/, "issste federal");
  }

  return text;
}

function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) {
    rows[0][column] = column;
  }
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost
      );
    }
  }
  return rows[left.length][right.length];
}

function colonyScore(said, official) {
  if (!said || !official) {
    return 0;
  }
  if (said === official) {
    return 100;
  }
  if (official.includes(said) || said.includes(official)) {
    return 85;
  }
  const distance = editDistance(said, official);
  const limit = Math.max(said.length, official.length);
  return Math.max(0, Math.round(100 - (distance / limit) * 100));
}

function matchColonies(colony, colonias) {
  const said = foldColony(colony);
  const ranked = colonias
    .map(name => ({ name, score: colonyScore(said, foldColony(name)) }))
    .filter(item => item.score >= 70)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return { match: "", options: [] };
  }
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 15) {
    return { match: ranked[0].name, options: [] };
  }
  return {
    match: "",
    options: ranked.slice(0, 4).map(item => item.name)
  };
}
export async function checkAddressTool({
  postalCode,
  street,
  colony
}) {
  const cp = parseSpokenPostalCode(postalCode);
  if (!/^\d{5}$/.test(cp)) {
    return {
      ok: false,
      error: "El código debe tener 5 dígitos. Pídelo otra vez y pasa las palabras oídas, sin convertirlas a número."
    };
  }

  const colonias = hermosilloCatalog[cp];

  if (!colonias) {
    return {
      ok: false,
      error: "No entendí el código. Pide que lo repita con las palabras, sin convertirlo a número."
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

  const dictatedStreet = street?.trim() || "";
  const { match, options } = matchColonies(colony, colonias);

  if (!match) {
    return {
      ok: true,
      postal_code_valid: true,
      postal_code: cp,
      colony_match: false,
      colonias: options,
      address: [dictatedStreet, colony.trim(), `C.P. ${cp}`, "Hermosillo, Sonora"]
        .filter(Boolean)
        .join(", "),
      note: options.length
        ? `El código ${cp} es de Hermosillo. No pidas deletrear. Ofrece solo estas colonias: ${options.join(", ")}.`
        : `El código ${cp} es de Hermosillo. No pidas deletrear. Pregunta otra vez cuál es la colonia.`
    };
  }

  return {
    ok: true,
    postal_code_valid: true,
    postal_code: cp,
    colony_match: true,
    colony: match,
    address: [dictatedStreet, match, `C.P. ${cp}`, "Hermosillo, Sonora"]
      .filter(Boolean)
      .join(", "),
    note: `Confirmado. Di exactamente el código ${cp} y la colonia ${match}. No pidas deletrear.`
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

  if (callId) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id, total, order_number")
      .eq("call_id", callId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        already_saved: true,
        order_id: existing.id,
        order_number: existing.order_number,
        total: existing.total,
        note: "Este pedido ya quedó guardado. No lo vuelvas a crear. Sigue con la despedida."
      };
    }
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

    const extra = item.extra === "champinones" ? "champinones" : null;

    if (isPizza(product)) {
      unitPrice = pizzaPrice(size);
      if (extra) {
        unitPrice += 25;
      }
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
      notes: itemNotes(size, sauce, extra) || null
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
      customer_id: order.customer_id,
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
  const given = (customerName || "").trim();
  let savedName = last.customer_name;

  if (given && expected !== given.toLowerCase()) {
    const { error: nameError } = await supabase
      .from("customers")
      .update({ name: given })
      .eq("id", last.customer_id);

    if (nameError) {
      throw nameError;
    }

    savedName = given;
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
    customer_name: savedName,
    note: savedName === last.customer_name
      ? "Pedido modificado."
      : `El nombre quedó en ${savedName}. No reinicies el pedido. Úsalo en el cierre.`,
    item: product.name,
    notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce),
    total: subtotal
  };
}

const transfersStarted = new Set();

export function humanTransferStarted(callSid) {
  return transfersStarted.has(callSid);
}

export async function transferToHumanTool(callSid, businessId) {
  if (!callSid || transfersStarted.has(callSid)) {
    return { success: false };
  }

  transfersStarted.add(callSid);

  const twiml =
    "<Response><Dial timeout=\"30\"><Number>+526621383780</Number></Dial></Response>";

  try {
    await twilio(config.twilioAccountSid, config.twilioAuthToken)
      .calls(callSid)
      .update({ twiml });
  } catch (error) {
    console.error(
      "Twilio rechazó el desvío:",
      error.code || "",
      error.message
    );
    throw error;
  }

  return { success: true, number: "+526621383780" };
}

export async function endCallTool(callSid) {
  if (!callSid) {
    return { success: false };
  }

  await new Promise(resolve => setTimeout(resolve, 8000));

  if (humanTransferStarted(callSid)) {
    return { success: true, skipped: true };
  }

  await twilio(
    config.twilioAccountSid,
    config.twilioAuthToken
  )
    .calls(callSid)
    .update({ status: "completed" });

  return { success: true };
}
