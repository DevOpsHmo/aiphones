import { mushroomIntent, mentionedQuantity } from "./turn-policy.js";
import { buildConfirmation, paymentForOrder, priceLine } from "./confirmation.js";
import { matchIngredients } from "./menu-ingredients.js";
import { acceptedPostal, formatHeardStreet, parseSpokenPostalCode, postalFromColony, speakClock, streetNumber, suggestColony, suggestPostal } from "./tools.js";

export const MENU_PIZZAS = [
  "BBQ Chicken",
  "Chicken Alfredo",
  "Chipotle Chicken",
  "Ostiones",
  "Deluxe",
  "Hawaina",
  "Italiana",
  "Lucco Boneless",
  "Marguerita",
  "Mexicana",
  "Peperoni",
  "Sinaloense",
  "Spincacoli",
  "Stromboli",
  "Veggie"
];

const SIZES = ["mediana", "grande", "familiar"];

export function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function titleName(value) {
  return value.split(" ").filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function correctName(current, utterance) {
  const text = fold(utterance);
  const full = text.match(/\bmi nombre es\s+([a-z]+(?:\s+[a-z]+){0,2})/);
  if (full) {
    return { name: titleName(full[1]), needsLastName: full[1].split(" ").length < 2 };
  }
  const matches = [...text.matchAll(/\bsoy\s+([a-z]+)\b/g)];
  const renamed = matches.at(-1);
  const denied = /\bno soy\b/.test(text) || /\botra persona\b/.test(text);
  if (denied && !renamed && !full) {
    return { name: "", needsLastName: true };
  }
  if (renamed && (denied || renamed[1] !== fold(current).split(" ")[0])) {
    const first = renamed[1][0].toUpperCase() + renamed[1].slice(1);
    return { name: first, needsLastName: true };
  }
  return { name: current, needsLastName: false };
}

function drinkVolume(utterance) {
  const text = fold(utterance);
  if (/\b(600|seiscientos)\b/.test(text)) {
    return "600";
  }
  if (/\b(dos litros|2 litros)\b/.test(text)) {
    return "2 litros";
  }
  return "";
}

export function drinkQuestion(utterance, drink = {}) {
  if (drink.volume) {
    return null;
  }
  const text = fold(utterance);
  const chosen = /\b(light|ligera|lite)\b/.test(text) ? "Light" : /\bregular\b/.test(text) ? "regular" : "";
  const waiting = drink.kind === "coca" || drink.kind === "regular" || drink.kind === "Light" || drink.kind === "fresa";
  const volume = drinkVolume(utterance);
  if ((/\bfresa\b/.test(text) || drink.kind === "fresa") && !volume) {
    return { say: "Refresco de fresa, ¿600 mililitros o 2 litros?", drink: { kind: "fresa" } };
  }
  if (drink.kind === "fresa" && volume) {
    return { drink: { kind: "fresa", volume } };
  }
  if (/\b(coca|soda)\b/.test(text) || waiting) {
    const kind = chosen || (drink.kind === "regular" || drink.kind === "Light" ? drink.kind : "");
    if (!kind) {
      return { say: "Coca-Cola, ¿regular o Light?", drink: { kind: "coca" } };
    }
    if (!volume) {
      return { say: `Coca-Cola ${kind}, ¿600 mililitros o 2 litros?`, drink: { kind } };
    }
    return { drink: { kind, volume } };
  }
  return null;
}

export function heardSauce(utterance) {
  const text = fold(utterance);
  if (/buffalo|bufalo|bufal/.test(text)) {
    return "buffalo";
  }
  if (/\bbbq\b|barbecue|barbacoa|barbiqu|barbicu|barbi/.test(text)) {
    return "bbq";
  }
  return "";
}

export function sauceWord(sauce) {
  if (sauce === "bbq") {
    return "barbiquiú";
  }
  if (sauce === "buffalo") {
    return "búfalo";
  }
  return sauce || "";
}

function asksIngredients(text) {
  const clean = text.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(ingredientes?|que trae|que lleva|que tiene|que contiene|de que esta|que incluye|con que viene|que le ponen|que le echan)\b/.test(clean)) {
    return true;
  }
  const words = clean.split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 4 && /\btrae\b/.test(clean);
}

function asksPrice(text) {
  return /\b(precio|precios|cuesta|cuestan|cuanto|beneficio|beneficios|a como)\b/.test(text);
}

function asksMenu(text) {
  if (/\b(promocion|oferta|bebida|refresco|horario|ingrediente)\b/.test(text)) {
    return false;
  }
  return /\b(que hay|que manejan|que manejas|el menu|que pizzas|que sabores|que venden)\b/.test(text)
    || (/\bpizzas\b/.test(text) && /\b(que|cuales)\b/.test(text) && !/\b(cuanto|precio|cuesta)\b/.test(text));
}

function looksLikeAsk(utterance, text) {
  if (/[?¿]/.test(String(utterance || ""))) {
    return true;
  }
  if (/\b(chilo|chila|recomienda|recomiendas)\b/.test(text)) {
    return true;
  }
  return /^(que |cual |cuales |cuanto |cuando |donde |a que hora|tienen |hay |aceptan |puedo |se puede|me puede|me pueden|hasta que|todavia)\b/.test(text);
}

function asksPromotions(text) {
  if (/\b(dos|2)\s+grandes?\b/.test(text) || /\b(dos|2)\s+familiares?\b/.test(text)) {
    return false;
  }
  if (/\b(quiero|deme|dame|ponme|pido|puedes dar|me das|van a ser)\b/.test(text)) {
    return false;
  }
  return /\bpromocion/.test(text);
}

function asksDrinkMenu(text) {
  return /\b(que bebidas|que refrescos|que sodas|bebidas tienes|refrescos tienes|tienen de tomar)\b/.test(text)
    || (/\bbebidas?\b/.test(text) && /\b(que|cuales|tienes|tienen|hay)\b/.test(text) && !/\b(agregar|desea|alguna)\b/.test(text));
}

function asksOwnPizzas(text) {
  return /\b(de que son|mis pizzas|que pizzas pedi|que pedi)\b/.test(text);
}

function pairRequest(text) {
  const grande = /\bgrandes?\b/.test(text);
  const familiar = /\bfamiliares?\b/.test(text);
  const mediana = /\bmedianas?\b/.test(text);
  const two = /\b(dos|2)\b/.test(text);
  const promo = /\bpromocion\b/.test(text);
  if (mediana && (two || promo)) {
    return "";
  }
  if (grande && !familiar && (two || promo)) {
    return "grande";
  }
  if (familiar && !grande && (two || promo)) {
    return "familiar";
  }
  return "";
}

function unsupportedPair(text) {
  return /\bmedianas?\b/.test(text) && (/\b(dos|2)\b/.test(text) || /\bpromocion\b/.test(text));
}

function sizeWord(size, plural) {
  if (size === "familiar") {
    return plural ? "familiares" : "familiar";
  }
  if (size === "grande") {
    return plural ? "grandes" : "grande";
  }
  return plural ? "medianas" : "mediana";
}

function finishing(text) {
  if (/\bno es todo\b/.test(text) || /\btodavia no\b/.test(text) || /\baun no\b/.test(text)) {
    return "more";
  }
  if (/\b(es todo|seria todo|nada mas|eso es todo|ya es todo|con eso|muchas gracias)\b/.test(text) || /\btodo\b/.test(text)) {
    return "done";
  }
  if (/^(no|nop|nada|ninguna|ninguno|listo|gracias)\b/.test(text)) {
    return "done";
  }
  return "";
}

function notAPlace(text) {
  const clean = String(text || "").trim();
  if (!clean || finishing(clean)) {
    return true;
  }
  return /^(hola|si|sip|bueno|ok|okay)$/.test(clean) || looksLikeQuestion(clean);
}

