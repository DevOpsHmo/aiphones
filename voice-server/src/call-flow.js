import { mushroomIntent, mentionedQuantity } from "./turn-policy.js";
import { priceLine } from "./confirmation.js";
import { matchIngredients } from "./menu-ingredients.js";

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

export function correctName(current, utterance) {
  const text = fold(utterance);
  const matches = [...text.matchAll(/\bsoy\s+([a-z]+)\b/g)];
  const renamed = matches.at(-1);
  const denied = /\bno soy\b/.test(text) || /\botra persona\b/.test(text);
  if (renamed && (denied || renamed[1] !== fold(current).split(" ")[0])) {
    const first = renamed[1][0].toUpperCase() + renamed[1].slice(1);
    return { name: first, needsLastName: true };
  }
  return { name: current, needsLastName: false };
}

export function mentionedSize(utterance) {
  const text = fold(utterance);
  return SIZES.find(size => text.includes(size)) || "";
}

export function matchPizza(utterance) {
  const text = fold(utterance);
  return MENU_PIZZAS.find(name => text.includes(fold(name))) || "";
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

  if (next.product && !next.size) {
    return {
      state: next,
      hangup: false,
      say: "¿Mediana 200, grande 220 o familiar 250?"
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
