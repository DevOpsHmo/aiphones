import { mushroomIntent, mentionedQuantity } from "./turn-policy.js";
import { buildConfirmation, paymentForOrder, priceLine } from "./confirmation.js";
import { matchIngredients } from "./menu-ingredients.js";
import { formatHeardStreet, parseSpokenPostalCode, postalFromColony, streetNumber } from "./tools.js";

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
  return /\b(que hay|que manejan|que manejas|el menu)\b/.test(text);
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
  return /^(bajo|baul|baules|borde|doble)$/.test(text.trim());
}

export function correctHeard(utterance) {
  const rewritten = String(utterance || "")
    .replace(/([¿]?\s*)qu[eé]\s+beneficios?\s+tiene[n]?/gi, "$1Qué precio tienen")
    .replace(/\bbeneficios\b/gi, "precios")
    .replace(/\bbeneficio\b/gi, "precio");
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
  if (/\bdeluxe\b|\bde luz\b|\bluz\b/.test(text)) {
    return "Deluxe";
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

function sameQuestion(next, say) {
  if (next.lastAsk === say) {
    next.sameCount = (next.sameCount || 0) + 1;
    if (next.sameCount >= 2) {
      return {
        state: next,
        hangup: false,
        transfer: true,
        say: "Disculpe, lo transferiré con un humano."
      };
    }
    const again = `Disculpe, no le oí bien. ${say}`;
    next.lastSay = again;
    return { state: next, hangup: false, say: again };
  }
  next.lastAsk = say;
  next.sameCount = 0;
  next.lastSay = say;
  return { state: next, hangup: false, say };
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
  if (/\b(ya te lo dije|no entiendes|no me escuch|estoy harto|confund|tres veces|cuatro veces|pendeja|pendejo|cabron|mierda|estupida|idiota|por que no puedes)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      transfer: true,
      say: "Disculpe, lo transferiré con un humano."
    };
  }
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
  if (/\b(agregar|otra pizza|pedido anterior)\b/.test(text)) {
    next.adding = true;
    return { state: next, hangup: false, say: "¿Qué pizza desea agregar? Las que ya tenía se quedan." };
  }
  if (!next.name) {
    if (asksMenu(text)) {
      return { state: next, hangup: false, say: menuSay(next) };
    }
    if (asksPrice(text)) {
      return { state: next, hangup: false, say: priceSay(next) };
    }
    if (asksIngredients(text)) {
      return { state: next, hangup: false, say: "¿De cuál pizza quiere saber los ingredientes?" };
    }
    const earlyPlace = heardFulfillment(utterance);
    if (earlyPlace) {
      next.fulfillment = earlyPlace;
    }
    const bare = text.trim().match(/^(?:me llamo |soy )?([a-z]{3,}(?:\s+[a-z]{3,}){0,2})$/);
    if (bare && !earlyPlace && !matchPizza(utterance) && !mentionedSize(utterance)) {
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
    next.extras = [...new Set([...(next.extras || []), ...unique])];
  }
  if (size) {
    next.size = size;
  }
  if (heardSauce(text) && fold(next.product).includes("boneless")) {
    next.sauce = heardSauce(text);
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
    if (asksMenu(text)) {
      return { state: next, hangup: false, say: menuSay(next) };
    }
    if (/\bpizza\b/.test(text)) {
      return sameQuestion(next, "No manejamos esa. Tenemos mexicana, peperoni y deluxe. ¿Cuál desea?");
    }
    return sameQuestion(next, "¿Qué desea ordenar?");
  }
  const extraLabel = (next.extras || []).length ? ` con extra de ${(next.extras || []).join(" y ")}` : "";
  if (!next.size) {
    return sameQuestion(next, `${next.product}${extraLabel}, ¿mediana, grande o familiar?`);
  }
  if (fold(next.product).includes("boneless") && !next.sauce) {
    return sameQuestion(next, "Lucco Boneless, ¿salsa barbiquiú o búfalo?");
  }
  if (!next.offeredMore && !/\bno\b/.test(text) && !/\b(coca|soda|fresa)\b/.test(text)) {
    next.offeredMore = true;
    return { state: next, hangup: false, say: "¿Desea agregar algo más? ¿Alguna bebida?" };
  }
  next.offeredMore = true;
  if (!fulfillment) {
    const drink = drinkQuestion(utterance, next.drink || {});
    if (drink?.say) {
      next.drink = drink.drink;
      return sameQuestion(next, drink.say);
    }
    if (drink?.drink) {
      next.drink = drink.drink;
    }
  }
  if (!next.fulfillment) {
    return sameQuestion(next, "¿A domicilio o para recoger?");
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
  const postal = text.match(/\b(\d{5})\b/)?.[1] || parseSpokenPostalCode(utterance);
  const doesNotKnowPostal = /\bno (me lo |me |lo )?(se|acuerdo|recuerdo)\b/.test(text)
    || /\bno (tengo|manejo)\b/.test(text)
    || /^no$/.test(text);
  let learnedPostal = false;
  if (!next.postalCode) {
    if (/^\d{5}$/.test(postal)) {
      next.postalCode = postal;
    } else {
      const found = postalFromColony(utterance);
      if (found.postalCode) {
        next.postalCode = found.postalCode;
        next.colony = found.colony;
        learnedPostal = true;
      } else if (found.options.length) {
        next.postalFromColony = true;
        const choices = found.options.slice(0, 3)
          .map(item => `${item.colony}, código ${speakPostal(item.postalCode)}`)
          .join(", o ");
        return { state: next, hangup: false, say: `Hay más de una. ¿Es ${choices}?` };
      } else if (doesNotKnowPostal && !next.postalFromColony) {
        next.postalFromColony = true;
        return { state: next, hangup: false, say: "No te preocupes, dime qué colonia es" };
      } else if (next.postalFromColony) {
        return sameQuestion(next, "No encontré esa colonia en Hermosillo. ¿Me dice otra vez la colonia?");
      } else {
        return sameQuestion(next, "¿Cuál es el código postal?");
      }
    }
  }
  const postalSpeech = /\b(ochenta|cero|diez|ciento|veinte|treinta)\b/.test(text) || Boolean(parseSpokenPostalCode(utterance));
  if (!next.colony) {
    if (text.length > 2 && !/^\d+$/.test(text) && !postalSpeech) {
      next.colony = utterance.trim();
    } else {
      return sameQuestion(next, `Muy bien ${next.name}, ¿y la colonia cuál es?`);
    }
  }
  if (!next.street) {
    const heard = formatHeardStreet(utterance);
    if (heard) {
      next.house = streetNumber(utterance);
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
      return `una pizza ${item.size} de ${item.product}${item.sauce ? ` con ${sauceWord(item.sauce)}` : ""}${topping}`;
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
  const done = /\b(no|nada|todo|gracias|ninguna|ninguno|listo|nop)\b/.test(text)
    && !/\b(si|agreg|otra|pizza|bebida|soda|extra|duda|precio|cambia|quiero)\b/.test(text);
  if (!next.closingAsked) {
    next.closingAsked = true;
    return {
      state: next,
      hangup: false,
      say: "¿Tiene alguna duda o desea agregar algo más?"
    };
  }
  if (!done) {
    next.closingAsked = false;
    return { state: next, hangup: false, say: "Claro, dígame." };
  }
  next.agreed = true;
  return {
    state: next,
    hangup: false,
    save: true,
    say: "Muy bien, tu pedido quedó confirmado. Llegará a tu domicilio en aproximadamente 30 minutos. Muchas gracias por llamar a Pizzería Hermosillo. Que tenga buen día."
  };
}