const PIZZA_PATTERNS = [
  [/hawai\w*|saway\w*|awaina\w*|awaiana\w*/g, "Hawaina"],
  [/boneless|bonles|boneles|bodwe|\bbaule\w*|\bbaules\b|\bbound\w*/g, "Lucco Boneless"],
  [/\bdeluxe\b|\bde luz\b|\bluz\b/g, "Deluxe"],
  [/tejicana\w*|mejicana\w*|mexicana\w*/g, "Mexicana"],
  [/\bitaliana\w*/g, "Italiana"],
  [/\bmarguerita\w*|\bmargarita\w*/g, "Marguerita"],
  [/peperoni\w*|pepperoni\w*/g, "Peperoni"],
  [/\bsinaloense\w*/g, "Sinaloense"],
  [/\bspincacoli\w*/g, "Spincacoli"],
  [/\bstromboli\w*/g, "Stromboli"],
  [/\bveggie\w*|\bvegetariana\w*/g, "Veggie"],
  [/\bchipotle\w*/g, "Chipotle Chicken"],
  [/\balfredo\w*/g, "Chicken Alfredo"],
  [/\bostion\w*/g, "Ostiones"],
  [/\bbbq chicken\b|\bbarbecue chicken\b/g, "BBQ Chicken"]
];

export function listedPizzas(utterance) {
  const text = fold(utterance);
  const hits = [];
  for (const [re, name] of PIZZA_PATTERNS) {
    const flags = new RegExp(re.source, "g");
    let match;
    while ((match = flags.exec(text))) {
      if (name === "Peperoni") {
        const before = text.slice(Math.max(0, match.index - 24), match.index);
        if (/\b(extra|con|agrega|agregale|ponle)\b/.test(before)) {
          continue;
        }
      }
      hits.push({ index: match.index, name });
    }
  }
  hits.sort((left, right) => left.index - right.index);
  const unique = [];
  for (const hit of hits) {
    if (!unique.includes(hit.name)) {
      unique.push(hit.name);
    }
  }
  return unique;
}

export function isVocabularyEcho(value) {
  const text = fold(value).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return false;
  }
  if (text.includes("issste federal") && text.includes("modelo") && text.includes("boneless") && text.includes("precio")) {
    return true;
  }
  const markers = ["issste", "modelo", "hermosillo", "mediana", "familiar", "boneless", "barbiquiu", "bufalo", "colonia", "precio", "coca", "light", "domicilio"];
  const hits = markers.filter(token => new RegExp(`\\b${token}\\b`).test(text));
  return hits.length >= 6;
}

export function strayEcho(utterance, state = {}) {
  const text = fold(utterance).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "hermosillo") {
    return true;
  }
  if (text !== "modelo") {
    return false;
  }
  return !(state.fulfillment === "delivery" && !state.colony);
}

function spokenPizza(name) {
  return fold(name).includes("boneless") ? "boneless" : name;
}

function promoSay(next) {
  const promos = Array.isArray(next.promotions) ? next.promotions.filter(item => item && item.name) : [];
  if (!promos.length) {
    return "Las promociones de hoy son: dos familiares por 450 y dos grandes por 400.";
  }
  const line = promos
    .map(item => `${item.name} por ${Math.round(Number(item.price) || 0)}`)
    .join(" y ");
  return `Las promociones de hoy son: ${line}.`;
}

function ownPizzasSay(next) {
  const lines = [...(next.items || [])];
  if (next.product) {
    lines.push({ product: next.product, size: next.size || next.pairSize || "" });
  }
  if (!lines.length) {
    const which = next.pairNeed === 2 ? " ¿De qué sabor quiere la primera?" : " ¿Cuál desea?";
    return `Todavía no me ha dicho el sabor.${which}`;
  }
  const spoken = lines.map(item => `una ${item.size ? `${item.size} ` : ""}de ${spokenPizza(item.product)}`).join(" y ");
  return `Sus pizzas son ${spoken}.`;
}

function moneyOf(next) {
  const prices = next.prices || { mediana: 200, grande: 220, familiar: 250 };
  const extra = Number(next.extraPrice ?? 25);
  return { prices, extra };
}

function orderLines(next) {
  const lines = [...(next.items || [])];
  if (next.product && (next.size || next.pairSize)) {
    lines.push({
      product: next.product,
      size: next.size || next.pairSize,
      extras: next.extras || [],
      sauce: next.sauce || ""
    });
  }
  return lines;
}

function totalSay(next) {
  const { prices, extra } = moneyOf(next);
  const lines = orderLines(next);
  if (!lines.length || lines.some(item => !prices[item.size])) {
    return `Para decirle el total necesito sabor y tamaño. ${priceSay(next)}`;
  }
  const plainGrandes = lines.filter(item => item.size === "grande" && !(item.extras || []).length).length === 2
    && lines.length === 2;
  const plainFamiliares = lines.filter(item => item.size === "familiar" && !(item.extras || []).length).length === 2
    && lines.length === 2;
  let total = 0;
  for (const item of lines) {
    let unit = prices[item.size] + (item.extras || []).length * extra;
    if (plainGrandes) {
      unit = 200;
    }
    if (plainFamiliares) {
      unit = 225;
    }
    total += unit;
  }
  const drink = next.drink || {};
  if (drink.volume === "600") {
    total += 30;
  }
  if (drink.volume === "2 litros") {
    total += 50;
  }
  return `Su total va en ${total}. El domicilio no cobra envío aparte.`;
}

function hoursSay(next) {
  if (next.openTime && next.closeTime) {
    return `El horario es de ${speakClock(next.openTime)} a ${speakClock(next.closeTime)}. El domicilio se toma dentro de ese horario.`;
  }
  return "El horario es el del local. Si ya cerramos, la llamada se lo dice al entrar.";
}

function paymentSay(next) {
  const card = next.payments?.card !== false;
  const transfer = next.payments?.transfer !== false;
  const pickup = [
    "efectivo",
    card ? "tarjeta" : "",
    transfer ? "transferencia" : ""
  ].filter(Boolean).join(", ");
  return `A domicilio el pago es en efectivo, al recibir. Para recoger puede pagar con ${pickup}. La factura se pide en la sucursal.`;
}

