import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import { config } from "./config.js";
import { normalizePhone, supabase } from "./supabase.js";
import { withCallLock } from "./call-lock.js";
import { buildConfirmation, paymentForOrder, priceLine } from "./confirmation.js";
import { bakeNote, billableExtras, descriptionHasIngredient, foldIngredient, ingredientDescription, ingredientsFromText, menuIngredients } from "./menu-ingredients.js";
import {
  requestTransfer,
  markTransferred,
  markTransferFailed,
  maskNumber,
  transferTwiml
} from "./human-transfer.js";

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/hermosillo-cp.json"
);

let hermosilloCatalog = {};
let colonyIndex = null;

function loadHermosilloCatalog() {
  hermosilloCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  colonyIndex = null;
  return hermosilloCatalog;
}

loadHermosilloCatalog();

const streetCatalog = JSON.parse(readFileSync(path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/hermosillo-streets.json"
), "utf8"));

export function streetCore(value) {
  return foldText(value)
    .replace(/^(calle|avenida|av|blvd|boulevard|bulevard|paseo|privada|andador)\s+/, "")
    .trim();
}

export function streetPlacement(streetName, postalCode) {
  const core = streetCore(streetName);
  const row = streetCatalog.find(item => item.core === core);
  if (!row) {
    return { known: false, here: false, core, postals: [] };
  }
  const postals = [...new Set(row.postals.map(item => item.postal).filter(Boolean))];
  const unknownPostal = row.postals.some(item => !item.postal);
  const here = unknownPostal || postals.includes(String(postalCode || ""));
  return { known: true, here, core, postals };
}

export function matchDrinkProduct(products, drink = {}) {
  const foldName = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const volume = drink.volume === "600" ? "600" : drink.volume === "2 litros" ? "2" : "";
  const kind = drink.kind === "fresa" ? "fresa" : "coca";
  const light = drink.kind === "Light";
  if (!volume) {
    return null;
  }
  return (products || []).find(item => {
    const have = foldName(item.name);
    if (!have.includes(kind)) {
      return false;
    }
    if (kind === "coca" && have.includes("light") !== light) {
      return false;
    }
    if (volume === "600") {
      return have.includes("600");
    }
    return have.includes("2") && have.includes("litro");
  }) || null;
}

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
  if (product.category === "Promociones") {
    return false;
  }
  return (
    product.category === "Pizzas" ||
    /^pizza\b/i.test(product.name || "")
  );
}

function mentionsPizzaSize(name) {
  return /\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas)\b/i.test(name || "");
}

function pizzaFlavor(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/peperoni/g, "pepperoni")
    .replace(/\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas|pizza|de)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function withoutSizedPizzaCopies(products) {
  const chosen = new Map();
  const others = [];
  for (const product of products) {
    if (!isPizza(product)) {
      others.push(product);
      continue;
    }
    const key = pizzaFlavor(product.name);
    const current = chosen.get(key);
    if (!current) {
      chosen.set(key, product);
      continue;
    }
    const currentSized = mentionsPizzaSize(current.name);
    const nextSized = mentionsPizzaSize(product.name);
    if (currentSized && !nextSized) {
      chosen.set(key, product);
    } else if (currentSized === nextSized && product.name.length < current.name.length) {
      chosen.set(key, product);
    }
  }
  return [...others, ...chosen.values()];
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

function itemNotes(size, sauce, extra, note) {
  const topping = extra === "champinones" ? "champiñones" : extra;
  const baked = foldText(note) === "bien doradita" ? "" : bakeNote(note);
  return [size, sauce, topping, baked].filter(Boolean).join(", ");
}

export function lineQuote({ size, extra, extras, quantity }) {
  const priced = priceLine({ size, extra, extras, quantity: quantity ?? 1 });
  if (!priced.ok) {
    throw new Error(priced.error);
  }
  return { unit: priced.unit, total: priced.subtotal };
}

export function priceWithMushrooms(size) {
  const quote = lineQuote({ size, extra: "champinones", quantity: 1 });
  return { base: quote.unit - 25, total: quote.total };
}

async function loadExtraPrices(businessId) {
  if (!businessId) {
    return {};
  }
  const { data, error } = await supabase
    .from("menu_ingredients")
    .select("name,extra_price")
    .eq("business_id", businessId);
  if (error) {
    return {};
  }
  const prices = {};
  for (const row of data || []) {
    if (row.extra_price == null || !Number.isFinite(Number(row.extra_price))) {
      continue;
    }
    prices[foldIngredient(row.name)] = Number(row.extra_price);
  }
  return prices;
}

async function unavailableIngredientNames(businessId) {
  const { data, error } = await supabase
    .from("menu_ingredients")
    .select("name,available")
    .eq("business_id", businessId);
  if (error) {
    console.error("menu_ingredients", error.message);
    return new Set();
  }
  return new Set(
    (data || [])
      .filter(row => row.available === false)
      .map(row => foldIngredient(row.name))
  );
}

const DEFAULT_MENU_PRICES = {
  mediana: 200,
  grande: 220,
  familiar: 250,
  extra: 25,
  promoPair: 400
};

export async function loadPaymentFlags(businessId) {
  const flags = { card: true, transfer: true };
  if (!businessId) {
    return flags;
  }
  const { data } = await supabase
    .from("products")
    .select("name,available")
    .eq("business_id", businessId)
    .eq("category", "Ajustes");
  for (const row of data || []) {
    if (row.name === "pago-tarjeta") {
      flags.card = row.available !== false;
    }
    if (row.name === "pago-transferencia") {
      flags.transfer = row.available !== false;
    }
  }
  return flags;
}

export async function loadMenuPrices(businessId) {
  let { data, error } = await supabase
    .from("menu_settings")
    .select("mediana,grande,familiar,extra,promo_pair,open_time,close_time")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error && /open_time|close_time|PGRST204/i.test(error.message)) {
    const retry = await supabase
      .from("menu_settings")
      .select("mediana,grande,familiar,extra,promo_pair")
      .eq("business_id", businessId)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error || !data) {
    return { ...DEFAULT_MENU_PRICES, openTime: "", closeTime: "" };
  }
  return {
    mediana: Number(data.mediana) || DEFAULT_MENU_PRICES.mediana,
    grande: Number(data.grande) || DEFAULT_MENU_PRICES.grande,
    familiar: Number(data.familiar) || DEFAULT_MENU_PRICES.familiar,
    extra: Number(data.extra) || DEFAULT_MENU_PRICES.extra,
    promoPair: Number(data.promo_pair) || DEFAULT_MENU_PRICES.promoPair,
    openTime: data.open_time || "",
    closeTime: data.close_time || ""
  };
}

function clockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function hermosilloMinutes(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Hermosillo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0) % 24;
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

export function speakClock(value) {
  const minutes = clockMinutes(value);
  if (minutes == null) {
    return String(value || "");
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const names = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];
  const hour12 = hour % 12;
  const hourWord = hour12 === 1 ? "la una" : `las ${names[hour12]}`;
  const period = hour < 12 ? "de la mañana" : hour < 19 ? "de la tarde" : "de la noche";
  const minuteWord = minute === 0 ? "" : minute === 15 ? " y cuarto" : minute === 30 ? " y media" : ` y ${minute}`;
  return `${hourWord}${minuteWord} ${period}`;
}

export function kitchenClosedMessage({ openTime = "", closeTime = "", now = new Date() } = {}) {
  const open = clockMinutes(openTime);
  const close = clockMinutes(closeTime);
  if (open == null || close == null || open === close) {
    return "";
  }
  const current = hermosilloMinutes(now);
  const openNow = open < close
    ? current >= open && current < close
    : current >= open || current < close;
  if (openNow) {
    return "";
  }
  return `Hola, bienvenido a Pizzería Hermosillo. Por el momento estamos cerrados. Te recordamos que nuestro horario de atención es de ${speakClock(openTime)} a ${speakClock(closeTime)}. Que tengas buen día.`;
}

function promoDayKeys(description) {
  const match = String(description || "").match(/\[\[dias:([a-z,]*)\]\]/);
  return match ? match[1].split(",").filter(Boolean) : [];
}

function promoActiveToday(description) {
  const days = promoDayKeys(description);
  if (!days.length) {
    return true;
  }
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Hermosillo",
    weekday: "short"
  }).format(new Date());
  const today = { Sun: "dom", Mon: "lun", Tue: "mar", Wed: "mie", Thu: "jue", Fri: "vie", Sat: "sab" };
  return days.includes(today[short] || "");
}

