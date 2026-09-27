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
  const pizza = matchPizza(utterance);
  if (/\bchampi/.test(text)) {
    const sized = next.size || "mediana";
    const base = { mediana: 200, grande: 220, familiar: 250 }[sized];
    next.product = "Peperoni";
    next.size = sized;
    next.extra = "champinones";
    return {
      state: next,
      hangup: false,
      say: `Muy bien, pepperoni con champiñones subiría de ${base} a ${base + 25}, ¿de acuerdo?`
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