function customerQuestion(next, utterance, text) {
  if (!looksLikeAsk(utterance, text)) {
    return null;
  }
  if (/\b(llego mal|equivocad|falt[oó]|cobraron|fria|quemad|cruda|danad|incompleto|reclam)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Lamento que el pedido haya salido mal. Si quiere, lo comunico con un encargado."
    };
  }
  if (/\b(ya esta listo|donde esta mi pedido|cuanto falta|ya salio|estado de mi pedido|ya viene el repartidor|por que esta tardando|se retraso)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      status: true,
      say: "Reviso el pedido de este teléfono."
    };
  }
  if ((pairRequest(text) || listedPizzas(utterance).length) && !/\b(lleva|trae|ingrediente|cuesta|precio|sale|cuanto)\b/.test(text)) {
    return null;
  }
  if (/\b(horario|abren|cierran|abiertos|domingo|festivo|hasta que hora)\b/.test(text) || /\ba que hora\b/.test(text)) {
    return { state: next, hangup: false, answered: true, say: hoursSay(next) };
  }
  if (/\b(tarjeta|transferencia|efectivo|factura|debito|credito|formas de pago)\b/.test(text)) {
    return { state: next, hangup: false, answered: true, say: paymentSay(next) };
  }
  if (/\b(envio|envios|costo de envio|cobran por llevar|cargo)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "El envío no tiene costo extra dentro de Hermosillo. El domicilio llega en unos 30 minutos."
    };
  }
  if (/\b(tarda|demora|cuanto tiempo|repartidor|entrega rapida)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "El domicilio llega en unos 30 minutos. Para recoger también queda en unos 30 minutos."
    };
  }
  if (/\b(llegan|zona de entrega|cobertura|hasta donde)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Repartimos en Hermosillo. Dígame su código postal y le confirmo si llegamos."
    };
  }
  if (/\b(donde estan|donde queda|sucursal|como llego|estacionamiento)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Estamos en Hermosillo. Si va a recoger, le confirmo la sucursal al cerrar el pedido."
    };
  }
  if (/\b(mitad|mitad y mitad)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "No armamos mitad y mitad. Puede pedir dos pizzas, cada una de un sabor."
    };
  }
  if (/\b(rebanadas|para cuantas|cuanto mide|que tamanos|tamanos manejan|tamanos tienen)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Manejamos mediana, grande y familiar. La familiar es la más grande. No tengo las medidas en centímetros ni el número de rebanadas."
    };
  }
  if (/\b(ingrediente extra|queso extra|doble queso|doble pepperoni|cuanto cuesta agregar|cuanto cuesta el extra)\b/.test(text)) {
    const { extra } = moneyOf(next);
    return {
      state: next,
      hangup: false,
      answered: true,
      say: `El ingrediente extra cuesta ${extra}. Quitar un ingrediente no tiene costo.`
    };
  }
  if (/\b(vegetariana|sin carne|no come carne)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Sí, tenemos la pizza Veggie. También le puedo quitar la carne a otra pizza."
    };
  }
  if (/\b(solo queso|solamente con queso|solamente de queso|pizza de queso)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "La más sencilla de queso es la Marguerita. Si quiere, se la anoto."
    };
  }
  if (/\b(pepsi|agua|alitas|papas|postre|ensalada|pasta)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Eso no lo manejamos. De bebida tenemos Coca-Cola regular, Coca-Cola Light y refresco de fresa."
    };
  }
  if (/\b(2x1|dos por uno|segunda pizza tiene descuento)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: `Hoy no tenemos dos por uno. ${promoSay(next)}`
    };
  }
  if (/\b(recomienda|recomiendas|mas vendida|mas popular|especialidad de|chilo|chila|esta rico|esta rica)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "La gente pide mucho peperoni, hawaiana y mexicana. ¿Cuál desea?"
    };
  }
  if (/\b(total|cuanto voy a pagar|cuanto seria|cuanto es todo|cuanto sale mi pedido|cuanto queda)\b/.test(text)) {
    return { state: next, hangup: false, answered: true, say: totalSay(next) };
  }
  const oneSize = ["mediana", "grande", "familiar"].filter(size => text.includes(size));
  if (/\b(puedo pedir|como puedo hacer un pedido|pedir por telefono|me puede tomar)\b/.test(text) && !pairRequest(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Sí, con gusto le tomo el pedido por teléfono. ¿De qué sabor y de qué tamaño?"
    };
  }
  if (oneSize.length === 1 && /\b(cuesta|cuestan|precio|sale|cuanto)\b/.test(text) && !/\b(envio|total|tarda)\b/.test(text)) {
    const { prices } = moneyOf(next);
    return {
      state: next,
      hangup: false,
      answered: true,
      say: `La ${oneSize[0]} cuesta ${Math.round(Number(prices[oneSize[0]]) || 0)}.`
    };
  }
  return null;
}

function infoReply(next, utterance, text) {
  const asked = customerQuestion(next, utterance, text);
  if (asked) {
    return asked;
  }
  if (unsupportedPair(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: `No hay promoción de dos pizzas medianas. ${promoSay(next)} ¿Quiere dos grandes o dos familiares?`
    };
  }
  if (asksPromotions(text) || (looksLikeAsk(utterance, text) && /\b(oferta|combo)\b/.test(text))) {
    return { state: next, hangup: false, answered: true, say: promoSay(next) };
  }
  if (asksDrinkMenu(text)) {
    return {
      state: next,
      hangup: false,
      answered: true,
      say: "Tenemos Coca-Cola regular, Coca-Cola Light y refresco de fresa. La de 600 mililitros cuesta 30 y la de 2 litros cuesta 50."
    };
  }
  if (asksOwnPizzas(text)) {
    return { state: next, hangup: false, answered: true, say: ownPizzasSay(next) };
  }
  if (asksIngredients(text)) {
    const asked = matchPizza(utterance) || next.product;
    if (asked && !next.product && !next.pairNeed) {
      next.product = asked;
    }
    const description = describePizza(next.descriptions, asked);
    return {
      state: next,
      hangup: false,
      answered: true,
      say: asked
        ? (description
          ? `La pizza ${spokenPizza(asked)} trae ${description}.`
          : `No tengo anotados los ingredientes de la pizza ${spokenPizza(asked)}.`)
        : "¿De cuál pizza quiere saber los ingredientes?"
    };
  }
  if (asksPrice(text)) {
    return { state: next, hangup: false, answered: true, say: priceSay(next) };
  }
  if (asksMenu(text)) {
    return { state: next, hangup: false, answered: true, say: menuSay(next) };
  }
  return null;
}

function menuSay(next) {
  const hidden = new Set((next.unavailable || []).map(item => fold(item)));
  const names = MENU_PIZZAS.filter(name => !hidden.has(fold(name)));
  return `Tenemos ${names.join(", ")}. ¿Cuál?`;
}

function priceSay(next) {
  const prices = next.prices || { mediana: 200, grande: 220, familiar: 250 };
  const money = value => String(Math.round(Number(value) || 0));
  return `Mediana ${money(prices.mediana)}, grande ${money(prices.grande)} y familiar ${money(prices.familiar)}.`;
}

function describePizza(descriptions, name) {
  const wanted = fold(name);
  const found = Object.entries(descriptions || {}).find(([key]) => {
    const have = fold(key);
    return have === wanted || have.includes(wanted) || wanted.includes(have);
  });
  return found ? String(found[1] || "").replace(/\s+/g, " ").trim() : "";
}

export function mentionedSize(utterance) {
  const text = fold(utterance);
  return SIZES.find(size => text.includes(size)) || "";
}

function soundsLikeBoneless(text) {
  if (/boneless|bonles|boneles|bodwe|baule|baul|bound/.test(text)) {
    return true;
  }
  if (/\b(pizza|pieza)\s+de\s+(doble|bajo|borde|baul\w*)\b/.test(text)) {
    return true;
  }
  const compact = text.trim();
  if (/^(de\s*)?volver$/.test(compact) && !/\b(pedido|dinero|queja)\b/.test(compact)) {
    return true;
  }
  return /^(bajo|baul|baules|borde|doble)$/.test(compact);
}

export function inventedHeard(value) {
  const text = fold(value).replace(/[¡!¿?.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return true;
  }
  return /^(provechito|provecho|buen provecho)$/.test(text) || isVocabularyEcho(value);
}

export function correctHeard(utterance) {
  const rewritten = String(utterance || "")
    .replace(/[¡!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[¿]?\s*noins\s*[?]?\s*$/i, "Luis")
    .replace(/\biztacalco\s+federal\b/gi, "ISSSTE Federal")
    .replace(/\biztacalco\b/gi, "ISSSTE")
    .replace(/([¿]?\s*)qu[eé]\s+beneficios?\s+tiene[n]?/gi, "$1Qué precio tienen")
    .replace(/\bbeneficios\b/gi, "precios")
    .replace(/\bbeneficio\b/gi, "precio")
    .replace(/^[¿]?\s*necesitamos?[.!?]*\s*$/i, "Mexicana");
  const text = fold(rewritten);
  if (!soundsLikeBoneless(text) || /boneless/.test(text)) {
    return rewritten;
  }
  const replaced = rewritten.replace(/\b((?:pizza|pieza)\s+de\s+)\S+/i, "$1boneless");
  if (replaced !== rewritten) {
    return replaced;
  }
  if (text.split(" ").filter(Boolean).length <= 2) {
    return "boneless";
  }
  return rewritten;
}

export function matchPizza(utterance) {
  const text = fold(utterance);
  if (/hawai|saway|awaina|awaiana/.test(text)) {
    return "Hawaina";
  }
  if (soundsLikeBoneless(text)) {
    return "Lucco Boneless";
  }
  if (/^necesitamos?$/.test(text.replace(/[^a-z\s]/g, "").trim())) {
    return "Mexicana";
  }
  if (/\bdeluxe\b|\bde luz\b|\bluz\b/.test(text)) {
    return "Deluxe";
  }
  if (/tejicana|mejicana/.test(text)) {
    return "Mexicana";
  }
  const named = MENU_PIZZAS.find(name => fold(name) !== "peperoni" && text.includes(fold(name)));
  if (named) {
    return named;
  }
  if (/peperoni|pepperoni/.test(text) && !/\b(extra|con|agrega|agregale|ponle)\b/.test(text)) {
    return "Peperoni";
  }
  return "";
}

function heardSize(utterance) {
  const text = fold(utterance);
  if (/famil/.test(text)) {
    return "familiar";
  }
  return mentionedSize(utterance);
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = i;
    for (let j = 1; j <= right.length; j += 1) {
      const next = left[i - 1] === right[j - 1]
        ? row[j - 1]
        : Math.min(row[j - 1], row[j], previous) + 1;
      row[j - 1] = previous;
      previous = next;
    }
    row[right.length] = previous;
  }
  return row[right.length];
}

function phoneticKey(value) {
  const text = fold(value)
    .replace(/[^a-z\s]/g, "")
    .replace(/qu/g, "k")
    .replace(/ll/g, "y")
    .replace(/ce/g, "se")
    .replace(/ci/g, "si")
    .replace(/ge/g, "je")
    .replace(/gi/g, "ji")
    .replace(/v/g, "b")
    .replace(/z/g, "s")
    .replace(/x/g, "j")
    .replace(/h/g, "")
    .replace(/c/g, "k")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, "");
  return text;
}

