import { mushroomIntent, mentionedQuantity } from "./turn-policy.js";
import { buildConfirmation, paymentForOrder, priceLine } from "./confirmation.js";
import { matchIngredients } from "./menu-ingredients.js";
import { parseSpokenPostalCode, streetNumber } from "./tools.js";

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

export function drinkQuestion(utterance, drink = {}) {
  const text = fold(utterance);
  const chosen = /\blight\b/.test(text) ? "Light" : /\bregular\b/.test(text) ? "regular" : "";
  const waiting = drink.kind === "coca" || drink.kind === "regular" || drink.kind === "Light";
  const volume = /\b(600|dos litros|2 litros)\b/.test(text);
  if (/\bfresa\b/.test(text) && !volume) {
    return { say: "Refresco de fresa, ¿600 mililitros o 2 litros?", drink: { kind: "fresa" } };
  }
  if (/\b(coca|soda)\b/.test(text) || waiting) {
    const kind = chosen || (drink.kind === "regular" || drink.kind === "Light" ? drink.kind : "");
    if (!kind) {
      return { say: "Coca-Cola, ¿regular o Light?", drink: { kind: "coca" } };
    }
    if (!volume) {
      return { say: `Coca-Cola ${kind}, ¿600 mililitros o 2 litros?`, drink: { kind } };
    }
  }
  return null;
}

export function mentionedSize(utterance) {
  const text = fold(utterance);
  return SIZES.find(size => text.includes(size)) || "";
}

export function matchPizza(utterance) {
  const text = fold(utterance);
  if (/hawai|saway|awaina|awaiana/.test(text)) {
    return "Hawaina";
  }
  if (/boneless|bonles|bodwe|baule|bound/.test(text)) {
    return "Lucco Boneless";
  }
  if (/\bdeluxe\b|\bde luz\b|\bluz\b/.test(text)) {
    return "Deluxe";
  }
  return MENU_PIZZAS.find(name => text.includes(fold(name))) || "";
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

export function heardFulfillment(utterance) {
  const text = fold(utterance);
  if (/\brecoger\b/.test(text)) {
    return "pickup";
  }
  if (/domicil|adomi/.test(text)) {
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
  if (next.lastSay === say) {
    next.sameCount = (next.sameCount || 0) + 1;
  } else {
    next.sameCount = 0;
    next.lastSay = say;
  }
  if (next.sameCount >= 2) {
    return {
      state: next,
      hangup: false,
      transfer: true,
      say: "Disculpe, lo transferiré con un humano."
    };
  }
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
  const text = fold(utterance).replace(/[.,!?¿¡]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(ya te lo dije|no entiendes|no me escuch|estoy harto|confund|tres veces|cuatro veces|pendeja|pendejo|cabron|mierda|estupida|idiota|por que no puedes)\b/.test(text)) {
    return {
      state: next,
      hangup: false,
      transfer: true,
      say: "Disculpe, lo transferiré con un humano."
    };
  }
  if (/\b(agregar|otra pizza|pedido anterior)\b/.test(text)) {
    return { state: next, hangup: false, say: "¿Qué pizza desea agregar? Las que ya tenía se quedan." };
  }
  if (/\bprecio\b/.test(text)) {
    return { state: next, hangup: false, say: "Mediana 200, grande 220 y familiar 250." };
  }
  if (!next.name) {
    const bare = text.trim().match(/^(?:me llamo |soy )?([a-z]{3,}(?:\s+[a-z]{3,}){0,2})$/);
    if (bare && !matchPizza(utterance) && !mentionedSize(utterance)) {
      next.name = titleName(bare[1]);
      return { state: next, hangup: false, say: "¿Qué desea ordenar?" };
    }
    return { state: next, hangup: false, say: "¿Cuál es su nombre?" };
  }
  const pizza = matchPizza(text);
  if (pizza) {
    if ((next.unavailable || []).some(item => fold(item) === fold(pizza))) {
      return { state: next, hangup: false, say: `La pizza ${pizza} no está disponible. ¿Qué otra desea?` };
    }
    next.product = pizza;
  }
  const size = heardSize(text);
  if (size) {
    next.size = size;
  }
  const fulfillment = heardFulfillment(text);
  if (fulfillment) {
    next.fulfillment = fulfillment;
  }
  if (!next.product) {
    if (/\bpizza\b/.test(text)) {
      return sameQuestion(next, "No manejamos esa. Tenemos mexicana, peperoni y deluxe. ¿Cuál desea?");
    }
    return sameQuestion(next, "¿Qué desea ordenar?");
  }
  if (!next.size) {
    return sameQuestion(next, `${next.product}, ¿mediana, grande o familiar?`);
  }
  if (!next.offeredMore && !/\bno\b/.test(text) && !/\b(coca|soda|fresa)\b/.test(text)) {
    next.offeredMore = true;
    return { state: next, hangup: false, say: "¿Desea agregar algo más? ¿Alguna bebida?" };
  }
  next.offeredMore = true;
  if (!fulfillment) {
    const drink = drinkQuestion(utterance, next.drink);
    if (drink) {
      next.drink = drink.drink;
      return { state: next, hangup: false, say: drink.say };
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
  if (!next.postalCode) {
    if (/^\d{5}$/.test(postal)) {
      next.postalCode = postal;
    } else {
      return sameQuestion(next, "¿Cuál es el código postal?");
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
    if (streetNumber(utterance) || /\b(calle|privada|avenida|numero|n[uú]mero)\b/.test(text)) {
      next.street = utterance.trim();
      next.house = streetNumber(utterance);
    } else {
      return sameQuestion(next, "¿Cuál es la calle y el número?");
    }
  }
  if (!next.agreed) {
    if (/\b(si|confirmo|confirmado|correcto|de acuerdo|esta bien|estaria bien)\b/.test(text) && next.askedAgree) {
      next.agreed = true;
    } else if (!next.askedAgree) {
      next.askedAgree = true;
      return {
        state: next,
        hangup: false,
        say: `Su pedido es una pizza ${next.size} de ${next.product}, a domicilio, en ${next.street}, colonia ${next.colony}, código ${next.postalCode}. ¿Está de acuerdo?`
      };
    } else {
      return { state: next, hangup: false, say: "¿Está de acuerdo con su pedido?" };
    }
  }
  return {
    state: next,
    hangup: false,
    save: true,
    say: "Su pedido quedó confirmado con éxito. Llegará a su domicilio en aproximadamente 30 minutos. Que tenga buen día y gracias por llamar a Pizzería Hermosillo."
  };
}