function stripPromoDays(description) {
  return String(description || "").replace(/\s*\[\[dias:[a-z,]*\]\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

function blockedIngredients(product, unavailable) {
  if (!isPizza(product)) {
    return [];
  }
  return [...unavailable].filter(name => descriptionHasIngredient(product.description || "", name));
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

  const unavailable = await unavailableIngredientNames(businessId);
  const menuPrices = await loadMenuPrices(businessId);
  const sizePrices = {
    mediana: menuPrices.mediana,
    grande: menuPrices.grande,
    familiar: menuPrices.familiar
  };
  const products = withoutSizedPizzaCopies(data || []).filter(
    product => product.category !== "Ajustes"
      && blockedIngredients(product, unavailable).length === 0
      && (product.category !== "Promociones" || promoActiveToday(product.description))
  );
  const payments = await loadPaymentFlags(businessId);
  const extraPrices = await loadExtraPrices(businessId);

  return {
    pizza_sizes: sizePrices,
    extra_price: menuPrices.extra,
    extra_prices: extraPrices,
    promo_pair: menuPrices.promoPair,
    open_time: menuPrices.openTime || "",
    close_time: menuPrices.closeTime || "",
    payments,
    unavailableIngredients: [...unavailable],
    products: products.map(product => ({
      ...product,
      name: isPizza(product)
        ? String(product.name)
            .replace(/\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
        : product.name,
      description: isPizza(product) ? ingredientDescription(product.description) : stripPromoDays(product.description),
      price: isPizza(product) ? null : Number(product.price),
      sizes: isPizza(product) ? sizePrices : undefined,
      sauce_options: needsSauce(product)
        ? ["bbq", "buffalo"]
        : undefined
    }))
  };
}

export function formatMenuForPrompt(menu) {
  const allowed = menuIngredients().filter(
    name => !(menu.unavailableIngredients || []).includes(name)
  );
  const promos = (menu.products || []).filter(product => product.category === "Promociones");
  const cardOn = menu.payments?.card !== false;
  const transferOn = menu.payments?.transfer !== false;
  const paymentLine = !cardOn && !transferOn
    ? "Pagos: solo efectivo. Di exactamente: Por el momento solo aceptamos pagos en efectivo. No ofrezcas tarjeta ni transferencia."
    : `Pagos: efectivo${cardOn ? ", tarjeta" : ""}${transferOn ? ", transferencia" : ""}. Ofrece solo esos. No menciones un método que no esté aquí.`;
  const lines = [
    paymentLine,
    `Pizzas: mediana ${menu.pizza_sizes?.mediana ?? 200}, grande ${menu.pizza_sizes?.grande ?? 220}, familiar ${menu.pizza_sizes?.familiar ?? 250}. Extra ${menu.extra_price ?? 25}. Di el número solo. Nunca digas dólares, pesos ni el signo de dinero.`,
    promos.length
      ? `Promociones de hoy, hay que decirlas todas juntas si preguntan: ${promos.map(product => `${product.name} por ${Number(product.price).toFixed(0)}`).join("; ")}.`
      : "Hoy no hay promociones.",
    `Extras permitidos: ${allowed.join(", ") || "ninguno"}. Extra general ${menu.extra_price ?? 25}.${
      Object.keys(menu.extra_prices || {}).length
        ? ` Precio propio: ${Object.entries(menu.extra_prices).map(([name, price]) => `${name} ${price}`).join(", ")}.`
        : ""
    } Si un extra no tiene precio propio, di el extra general.`,
    "Si piden un ingrediente que no está en extras permitidos, di que no está disponible. No armes una pizza que no esté en esta lista."
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
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900
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

const HOUSE_NUMBERS = {
  ...SPANISH_NUMBERS,
  cien: 100,
  ciento: 100
};

export function cleanSpokenAddress(value) {
  let text = String(value || "")
    .replace(/\bpara empezar\b[,:]?\s*/gi, " ")
    .replace(/\bmi nombre es\s+(?:(?!mi direcci[oó]n es)[^\s,]+\s*){1,4}/gi, " ")
    .replace(/\bmi direcci[oó]n es\b/gi, " ")
    .replace(/\bes la colonia\b/gi, " ")
    .replace(/\bel c[oó]digo postal es\s+(\d{5})/gi, "C.P. $1")
    .replace(/\bmil\s+ciento\s+(\d{1,3})\b/gi, (_, digits) => String(1100 + Number(digits)));

  const codes = [...text.matchAll(/\b(\d{5})\b/g)].map(match => match[1]);
  if (codes.length > 1) {
    const keep = codes[0];
    let seen = 0;
    text = text.replace(/\bC\.?\s*P\.?\s*\d{5}\b|\b\d{5}\b/gi, (match) => {
      if (!/\d{5}/.test(match)) {
        return match;
      }
      seen += 1;
      return seen === 1 ? `C.P. ${keep}` : "";
    });
  }

  text = text.replace(/\s+(C\.P\.)/gi, ", $1");
  const parts = text
    .split(",")
    .map(part => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const unique = [];
  for (const part of parts) {
    const key = foldText(part);
    const already = unique.some(item => {
      const other = foldText(item);
      return other === key || other.includes(key) || key.includes(other);
    });
    if (!already) {
      unique.push(part);
    }
  }
  for (let index = unique.length - 1; index > 0; index -= 1) {
    if (/^\d{1,5}$/.test(unique[index]) && !/\d/.test(unique[index - 1])) {
      unique[index - 1] = `${unique[index - 1]} ${unique[index]}`;
      unique.splice(index, 1);
    }
  }

  return unique.join(", ").replace(/^[\s,]+/, "").trim();
}

const ADDRESS_SPEECH = /\b(para empezar|es la colonia|mi nombre es|mi direcci[oó]n es)\b/i;

function stripTrailingHouseWords(value, house) {
  const numberWord = /^(cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|y|numero|número|num)$/i;
  const words = String(value || "").replace(/[.]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length) {
    const last = words[words.length - 1];
    if (numberWord.test(last) || (house && last === String(house))) {
      words.pop();
      continue;
    }
    break;
  }
  return words.join(" ").trim();
}

export function deliveryAddress({ street = "", number = "", colony = "", postalCode = "", address = "" }) {
  if (ADDRESS_SPEECH.test(`${street} ${number} ${colony} ${address}`)) {
    throw new Error("La dirección trae una frase del cliente, no una calle. Pregunta otra vez: ¿Cuál es la calle y el número?");
  }
  const blob = cleanSpokenAddress(address);
  let streetName = cleanSpokenAddress(street);
  let house = String(number || "").replace(/\D/g, "");
  let colonyName = cleanSpokenAddress(colony);
  let postal = String(postalCode || "").replace(/\D/g, "");
  if (!/^\d{5}$/.test(postal)) {
    postal = blob.match(/\b(\d{5})\b/)?.[1] || "";
  }
  const blobParts = blob.split(",").map(part => part.trim()).filter(part => !/hermosillo|sonora|c\.?\s*p/i.test(part));
  if (!house) {
    const fromStreet = streetNumber(street || streetName || blob);
    house = fromStreet || streetName.match(/\b(\d{1,5})\b/)?.[1] || blob.match(/\b(\d{1,5})\b/)?.[1] || "";
    if (house === postal) {
      house = "";
    }
    streetName = streetName.replace(new RegExp(`\\b${house}\\b`), "").trim();
  }
  if (!streetName && blobParts[0]) {
    streetName = blobParts[0].replace(/\b\d{1,5}\b/, "").trim();
  }
  if (!colonyName) {
    colonyName = blobParts.find(part => part !== blobParts[0] && !/^\d+$/.test(part)) || "";
  }
  streetName = stripTrailingHouseWords(streetName, house).replace(/[,\s]+$/, "");
  const streetWords = foldText(streetName).split(" ").filter(Boolean);
  const numberOnly = streetWords.every(word => word in HOUSE_NUMBERS || word === "y" || word === "numero");
  if (!streetName || numberOnly || streetWords.length === 0) {
    throw new Error("Falta el nombre de la calle. Pregunta solo: ¿Cuál es la calle y el número?");
  }
  if (!house || !colonyName || !/^\d{5}$/.test(postal)) {
    throw new Error("Faltan calle, número, colonia o código postal. Pregunta solo el dato que falta, uno por uno.");
  }
  return `${streetName} ${house}, ${colonyName}, C.P. ${postal}, Hermosillo, Sonora`;
}

export function formatHeardStreet(utterance) {
  if (/\b(pizza|pizzas|promoci[oó]n|sabor|pedido|orden)\b/i.test(String(utterance || ""))) {
    return "";
  }
  const number = streetNumber(utterance);
  if (!number) {
    return "";
  }
  const name = String(utterance || "")
    .replace(/[.]/g, " ")
    .replace(/\b(n[uú]mero|num|no|casa|calle)\b/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/\b(cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|y)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 4) {
    return "";
  }
  return `${name} ${number}`;
}

export function lockStreet(address, heardStreet) {
  const heard = String(heardStreet || "").trim();
  if (!heard) {
    return address || "";
  }
  const heardName = foldText(heard.replace(/\s+\d+$/, ""));
  const current = String(address || "");
  if (heardName && foldText(current).includes(heardName)) {
    return current;
  }
  const parts = current.split(",").map(part => part.trim()).filter(Boolean);
  const streetIndex = parts.findIndex(
    part => /\d/.test(part) && !/c\.?\s*p/i.test(part) && !/hermosillo|sonora/i.test(part)
  );
  if (streetIndex >= 0) {
    parts[streetIndex] = heard;
    return parts.join(", ");
  }
  if (!parts.length) {
    return heard;
  }
  parts.splice(1, 0, heard);
  return parts.join(", ");
}

export function streetNumber(value) {
  const folded = foldText(value);
  const digits = folded.match(/(\d+)\s*$/);
  if (digits) {
    return digits[1];
  }
  const tokens = folded.split(" ").filter(token => token && token !== "y" && token !== "numero" && token !== "casa" && token !== "calle");
  const atoms = [];
  for (const token of tokens) {
    if (token in HOUSE_NUMBERS && HOUSE_NUMBERS[token] < 1000) {
      atoms.push(HOUSE_NUMBERS[token]);
    } else {
      atoms.length = 0;
    }
  }
  if (!atoms.length) {
    return "";
  }
  if (atoms.every(number => number < 10)) {
    return atoms.join("").slice(0, 5);
  }
  const groups = postalChunks(atoms);
  return String(groups[groups.length - 1] ?? "");
}

export function spokenDigitHouse(value) {
  const folded = foldText(value);
  if (/\d+\s*$/.test(folded)) {
    return false;
  }
  const tokens = folded.split(" ").filter(token => token && token !== "y" && token !== "numero" && token !== "casa" && token !== "calle");
  const atoms = [];
  for (const token of tokens) {
    if (token in HOUSE_NUMBERS && HOUSE_NUMBERS[token] < 10) {
      atoms.push(HOUSE_NUMBERS[token]);
    } else {
      atoms.length = 0;
    }
  }
  return atoms.length >= 2;
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

export function readPostalCode(value) {
  const folded = foldText(value);
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
    return { code: catalogHits[0], options: [], repaired: false };
  }
  if (catalogHits.length > 1) {
    return { code: "", options: catalogHits.slice(0, 4), repaired: false };
  }

  const repaired = [...new Set(
    [joined, digits].flatMap(insertions)
  )];
  if (repaired.length === 1) {
    return { code: repaired[0], options: [], repaired: true };
  }
  if (repaired.length > 1) {
    if (/\bciento\b/.test(folded)) {
      const withOne = repaired.find(cp => /^\d{2}1\d{2}$/.test(cp));
      if (withOne) {
        return { code: withOne, options: [], repaired: true };
      }
    }
    if (/\bcero\b/.test(folded)) {
      const withZero = repaired.find(cp => /^\d{2}0\d{2}$/.test(cp));
      if (withZero) {
        return { code: withZero, options: [], repaired: true };
      }
    }
    return { code: "", options: repaired.slice(0, 4), repaired: false };
  }

  return { code: "", options: [], repaired: false };
}

export function parseSpokenPostalCode(value) {
  return readPostalCode(value).code;
}

function postalPhonetic(value) {
  return foldText(value)
    .replace(/qu/g, "k")
    .replace(/ll/g, "y")
    .replace(/ce/g, "se")
    .replace(/ci/g, "si")
    .replace(/v/g, "b")
    .replace(/z/g, "s")
    .replace(/h/g, "")
    .replace(/c/g, "k")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function closestNumberWord(token) {
  if (!token || token.length < 4 || token in SPANISH_NUMBERS) {
    return "";
  }
  const heard = postalPhonetic(token);
  let best = "";
  let bestDistance = Infinity;
  let second = Infinity;
  for (const word of Object.keys(SPANISH_NUMBERS)) {
    if (word.length < 4) {
      continue;
    }
    const raw = editDistance(token, word);
    if (raw > 2) {
      continue;
    }
    const distance = Math.min(raw, editDistance(heard, postalPhonetic(word)));
    if (distance < bestDistance) {
      second = bestDistance;
      bestDistance = distance;
      best = word;
    } else if (distance < second) {
      second = distance;
    }
  }
  if (!best || bestDistance > 1 || second === bestDistance) {
    return "";
  }
  return best;
}

function repairPostalWords(utterance) {
  const tokens = foldText(utterance).split(" ").filter(Boolean);
  let changed = false;
  const fixed = tokens.map(token => {
    const word = closestNumberWord(token);
    if (!word) {
      return token;
    }
    changed = true;
    return word;
  });
  return changed ? fixed.join(" ") : "";
}

export function suggestPostal(utterance) {
  const messy = foldText(utterance).split(" ").some(token =>
    token.length >= 3
    && token !== "mil"
    && token !== "miles"
    && !(token in SPANISH_NUMBERS)
    && !/^\d+$/.test(token)
  );
  const fixed = messy ? repairPostalWords(utterance) : "";
  const reading = readPostalCode(fixed || utterance);
  if (reading.code && (messy || reading.repaired) && (!messy || fixed)) {
    return reading.code;
  }
  if (!fixed && reading.repaired && reading.code) {
    return reading.code;
  }
  return "";
}

export function acceptedPostal(utterance) {
  if (suggestPostal(utterance)) {
    return "";
  }
  const reading = readPostalCode(utterance);
  return reading.code && !reading.repaired ? reading.code : "";
}

function foldColony(value) {
  let text = foldText(value)
    .replace(/\bi\s+ese\s+ese\s+ese\s+te\s+e\b/g, "issste")
    .replace(/\bi\s+ese\s+ese\s+te\s+e\b/g, "issste")
    .replace(/\biztacalco\s+federal\b/g, "issste federal")
    .replace(/\biztacalco\b/g, "issste")
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

function coloniesByName() {
  if (colonyIndex) {
    return colonyIndex;
  }
  const map = new Map();
  for (const [postalCode, names] of Object.entries(hermosilloCatalog)) {
    for (const name of names) {
      const key = foldColony(name);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push({ colony: name, postalCode });
    }
  }
  colonyIndex = map;
  return map;
}

function colonyUtterance(utterance) {
  return foldColony(String(utterance || "")
    .replace(/\bno (me lo |me |lo )?(se|acuerdo|recuerdo)\b/gi, " ")
    .replace(/\b(el c[oó]digo postal|c[oó]digo postal|c[oó]digo)\b/gi, " ")
    .replace(/\b(colonia|fraccionamiento|fracc|barrio)\b/gi, " ")
    .replace(/[^a-z0-9áéíóúñ\s]/gi, " "));
}

export function suggestColony(utterance, postalCode = "") {
  const said = colonyUtterance(utterance);
  if (!said || said.length < 4 || /^(no|si|gracias)$/.test(said)) {
    return null;
  }
  const ranked = [];
  for (const [key, rows] of coloniesByName()) {
    const score = colonyScore(said, key);
    if (score < 64 || score >= 88) {
      continue;
    }
    const fitting = postalCode ? rows.filter(item => item.postalCode === postalCode) : rows;
    if (fitting.length === 1) {
      ranked.push({ score, colony: fitting[0].colony, postalCode: fitting[0].postalCode });
    }
  }
  ranked.sort((left, right) => right.score - left.score);
  if (!ranked.length) {
    return null;
  }
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 8) {
    return null;
  }
  return { colony: ranked[0].colony, postalCode: ranked[0].postalCode };
}

export function postalFromColony(utterance) {
  const said = colonyUtterance(utterance);
  if (!said || said.length < 3 || /^(no|si|gracias)$/.test(said)) {
    return { colony: "", postalCode: "", options: [], exact: false };
  }
  const exact = coloniesByName().get(said) || [];
  if (exact.length === 1) {
    return { colony: exact[0].colony, postalCode: exact[0].postalCode, options: [], exact: true };
  }
  if (exact.length > 1) {
    return { colony: "", postalCode: "", options: exact, exact: false };
  }
  const ranked = [];
  for (const [key, rows] of coloniesByName()) {
    const score = colonyScore(said, key);
    if (score >= 88) {
      ranked.push({ score, rows });
    }
  }
  ranked.sort((left, right) => right.score - left.score);
  if (!ranked.length) {
    return { colony: "", postalCode: "", options: [], exact: false };
  }
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 12) {
    if (ranked[0].rows.length === 1) {
      return { colony: ranked[0].rows[0].colony, postalCode: ranked[0].rows[0].postalCode, options: [], exact: false };
    }
    return { colony: "", postalCode: "", options: ranked[0].rows, exact: false };
  }
  return {
    colony: "",
    postalCode: "",
    options: ranked.slice(0, 3).flatMap(item => item.rows).slice(0, 4),
    exact: false
  };
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
function spellPostalCode(cp) {
  const words = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  return String(cp || "").split("").map(digit => words[Number(digit)] || digit).join(", ");
}

export async function checkAddressTool({
  postalCode,
  street,
  colony
}) {
  const reading = readPostalCode(postalCode);
  if (reading.options.length > 1) {
    return {
      ok: false,
      options: reading.options,
      error: `Puede ser ${reading.options.join(" o ")}. Pregunta cuál de esos códigos es, sin elegir uno.`
    };
  }
  const cp = reading.code;
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
      note: `El código es de Hermosillo. Dilo despacio: ${spellPostalCode(cp)}. Pregunta solo cuál es la colonia.`
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
      note: `La colonia dicha por el cliente se queda: ${colony.trim()}. No la cambies por otra. No ofrezcas ${options.slice(0, 3).join(", ") || "otra colonia"}. Pregunta solo si ese código postal es de esa colonia.`
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
    note: dictatedStreet
      ? `Confirmado. Di despacio: ${match}, ${dictatedStreet}. Código ${spellPostalCode(cp)}.`
      : `${match}, ${spellPostalCode(cp)}. Pregunta solo: ¿Cuál es la calle y el número? No confirmes el domicilio todavía.`
  };
}

async function saveOrder({
  businessId,
  callId,
  customerName,
  customerPhone,
  orderType,
  address,
  street,
  number,
  colony,
  postalCode,
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
        spoken: `Su pedido ya quedó confirmado. Total ${existing.total}. Llegará en aproximadamente 30 minutos. Muchas gracias por llamar a Pizzería Hermosillo. Hasta luego.`,
        note: "Este pedido ya quedó guardado. No lo vuelvas a crear. Di spoken y despídete."
      };
    }
  }

  orderType = orderType || "delivery";
  paymentMethod = paymentForOrder(orderType, paymentMethod || "efectivo");
  if (orderType === "delivery" || !orderType) {
    address = deliveryAddress({ street, number, colony, postalCode, address });
  } else {
    address = cleanSpokenAddress(address);
  }
  const payments = await loadPaymentFlags(businessId);
  if (paymentMethod === "tarjeta" && !payments.card) {
    throw new Error("La tarjeta está apagada. Di que por el momento no se puede pagar con tarjeta.");
  }
  if (paymentMethod === "transferencia" && !payments.transfer) {
    throw new Error("La transferencia está apagada. Di que por el momento no se puede pagar con transferencia.");
  }

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
    (!address?.trim() || !/\d/.test(address))
  ) {
    throw new Error(
      "Falta la calle y el número. Pregunta solo: ¿Cuál es la calle y el número?"
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
        "id,name,description,price,available,business_id,category"
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

  const unavailable = await unavailableIngredientNames(businessId);
  const menuPrices = await loadMenuPrices(businessId);
  const sizePrices = {
    mediana: menuPrices.mediana,
    grande: menuPrices.grande,
    familiar: menuPrices.familiar
  };
  const allowedExtras = menuIngredients().filter(name => !unavailable.has(name));
  const extraPrices = await loadExtraPrices(businessId);
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

    if (!product.available || (product.category === "Promociones" && !promoActiveToday(product.description))) {
      throw new Error(
        `El producto ${product.name} no está disponible.`
      );
    }

    const missing = blockedIngredients(product, unavailable);
    if (missing.length) {
      throw new Error(
        `${product.name} no está disponible porque falta ${missing.join(", ")}. Di que no se puede pedir.`
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

    const requested = [
      ...(Array.isArray(item.extras) ? item.extras : []),
      item.extra
    ].filter(Boolean);
    const extras = isPizza(product)
      ? billableExtras(requested, product.description, allowedExtras)
      : [];
    const priced = isPizza(product)
      ? priceLine({
        size,
        extras,
        quantity: 1,
        catalog: allowedExtras,
        prices: sizePrices,
        extraPrice: menuPrices.extra,
        extraPrices
      })
      : null;

    if (priced && !priced.ok) {
      throw new Error(priced.error);
    }

    if (isPizza(product)) {
      unitPrice = priced.unit;
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

    const half = /\bmitad\b/i.test(String(item.note || "")) ? String(item.note) : "";
    calculatedItems.push({
      product_id: product.id,
      name: half ? `Pizza ${half}` : product.name,
      quantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(
        size,
        sauce,
        priced?.extras?.map(entry => entry.nombre).join(", "),
        half ? "" : (item.note || item.comment)
      ) || null
    });
  }

  const grandeLines = calculatedItems.filter(item => String(item.notes || "").split(",")[0].trim() === "grande");
  const grandeUnits = grandeLines.reduce((sum, item) => sum + item.quantity, 0);
  if (grandeLines.length >= 2 && grandeUnits === 2) {
    for (const item of calculatedItems) {
      const size = String(item.notes || "").split(",")[0].trim();
      if (size !== "grande") {
        continue;
      }
      const cut = (menuPrices.grande - menuPrices.promoPair / 2) * item.quantity;
      item.subtotal -= cut;
      item.unit_price = item.subtotal / item.quantity;
      total -= cut;
      item.notes = item.notes
        ? `${item.notes}, promoción dos grandes`
        : "promoción dos grandes";
    }
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

  const confirmation = buildConfirmation({
    customerName,
    orderType,
    address,
    paymentMethod,
    postalCode: (address || "").match(/\b(\d{5})\b/)?.[1] || "",
    items: calculatedItems.map(item => {
      const notes = (item.notes || "").split(",").map(part => part.trim()).filter(Boolean);
      const extras = notes.slice(1).filter(part => part !== "bbq" && part !== "buffalo" && part !== "Bien doradita" && !part.startsWith("promoción") && !/^mitad\b/i.test(part));
      return {
        name: item.name,
        size: notes[0],
        extras,
        quantity: item.quantity,
        unit: item.unit_price
      };
    }),
    prices: sizePrices,
    extraPrice: menuPrices.extra,
    extraPrices,
    promoPair: menuPrices.promoPair
  });

  return {
    success: true,
    order_id: order.id,
    total,
    currency: "MXN",
    payment_method: paymentMethod,
    customer_name: customerName,
    order_number: String(order.order_number || nextNumber || "1"),
    spoken: confirmation.ok
      ? confirmation.spoken
      : `¡Excelente! Su pedido quedó confirmado. El precio es ${total}. Llegará en aproximadamente 30 minutos a su domicilio. Que tenga buen día y gracias por llamar a Pizzería Hermosillo.`
  };
}

export function createOrderTool(args) {
  if (!args?.callId) {
    return saveOrder(args);
  }
  return withCallLock(args.callId, () => saveOrder(args));
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
    .select("id,customer_id,address,total,created_at,status,notes,order_number")
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
      status: order.status || "new",
      notes: order.notes || "",
      order_number: order.order_number || "",
      items: items || []
    };
  }

  return { found: false };
}

const ORDER_STATUS_SPOKEN = {
  preparing: "Tu pedido sigue preparándose, pero pronto se lo daremos al repartidor y saldrá directo a tu domicilio a entregarlo. ¿Tienes alguna duda?",
  delivering: "Tu pedido se encuentra en camino. En 10 minutos aproximadamente debería de estar en tu domicilio."
};

export async function orderStatusTool({ businessId, callerPhone }) {
  const phone = normalizePhone(callerPhone);
  if (!businessId || !phone) {
    return { found: false, spoken: "No encuentro un pedido de hoy en este teléfono." };
  }

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Hermosillo" }).format(new Date());
  const start = new Date(`${day}T00:00:00-07:00`).toISOString();
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id,customer_id,status,created_at,deleted_at")
    .eq("business_id", businessId)
    .gte("created_at", start)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(12);

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
      .select("name,quantity,notes")
      .eq("order_id", order.id);
    if (itemsError) {
      throw itemsError;
    }
    const status = order.status || "new";
    return {
      found: true,
      status,
      customer_name: customer?.name || "",
      items: items || [],
      spoken: ORDER_STATUS_SPOKEN[status] || "Tu pedido ya está registrado. ¿Tienes alguna duda?"
    };
  }

  return { found: false, spoken: "No encuentro un pedido de hoy en este teléfono." };
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

  if (last.status === "delivering") {
    throw new Error(
      "Ese pedido ya va en camino. No se puede agregar nada."
    );
  }

  const expected = (last.customer_name || "").trim().toLowerCase();
  const given = (customerName || "").trim();
  let savedName = last.customer_name;

  if (given && expected && expected !== given.toLowerCase()) {
    throw new Error(
      `El pedido reciente está a nombre de ${last.customer_name}. No lo cambies. Pregunta cuál pedido hay que modificar.`
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
    .insert({
      order_id: last.order_id,
      product_id: product.id,
      name: product.name,
      quantity: nextQuantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce) || null
    });

  if (itemError) {
    throw itemError;
  }

  const { data: lines, error: linesError } = await supabase
    .from("order_items")
    .select("subtotal")
    .eq("order_id", last.order_id);
  if (linesError) {
    throw linesError;
  }
  const total = (lines || []).reduce((sum, line) => sum + Number(line.subtotal || 0), 0);
  const added = `Se agregó ${product.name}${nextSize ? ` ${nextSize}` : ""}.`;
  const previousNotes = String(last.notes || "").replace(/\[\[agregado]][\s\S]*?(?=\n|$)/g, "").trim();
  const { error: orderError } = await supabase
    .from("orders")
    .update({
      total,
      notes: `[[agregado]]${added}${previousNotes ? `\n${previousNotes}` : ""}`
    })
    .eq("id", last.order_id);

  if (orderError) {
    throw orderError;
  }

  return {
    success: true,
    order_id: last.order_id,
    customer_name: savedName,
    note: "Se agregó la pizza. Las pizzas anteriores siguen en el pedido. No las borres.",
    item: product.name,
    notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce),
    total
  };
}

const transfersStarted = new Set();

export function humanTransferStarted(callSid) {
  return transfersStarted.has(callSid);
}

export function abandonHumanTransfer(callSid) {
  markTransferFailed(callSid);
  transfersStarted.delete(callSid);
}

export async function transferToHumanTool(callSid) {
  if (!callSid) {
    return { success: false, spoken: "No pudieron tomar la llamada. Yo sigo con su pedido." };
  }
  const gate = requestTransfer(callSid);
  console.log(JSON.stringify({
    event: "transfer_requested",
    callSid,
    at: new Date().toISOString(),
    state: gate.state
  }));
  if (!gate.accepted) {
    return { success: true, duplicate: true, state: gate.state };
  }
  transfersStarted.add(callSid);
  const number = /^\+\d{10,15}$/.test(config.humanTransferNumber)
    ? config.humanTransferNumber
    : "+526621383780";
  let callerId = "";
  try {
    const live = await twilio(config.twilioAccountSid, config.twilioAuthToken)
      .calls(callSid)
      .fetch();
    callerId = normalizePhone(live.to);
  } catch {
    callerId = "";
  }
  if (!/^\+\d{10,15}$/.test(number)) {
    markTransferFailed(callSid);
    transfersStarted.delete(callSid);
    console.log(JSON.stringify({ event: "transfer_failed", callSid, at: new Date().toISOString(), error: "numero" }));
    return { success: false, spoken: "No pudieron tomar la llamada. Yo sigo con su pedido." };
  }
  let base = config.publicVoiceBaseUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  const twiml = transferTwiml(number, `${base}/twilio/transfer-result`, callerId);
  console.log(JSON.stringify({
    event: "transfer_started",
    callSid,
    at: new Date().toISOString(),
    number: maskNumber(number)
  }));
  try {
    await twilio(config.twilioAccountSid, config.twilioAuthToken)
      .calls(callSid)
      .update({ twiml });
  } catch (error) {
    markTransferFailed(callSid);
    transfersStarted.delete(callSid);
    console.log(JSON.stringify({
      event: "transfer_failed",
      callSid,
      at: new Date().toISOString(),
      number: maskNumber(number),
      error: error.message
    }));
    return { success: false, spoken: "No pudieron tomar la llamada. Yo sigo con su pedido." };
  }
  markTransferred(callSid);
  console.log(JSON.stringify({
    event: "transfer_completed",
    callSid,
    at: new Date().toISOString(),
    number: maskNumber(number)
  }));
  return { success: true, state: "TRANSFERRED" };
}

export async function endCallTool(callSid, delayMs = 8000) {
  if (!callSid) {
    return { success: false };
  }

  await new Promise(resolve => setTimeout(resolve, delayMs));

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