export function closestChoice(utterance, choices) {
  const raw = fold(utterance).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = raw.split(" ").filter(token => token.length >= 4);
  const pieces = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    pieces.push(tokens[index] + tokens[index + 1]);
  }
  if (!pieces.length && raw.replace(/\s+/g, "").length >= 4) {
    pieces.push(raw.replace(/\s+/g, ""));
  }
  let best = null;
  let second = Infinity;
  for (const choice of choices) {
    const keys = (choice.keys || [choice.value]).map(phoneticKey).filter(key => key.length >= 3);
    let distance = Infinity;
    for (const key of keys) {
      for (const piece of pieces) {
        const heard = phoneticKey(piece);
        if (heard.length < 3) {
          continue;
        }
        distance = Math.min(distance, editDistance(heard, key));
      }
    }
    if (!Number.isFinite(distance)) {
      continue;
    }
    if (!best || distance < best.distance) {
      second = best ? best.distance : Infinity;
      best = { ...choice, distance };
    } else if (distance < second) {
      second = distance;
    }
  }
  if (!best || best.distance > 1 || second === best.distance) {
    return null;
  }
  return best;
}

function pizzaChoices(next) {
  const hidden = new Set((next.unavailable || []).map(item => fold(item)));
  return MENU_PIZZAS.filter(name => !hidden.has(fold(name))).map(name => ({
    slot: "pizza",
    value: name,
    phrase: `la pizza ${spokenPizza(name)}`,
    keys: fold(name).includes("boneless")
      ? ["boneless"]
      : [name, spokenPizza(name)]
  }));
}

function sizeChoices() {
  return ["mediana", "grande", "familiar"].map(size => ({
    slot: "size",
    value: size,
    phrase: size,
    keys: [size]
  }));
}

function sauceChoices() {
  return [
    { slot: "sauce", value: "bbq", phrase: "la salsa barbiquiú", keys: ["barbiquiu", "barbacoa", "barbecue"] },
    { slot: "sauce", value: "buffalo", phrase: "la salsa búfalo", keys: ["bufalo", "buffalo"] }
  ];
}

function drinkChoices(drink = {}) {
  const kind = drink.kind || "";
  if (kind === "regular" || kind === "Light" || kind === "fresa") {
    return [
      { slot: "drink", value: "600", phrase: "600 mililitros", drink: { kind, volume: "600" }, keys: ["seiscientos", "seiscientas"] },
      { slot: "drink", value: "2 litros", phrase: "2 litros", drink: { kind, volume: "2 litros" }, keys: ["doslitros", "litros"] }
    ];
  }
  if (kind === "coca") {
    return [
      { slot: "drink", value: "regular", phrase: "Coca-Cola regular", drink: { kind: "regular" }, keys: ["regular"] },
      { slot: "drink", value: "Light", phrase: "Coca-Cola Light", drink: { kind: "Light" }, keys: ["light", "ligera", "lite"] }
    ];
  }
  return [
    { slot: "drink", value: "coca", phrase: "una Coca-Cola", drink: { kind: "coca" }, keys: ["cocacola", "coca"] },
    { slot: "drink", value: "fresa", phrase: "el refresco de fresa", drink: { kind: "fresa" }, keys: ["fresa"] }
  ];
}

function fulfillmentChoices() {
  return [
    { slot: "fulfillment", value: "delivery", phrase: "domicilio", keys: ["domicilio", "adomicilio"] },
    { slot: "fulfillment", value: "pickup", phrase: "para recoger", keys: ["recoger", "llevar"] }
  ];
}

function confirmGuess(next, choice) {
  next.guess = {
    slot: choice.slot,
    value: choice.value,
    extra: choice.extra || "",
    drink: choice.drink || null
  };
  const say = choice.ask || `¿Acaso se refiere a ${choice.phrase}?`;
  next.lastAsk = say;
  next.sameCount = 0;
  next.lastSay = say;
  return { state: next, hangup: false, answered: true, say };
}

function offerGuess(next, utterance, choices, fallback) {
  if (looksLikeQuestion(utterance) || notAPlace(fold(utterance))) {
    return sameQuestion(next, fallback);
  }
  const choice = closestChoice(utterance, choices);
  if (!choice) {
    return sameQuestion(next, fallback);
  }
  return confirmGuess(next, choice);
}

function colonyFallback(next, utterance, fallback) {
  if (!looksLikeQuestion(utterance)) {
    const suggested = suggestColony(utterance, next.postalCode);
    if (suggested) {
      return confirmGuess(next, {
        slot: "colony",
        value: suggested.colony,
        extra: suggested.postalCode,
        phrase: `la colonia ${suggested.colony}`
      });
    }
  }
  return sameQuestion(next, fallback);
}

function postalAsk(code) {
  return {
    slot: "postal",
    value: code,
    ask: `¿Acaso se refiere al código ${speakPostal(code)}?`
  };
}

function applyGuess(next) {
  const guess = next.guess || {};
  if (guess.slot === "pizza") {
    next.product = guess.value;
  } else if (guess.slot === "size") {
    next.size = guess.value;
  } else if (guess.slot === "sauce") {
    next.sauce = guess.value;
  } else if (guess.slot === "fulfillment") {
    next.fulfillment = guess.value;
  } else if (guess.slot === "colony") {
    next.colony = guess.value;
    if (!next.postalCode && guess.extra) {
      next.postalCode = guess.extra;
    }
  } else if (guess.slot === "postal") {
    next.postalCode = guess.value;
  } else if (guess.slot === "drink" && guess.drink) {
    next.drink = { ...(next.drink || {}), ...guess.drink };
    next.offeredMore = true;
  }
  next.guess = null;
}

function afterGuess(next) {
  const slot = missingSlot(next);
  if (slot) {
    return { state: next, hangup: false, say: slot };
  }
  if (next.fulfillment === "pickup") {
    const confirmation = buildConfirmation({
      customerName: next.name,
      orderType: "pickup",
      paymentMethod: "efectivo",
      items: [{ name: next.product, size: next.size, quantity: 1 }]
    });
    return { state: next, hangup: false, say: confirmation.spoken };
  }
  return { state: next, hangup: false, say: "¿Tiene alguna duda o desea agregar algo más?" };
}

export function speakPostal(code) {
  const digits = String(code || "").replace(/\D/g, "");
  if (!/^\d{5}$/.test(digits)) {
    return String(code || "");
  }
  const ones = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
  const tens = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const under100 = value => {
    if (value < 20) {
      return ones[value];
    }
    const ten = Math.floor(value / 10);
    const one = value % 10;
    if (!one) {
      return tens[ten];
    }
    if (ten === 2) {
      return ["", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"][one];
    }
    return `${tens[ten]} y ${ones[one]}`;
  };
  const head = under100(Number(digits.slice(0, 2)));
  const mid = Number(digits[2]);
  const tail = Number(digits.slice(3));
  if (mid === 0) {
    return `${head} cero ${tail === 0 ? "cero" : under100(tail)}`;
  }
  const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  const rest = tail === 0 ? hundreds[mid] : `${hundreds[mid]} ${under100(tail)}`;
  return `${head} ${rest}`.replace(/\s+/g, " ").trim();
}

export function heardFulfillment(utterance) {
  const text = fold(utterance).replace(/['’]/g, "");
  if (/\b(recoger|para llevar|pa llevar|pallevar)\b/.test(text) || /pallevar|pa llevar/.test(text)) {
    return "pickup";
  }
  if (/domicil|adomi|\bjale\b/.test(text) || /\b(me lo manda|mandamelo)\b/.test(text)) {
    return "delivery";
  }
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.length < 6) {
    return "";
  }
  const nearDelivery = ["domicilio", "adomicilio"].some(target => editDistance(compact, target) <= 5);
  return nearDelivery ? "delivery" : "";
}

export function looksLikeQuestion(value) {
  const raw = String(value || "");
  const text = fold(raw).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /^(hola|alo|bueno|ok|okay|si|no|gracias|nop)$/.test(text)) {
    return false;
  }
  return /[?¿]/.test(raw) || /\b(que|cual|cuales|cuanto|cuando|donde|como|precio|horario|tienen|promocion|ingrediente|aceptan|tarjeta|factura|recomiend|chilo|chila|rico|rica)\b/.test(text);
}

export function isAnsweredQuestion(say) {
  const text = String(say || "");
  return /^(Mediana |La pizza |No tengo anotados|Tenemos |Hay más de una|No te preocupes|No manejamos|Las promociones|La promoción|Anoté|Sus pizzas|Todavía|Su orden)/.test(text)
    || /\btrae\b/i.test(text);
}

function sameQuestion(next, say) {
  if (next.lastAsk === say) {
    next.sameCount = (next.sameCount || 0) + 1;
    const again = `Disculpe, no le oí bien. ${say}`;
    next.lastSay = again;
    return { state: next, hangup: false, say: again };
  }
  next.lastAsk = say;
  next.sameCount = 0;
  next.lastSay = say;
  return { state: next, hangup: false, say };
}

function missingSlot(next) {
  if (!next.name) {
    return "¿Cuál es su nombre?";
  }
  if (!next.product) {
    return "¿Qué desea ordenar?";
  }
  if (!next.size) {
    const extra = (next.extras || []).length ? ` con extra de ${next.extras.join(" y ")}` : "";
    return `${next.product}${extra}, ¿mediana, grande o familiar?`;
  }
  if (fold(next.product).includes("boneless") && !next.sauce) {
    return "La pizza boneless, ¿salsa barbiquiú o búfalo?";
  }
  if (!next.offeredMore && !next.drink?.volume) {
    return "¿Desea agregar algo más? ¿Alguna bebida?";
  }
  const drink = next.drink || {};
  if ((drink.kind === "coca" || drink.kind === "regular" || drink.kind === "Light" || drink.kind === "fresa") && !drink.volume) {
    if (drink.kind === "fresa") {
      return "Refresco de fresa, ¿600 mililitros o 2 litros?";
    }
    const kind = drink.kind === "coca" ? "" : ` ${drink.kind}`;
    return `Coca-Cola${kind}, ¿600 mililitros o 2 litros?`;
  }
  if (!next.fulfillment) {
    return "¿A domicilio o para recoger?";
  }
  if (next.fulfillment === "pickup") {
    return "";
  }
  if (!next.postalCode) {
    return "¿Cuál es el código postal?";
  }
  if (!next.colony) {
    return `Muy bien ${next.name}, ¿y la colonia cuál es?`;
  }
  if (!next.street || !next.house) {
    return "¿Cuál es la calle y el número?";
  }
  if (!next.closingAsked) {
    return "¿Tiene alguna duda o desea agregar algo más?";
  }
  return "";
}

function orderReady(next) {
  if (!next.name || !next.product || !next.size) {
    return false;
  }
  if (fold(next.product).includes("boneless") && !next.sauce) {
    return false;
  }
  const drink = next.drink || {};
  if (drink.kind && !drink.volume) {
    return false;
  }
  if (next.fulfillment === "pickup") {
    return true;
  }
  return next.fulfillment === "delivery"
    && /^\d{5}$/.test(String(next.postalCode || ""))
    && Boolean(next.colony && next.street && next.house);
}

export function emptyFacts() {
  return { name: "", size: "", product: "", street: "", colony: "" };
}

export function lockFacts(facts, utterance) {
  const next = { ...facts };
  const text = fold(utterance);
  const named = text.match(/\b(?:me llamo|mi nombre es|soy)\s+([a-z]+(?:\s+[a-z]+){0,3})/);
  if (named) {
    next.name = titleName(named[1]);
  } else if (!next.name) {
    const bare = text.trim().match(/^([a-z]{3,}(?:\s+[a-z]{3,}){0,2})$/);
    const blocked = /\b(pizza|mediana|grande|familiar|domicilio|recoger|gracias|colonia|calle)\b/;
    if (bare && !blocked.test(text) && !mentionedSize(utterance) && !matchPizza(utterance)) {
      next.name = titleName(bare[1]);
    }
  }
  const size = mentionedSize(utterance);
  if (size) {
    next.size = size;
  }
  const pizza = matchPizza(utterance);
  if (pizza) {
    next.product = pizza;
  }
  const street = String(utterance || "").match(/((?:l[aá]zaro c[aá]rdenas|zaragoza|veracruz|morelos)[^,.]*)/i);
  if (street) {
    next.street = street[1].trim();
  }
  const colony = String(utterance || "").match(/\b(issste federal|cuauht[eé]moc|modelo|5 de mayo)\b/i);
  if (colony) {
    next.colony = colony[1];
  }
  return next;
}

export function factsInstructions(facts) {
  const lines = [];
  if (facts.name) {
    lines.push(`Nombre exacto: ${facts.name}. Repítelo igual. No propongas otro.`);
  }
  if (facts.product) {
    lines.push(`Pizza ya dicha: ${facts.product}. No ofrezcas otra ni una que no esté en el menú.`);
  }
  if (facts.size) {
    lines.push(`Tamaño ya dicho: ${facts.size}. No lo vuelvas a preguntar.`);
  }
  if (facts.street) {
    lines.push(`Calle exacta: ${facts.street}. No la cambies por otra calle.`);
  }
  if (facts.colony) {
    lines.push(`Colonia exacta: ${facts.colony}. No preguntes el código de otra colonia.`);
  }
  if (!lines.length) {
    return "DATOS FIJOS: todavía ninguno. Si no oíste un dato, pregunta de nuevo sin inventar otro.";
  }
  return `DATOS FIJOS DE ESTA LLAMADA:\n${lines.join("\n")}`;
}

export function nextReply(state, utterance) {
  const text = fold(utterance);
  const next = { ...state };
  const nameFix = correctName(state.name, utterance);
  if (nameFix.name !== state.name) {
    next.name = nameFix.name;
    next.needsLastName = true;
  }
  const size = mentionedSize(utterance);
  if (size) {
    next.size = size;
  }
  const quantity = mentionedQuantity(utterance);
  if (quantity) {
    next.quantity = quantity;
  }
  const pizza = matchPizza(utterance);
  if (pizza) {
    next.product = pizza;
  }
  const topping = mushroomIntent(utterance);
  if (topping === "remove") {
    const found = matchIngredients(utterance).filter(name => !fold(next.product || "").includes(name));
    next.extras = (next.extras || []).filter(name => !found.includes(name));
    if (found.includes("champinones") || topping === "remove") {
      next.extra = "";
      next.extras = (next.extras || []).filter(name => name !== "champinones" && !found.includes(name));
    }
    const priced = priceLine({
      size: next.size || "mediana",
      extras: next.extras,
      quantity: next.quantity || 1
    });
    return {
      state: next,
      hangup: false,
      say: `Sin champiñones queda en ${priced.subtotal}.`
    };
  }
  if (topping === "unclear") {
    return {
      state: next,
      hangup: false,
      say: "¿Agrego los champiñones o se los quito?"
    };
  }
  if (topping === "add" || matchIngredients(utterance).length) {
    const found = matchIngredients(utterance).filter(name => !fold(next.product || "").includes(name));
    const names = found.length ? found : ["champinones"];
    const sized = next.size || "mediana";
    next.extras = [...new Set([...(next.extras || []), ...names])];
    if (next.extras.includes("champinones")) {
      next.extra = "champinones";
    }
    next.product = next.product || "Peperoni";
    next.size = sized;
    const priced = priceLine({
      size: sized,
      extras: next.extras,
      quantity: next.quantity || 1
    });
    return {
      state: next,
      hangup: false,
      say: `Muy bien, con ${next.extras.join(" y ")} subiría de ${priced.base} a ${priced.subtotal}, ¿de acuerdo?`
    };
  }
  if (pizza) {
    next.product = pizza;
  }
  if (/\bdomicilio\b/.test(text)) {
    next.fulfillment = "delivery";
  }
  if (/\brecoger\b/.test(text)) {
    next.fulfillment = "pickup";
  }
  if (/\b(calle|colonia|codigo)\b/.test(text)) {
    next.addressGiven = true;
  }

  if (/\b(repet|resumen)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      say: `Su pedido es ${next.product || "el que ya anoté"}, ${next.size || "sin tamaño"}, a nombre de ${next.name}.`
    };
  }

  if (/\b(es todo|seria todo|muchas gracias|eso es todo)\b/.test(text) && next.product && next.size) {
    const orderType = next.fulfillment === "pickup" ? "pickup" : "delivery";
    const confirmation = buildConfirmation({
      customerName: next.name || "cliente",
      orderType,
      address: next.address || "Veracruz 56, 5 de Mayo",
      postalCode: next.postalCode || "83010",
      paymentMethod: paymentForOrder(orderType, next.payment),
      items: [{
        name: next.product,
        size: next.size,
        extras: next.extras || (next.extra ? [next.extra] : []),
        quantity: next.quantity || 1
      }]
    });
    return {
      state: next,
      hangup: false,
      say: confirmation.ok ? confirmation.spoken : "Su pedido ha quedado confirmado."
    };
  }

  if (nameFix.needsLastName) {
    return {
      state: next,
      hangup: false,
      say: `¿Su apellido? Sigo con ${next.product || "su pedido"}.`
    };
  }

  if (/\b(sabor|sabores|menu)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      say: `Tenemos ${MENU_PIZZAS.join(", ")}. ¿Cuál?`
    };
  }

  const drink = drinkQuestion(utterance, state.drink);
  if (drink) {
    next.drink = drink.drink;
    return { state: next, hangup: false, say: drink.say };
  }

  if (/\b(como va|estatus|mi pedido)\b/.test(text) && !next.product) {
    return {
      state: next,
      hangup: false,
      say: "Reviso el pedido de este teléfono."
    };
  }

  if (!next.product) {
    const named = nameFix.name && nameFix.name !== state.name;
    return {
      state: next,
      hangup: false,
      say: named
        ? "¿Pepperoni, hawaiana o mexicana?"
        : "Disculpa, no entendí. ¿Puedes repetir?"
    };
  }

  if (next.product && !next.size) {
    return {
      state: next,
      hangup: false,
      say: `${next.product}, ¿mediana, grande o familiar?`
    };
  }

  if (next.product && next.size && !next.fulfillment) {
    return {
      state: next,
      hangup: false,
      say: "¿Domicilio o recoger?"
    };
  }

  if (next.fulfillment === "delivery" && !next.addressGiven && state.savedAddress && !state.offeredSaved) {
    next.offeredSaved = true;
    return {
      state: next,
      hangup: false,
      say: `¿La enviamos a ${state.savedAddress}?`
    };
  }

  return {
    state: next,
    hangup: false,
    say: `Sigo con ${next.name}: ${next.product || "pedido"} ${next.size || ""}.`.trim()
  };
}

export function orderedTurn(state, utterance) {
  if (isVocabularyEcho(utterance) || strayEcho(utterance, state)) {
    return {
      state,
      hangup: false,
      say: "Disculpe, no le oí bien. ¿Me lo repite?"
    };
  }
  const next = {
    name: "",
    product: "",
    size: "",
    fulfillment: "",
    postalCode: "",
    colony: "",
    street: "",
    offeredMore: false,
    unavailable: [],
    ...state
  };
  const text = fold(utterance).replace(/[.,!?¿¡]/g, " ").replace(/\bno la pizza\b/g, "una pizza").replace(/\s+/g, " ").trim();
  if (/\bcancel/.test(text) || next.cancelAsked) {
    const onlyDrink = /\b(bebida|soda|coca|refresco)\b/.test(text) || (next.cancelAsked && /\b(solo|nomas|nada mas)\b/.test(text));
    const whole = /\b(todo|pedido|orden)\b/.test(text);
    if (whole && !onlyDrink) {
      return {
        state: next,
        hangup: false,
        cancel: true,
        say: "De acuerdo, su pedido quedó cancelado. Que tenga un buen día y gracias por llamar a Pizzería Hermosillo. Hasta pronto."
      };
    }
    if (onlyDrink || (next.cancelAsked && /\b(solo|nomas|nada mas|eso)\b/.test(text))) {
      next.drink = {};
      next.drinkOffered = true;
      next.cancelAsked = false;
      next.closingAsked = false;
      return { state: next, hangup: false, say: "Listo, quité la bebida. Seguimos con las pizzas." };
    }
    if (/\bcancel/.test(text)) {
      next.cancelAsked = true;
      return { state: next, hangup: false, say: "¿Desea cancelar todo el pedido o solo la bebida?" };
    }
    next.cancelAsked = false;
  }
  if (next.guess?.slot) {
    const yes = /^(si|sip|simon|claro|correcto|exacto|esa|ese|eso|asi es|aja|ok|okay)$/.test(text);
    const no = /^(no|nop|nel|negativo)$/.test(text);
    if (yes) {
      applyGuess(next);
      return afterGuess(next);
    }
    if (no) {
      next.guess = null;
      return sameQuestion(next, missingSlot(next) || "¿Me lo repite?");
    }
    next.guess = null;
  }
  if (/\b(agregar|otra pizza|pedido anterior)\b/.test(text) && !asksPromotions(text) && !asksIngredients(text) && !asksOwnPizzas(text)) {
    next.adding = true;
    return { state: next, hangup: false, say: "¿Qué pizza desea agregar? Las que ya tenía se quedan." };
  }
  const info = infoReply(next, utterance, text);
  if (info) {
    const slot = missingSlot(info.state || next);
    if (slot && info.say && !info.say.includes(slot)) {
      info.say = `${String(info.say).replace(/\.+$/, ".")} ${slot}`;
    }
    return info;
  }
  if (!next.name) {
    if (asksMenu(text)) {
      return { state: next, hangup: false, answered: true, say: menuSay(next) };
    }
    if (asksPrice(text)) {
      return { state: next, hangup: false, answered: true, say: priceSay(next) };
    }
    if (asksIngredients(text)) {
      return { state: next, hangup: false, answered: true, say: "¿De cuál pizza quiere saber los ingredientes?" };
    }
    const earlyPlace = heardFulfillment(utterance);
    if (earlyPlace) {
      next.fulfillment = earlyPlace;
    }
    const bare = text.trim().match(/^(?:me llamo |soy )?([a-z]{3,}(?:\s+[a-z]{3,}){0,2})$/);
    const blockedName = /^(claro|bueno|bien|gracias|si|esta|promocion|devolver|quiero|hola)\b/;
    if (bare && !blockedName.test(bare[1]) && !looksLikeQuestion(utterance) && !earlyPlace && !matchPizza(utterance) && !mentionedSize(utterance)) {
      next.name = titleName(bare[1]);
      return { state: next, hangup: false, say: "¿Qué desea ordenar?" };
    }
    return { state: next, hangup: false, say: "¿Cuál es su nombre?" };
  }
  const pizza = matchPizza(text);
  const size = heardSize(text);
  if (pizza && next.product && pizza !== next.product && next.size) {
    next.items = [...(next.items || []), {
      product: next.product,
      size: next.size,
      sauce: next.sauce || "",
      extras: next.extras || []
    }];
    next.size = "";
    next.sauce = "";
    next.extras = [];
  }
  if (pizza) {
    if ((next.unavailable || []).some(item => fold(item) === fold(pizza))) {
      return { state: next, hangup: false, say: `La pizza ${pizza} no está disponible. ¿Qué otra desea?` };
    }
    next.product = pizza;
  }
  const foundExtras = matchIngredients(String(utterance || "").replace(/peperoni/gi, "pepperoni"));
  if (foundExtras.length) {
    const folded = foundExtras.map(name => fold(name).replace(/pepperoni/g, "peperoni"));
    const unique = foundExtras.filter((name, index) => folded.indexOf(folded[index]) === index);
    const removing = /\b(sin|quita|quitale|no quiero)\b/.test(text) && !/\b(extra|ponle|agrega|agregale)\b/.test(text);
    if (removing) {
      next.without = [...new Set([...(next.without || []), ...unique])];
      next.extras = (next.extras || []).filter(name => !unique.includes(name));
    } else {
      next.extras = [...new Set([...(next.extras || []), ...unique])];
    }
  }
  if (size) {
    next.size = size;
  }
  if (heardSauce(text) && fold(next.product).includes("boneless")) {
    next.sauce = heardSauce(text);
  }
  const namedNow = listedPizzas(utterance);
  const pair = pairRequest(text);
  if (pair) {
    next.pairNeed = 2;
    next.pairSize = pair;
    next.size = pair;
  }
  if (namedNow.length >= 2 && (pair || next.pairNeed === 2) && (next.items || []).length < 2) {
    const chosen = next.pairSize || pair || "grande";
    const sauce = heardSauce(text);
    next.pairNeed = 2;
    next.pairSize = chosen;
    next.size = chosen;
    if (fold(namedNow[0]).includes("boneless") && !sauce) {
      next.items = [];
      next.pendingSecond = namedNow[1];
      next.product = namedNow[0];
      next.sauce = "";
      next.extras = [];
    } else {
      next.items = [{
        product: namedNow[0],
        size: chosen,
        sauce: fold(namedNow[0]).includes("boneless") ? sauce : "",
        extras: []
      }];
      next.product = namedNow[1];
      next.pendingSecond = "";
      next.sauce = fold(namedNow[1]).includes("boneless") ? sauce : "";
      next.extras = [];
    }
  }
  if (asksIngredients(text)) {
    if (!next.product) {
      return { state: next, hangup: false, say: "¿De cuál pizza quiere saber los ingredientes?" };
    }
    const description = describePizza(next.descriptions, next.product);
    return {
      state: next,
      hangup: false,
      say: description
        ? `La pizza ${next.product} trae ${description}.`
        : `No tengo anotados los ingredientes de la pizza ${next.product}.`
    };
  }
  if (asksPrice(text)) {
    return { state: next, hangup: false, say: priceSay(next) };
  }
  const fulfillment = heardFulfillment(text);
  if (fulfillment) {
    next.fulfillment = fulfillment;
  }
  if (!next.product) {
    if (next.pairNeed === 2 && (next.items || []).length < 2) {
      const which = (next.items || []).length ? "segunda" : "primera";
      const price = (next.pairSize || "grande") === "familiar" ? 450 : 400;
      const intro = (next.items || []).length
        ? ""
        : `La promoción es de dos pizzas ${sizeWord(next.pairSize, true)} por ${price}. `;
      const flavorAsk = `${intro}¿De qué sabor quiere la ${which}?`;
      if (pair || /\bpromocion\b/.test(text)) {
        next.lastAsk = flavorAsk;
        next.sameCount = 0;
        next.lastSay = flavorAsk;
        return { state: next, hangup: false, answered: true, say: flavorAsk };
      }
      return { ...sameQuestion(next, flavorAsk), answered: true };
    }
    if (asksMenu(text)) {
      return { state: next, hangup: false, say: menuSay(next) };
    }
    if (/\bpizza\b/.test(text) && /\bredonda\b/.test(text)) {
      return sameQuestion(next, "Tenemos mexicana, peperoni y deluxe. ¿Cuál desea?");
    }
    const guessedPizza = !looksLikeQuestion(utterance) ? closestChoice(utterance, pizzaChoices(next)) : null;
    if (guessedPizza) {
      return confirmGuess(next, guessedPizza);
    }
    if (/\bpizza\b/.test(text)) {
      return sameQuestion(next, "No manejamos esa. Tenemos mexicana, peperoni y deluxe. ¿Cuál desea?");
    }
    return sameQuestion(next, "¿Qué desea ordenar?");
  }
  const extraLabel = (next.extras || []).length ? ` con extra de ${(next.extras || []).join(" y ")}` : "";
  if (!next.size) {
    return offerGuess(next, utterance, sizeChoices(), `${next.product}${extraLabel}, ¿mediana, grande o familiar?`);
  }
  if (fold(next.product).includes("boneless") && !next.sauce) {
    return offerGuess(next, utterance, sauceChoices(), "La pizza boneless, ¿salsa barbiquiú o búfalo?");
  }
  if (next.pendingSecond && next.product && (!fold(next.product).includes("boneless") || next.sauce)) {
    next.items = [...(next.items || []), {
      product: next.product,
      size: next.pairSize || next.size,
      sauce: next.sauce || "",
      extras: next.extras || []
    }];
    next.product = next.pendingSecond;
    next.pendingSecond = "";
    next.sauce = fold(next.product).includes("boneless") ? next.sauce : "";
    next.extras = [];
    next.size = next.pairSize || next.size;
  }
  if (next.pairNeed === 2 && next.product && (next.items || []).length < 1 && !next.pendingSecond) {
    const saved = spokenPizza(next.product);
    next.items = [{
      product: next.product,
      size: next.pairSize || next.size,
      sauce: next.sauce || "",
      extras: next.extras || []
    }];
    next.product = "";
    next.sauce = "";
    next.extras = [];
    next.size = next.pairSize || next.size;
    return {
      state: next,
      hangup: false,
      say: `Anoté una ${next.pairSize || next.size} de ${saved}. ¿De qué sabor quiere la segunda?`
    };
  }
  if (!next.offeredMore && !/\bno\b/.test(text) && !/\b(coca|soda|fresa)\b/.test(text)) {
    if (looksLikeQuestion(utterance)) {
      return { state: next, hangup: false, say: "¿Desea agregar algo más? ¿Alguna bebida?" };
    }
    next.offeredMore = true;
    return { state: next, hangup: false, say: "¿Desea agregar algo más? ¿Alguna bebida?" };
  }
  next.offeredMore = true;
  if (!fulfillment) {
    const drink = drinkQuestion(utterance, next.drink || {});
    if (drink?.say) {
      next.drink = drink.drink;
      return offerGuess(next, utterance, drinkChoices(drink.drink), drink.say);
    }
    if (drink?.drink) {
      next.drink = drink.drink;
    }
  }
  if (!next.fulfillment) {
    return offerGuess(next, utterance, fulfillmentChoices(), "¿A domicilio o para recoger?");
  }
  if (next.fulfillment === "pickup") {
    const confirmation = buildConfirmation({
      customerName: next.name,
      orderType: "pickup",
      paymentMethod: "efectivo",
      items: [{ name: next.product, size: next.size, quantity: 1 }]
    });
    return { state: next, hangup: false, say: confirmation.spoken };
  }
  const postal = acceptedPostal(utterance);
  const doesNotKnowPostal = /\bno (me lo |me |lo )?(se|acuerdo|recuerdo)\b/.test(text)
    || /\bno (tengo|manejo)\b/.test(text)
    || /^no$/.test(text);
  const triedPostal = /\d{4,5}/.test(text) || /\b(ochenta|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil)\b/.test(text);
  let learnedPostal = false;
  if (!next.postalCode) {
    if (/^\d{5}$/.test(postal)) {
      next.postalCode = postal;
    } else {
      const found = postalFromColony(utterance);
      if (found.exact && found.postalCode) {
        next.postalCode = found.postalCode;
        next.colony = found.colony;
        learnedPostal = true;
      } else if (found.postalCode && found.colony) {
        return confirmGuess(next, {
          slot: "colony",
          value: found.colony,
          extra: found.postalCode,
          phrase: `la colonia ${found.colony}`
        });
      } else if (found.options.length) {
        next.postalFromColony = true;
        const choices = found.options.slice(0, 3)
          .map(item => `${item.colony}, código ${speakPostal(item.postalCode)}`)
          .join(", o ");
        return { state: next, hangup: false, say: `Hay más de una. ¿Es ${choices}?` };
      } else if (doesNotKnowPostal && !next.postalFromColony) {
        next.postalFromColony = true;
        return { state: next, hangup: false, say: "No te preocupes, dime qué colonia es" };
      } else if (!doesNotKnowPostal && !looksLikeQuestion(utterance)) {
        const nearCode = suggestPostal(utterance);
        if (nearCode) {
          return confirmGuess(next, postalAsk(nearCode));
        }
        const nearColony = suggestColony(utterance, "");
        if (nearColony) {
          return confirmGuess(next, {
            slot: "colony",
            value: nearColony.colony,
            extra: nearColony.postalCode,
            phrase: `la colonia ${nearColony.colony}`
          });
        }
      }
      if (!next.postalCode) {
        if (next.postalFromColony) {
          return colonyFallback(next, utterance, "No encontré esa colonia en Hermosillo. ¿Me dice otra vez la colonia?");
        }
        if (triedPostal) {
          return sameQuestion(next, "No encontré ese código en Hermosillo. ¿Me lo repite?");
        }
        return sameQuestion(next, "¿Cuál es el código postal?");
      }
    }
  }
  const postalSpeech = /\b(ochenta|cero|diez|ciento|veinte|treinta)\b/.test(text) || Boolean(parseSpokenPostalCode(utterance));
  if (!next.colony) {
    if (text.length > 2 && !/^\d+$/.test(text) && !postalSpeech && !notAPlace(text)) {
      const found = postalFromColony(utterance);
      const sameCode = !next.postalCode || !found.postalCode || found.postalCode === next.postalCode;
      const matching = found.options.length
        ? found.options.filter(item => !next.postalCode || item.postalCode === next.postalCode)
        : [];
      if (found.exact && found.postalCode && found.colony && sameCode) {
        next.colony = found.colony;
        if (!next.postalCode) {
          next.postalCode = found.postalCode;
        }
      } else if (found.postalCode && found.colony && sameCode) {
        return confirmGuess(next, {
          slot: "colony",
          value: found.colony,
          extra: found.postalCode,
          phrase: `la colonia ${found.colony}`
        });
      } else if (matching.length === 1) {
        next.colony = matching[0].colony;
        if (!next.postalCode) {
          next.postalCode = matching[0].postalCode;
        }
      } else if (found.options.length && !next.postalCode) {
        const choices = found.options.slice(0, 3)
          .map(item => `${item.colony}, código ${speakPostal(item.postalCode)}`)
          .join(", o ");
        return { state: next, hangup: false, say: `Hay más de una. ¿Es ${choices}?` };
      } else if (found.options.length && next.postalCode) {
        return sameQuestion(next, "Esa colonia no corresponde a ese código. ¿Me dice otra vez la colonia?");
      } else if (found.postalCode && next.postalCode && found.postalCode !== next.postalCode) {
        return sameQuestion(next, "Esa colonia no corresponde a ese código. ¿Me dice otra vez la colonia?");
      } else {
        return colonyFallback(next, utterance, "No encontré esa colonia en Hermosillo. ¿Me dice otra vez la colonia?");
      }
    } else {
      return sameQuestion(next, `Muy bien ${next.name}, ¿y la colonia cuál es?`);
    }
  }
  if (!next.street) {
    const heard = notAPlace(text) ? "" : formatHeardStreet(utterance);
    const house = heard ? streetNumber(utterance) : "";
    if (heard && house) {
      next.house = house;
      next.street = heard.replace(/\s+\d+$/, "").trim();
    } else {
      const known = learnedPostal ? `Colonia ${next.colony}, código ${speakPostal(next.postalCode)}. ` : "";
      return sameQuestion(next, `${known}¿Cuál es la calle y el número?`);
    }
  }
  const orderLine = () => {
    const lines = [...(next.items || [])];
    if (next.product && next.size) {
      lines.push({ product: next.product, size: next.size, sauce: next.sauce || "", extras: next.extras || [] });
    }
    const pizzas = lines.map(item => {
      const topping = (item.extras || []).length ? ` con extra de ${item.extras.join(" y ")}` : "";
      return `una pizza ${item.size} de ${spokenPizza(item.product)}${item.sauce ? ` con ${sauceWord(item.sauce)}` : ""}${topping}`;
    }).join(" y ");
    const drink = next.drink || {};
    if (!drink.volume) {
      return pizzas || "su pedido";
    }
    const volume = drink.volume === "600" ? "600 mililitros" : "2 litros";
    const soda = drink.kind === "fresa"
      ? `un refresco de fresa de ${volume}`
      : `una Coca-Cola ${drink.kind} de ${volume}`;
    return `${pizzas} y ${soda}`;
  };
  const tidyPlace = value => String(value || "")
    .replace(/\./g, " ")
    .replace(/\bcolonia\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  next.street = tidyPlace(next.street);
  next.colony = tidyPlace(next.colony);
  if (!next.drinkOffered && !next.drink?.volume) {
    const drink = drinkQuestion(utterance, next.drink || {});
    if (drink?.say) {
      next.drink = drink.drink;
      next.drinkOffered = true;
      return { state: next, hangup: false, say: drink.say };
    }
    if (drink?.drink) {
      next.drink = drink.drink;
      next.drinkOffered = true;
    } else if (!/\bno\b/.test(text)) {
      next.drinkOffered = true;
      return { state: next, hangup: false, say: "Disculpe, ¿desea agregar alguna bebida o soda?" };
    } else {
      next.drinkOffered = true;
    }
  }
  const end = finishing(text);
  const explicitDone = end === "done" && /\b(es todo|seria todo|nada mas|eso es todo|ya es todo|con eso|muchas gracias|todo)\b/.test(text);
  if (!next.closingAsked && !explicitDone) {
    next.closingAsked = true;
    return {
      state: next,
      hangup: false,
      say: "¿Tiene alguna duda o desea agregar algo más?"
    };
  }
  if (end === "more" || (listedPizzas(utterance).length && end !== "done")) {
    next.closingAsked = false;
    if (listedPizzas(utterance).length) {
      return { state: next, hangup: false, say: `Anoté ${orderLine()}. ¿Desea agregar algo más?` };
    }
    return { state: next, hangup: false, say: "Claro, dígame. ¿Qué desea agregar?" };
  }
  if (end !== "done") {
    next.closingAsked = false;
    return { state: next, hangup: false, say: "Claro, dígame." };
  }
  if (!orderReady(next)) {
    return { state: next, hangup: false, say: missingSlot(next) || "¿Me repite el dato que falta?" };
  }
  next.agreed = true;
  return {
    state: next,
    hangup: false,
    save: true,
    say: `Su orden es ${orderLine()}. Muy bien, tu pedido quedó confirmado. Llegará a tu domicilio en aproximadamente 30 minutos. Muchas gracias por llamar a Pizzería Hermosillo. Que tenga buen día.`
  };
}
