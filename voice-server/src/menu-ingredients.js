const DESCRIPTIONS = [
  "Pollo bañado en salsa BBQ y tocino.",
  "Pechuga de pollo bañada en aderezo especial de cilantro.",
  "Pollo bañado en salsa chipotle y cebolla morada.",
  "Pizza de ostiones ahumados y pimiento morrón rojo.",
  "Champiñones, pepperoni, pimiento verde y jamón.",
  "Piña, jamón y cereza.",
  "Champiñones, pepperoni, pimiento verde y rojo, cebolla, aceitunas negras.",
  "Pollo, salsa de tomate, queso mozzarella y salsa búfalo.",
  "Rebanadas de tomate fresco, aceite de oliva, queso mozzarella y albahaca.",
  "Jalapeños, chorizo, tocino, cebolla y frijoles.",
  "Pizza de peperoni.",
  "Chilorio, champiñones, cebolla y pimiento verde.",
  "Espinacas, queso doble, tomate en rebanadas.",
  "Jamón, pepperoni, salami, queso mozzarella.",
  "Salsa de tomate, queso extra, cebolla, aceitunas negras y pimiento verde."
];

const DROP = new Set([
  "pizza", "de", "en", "con", "y", "banado", "banada", "rebanadas", "fresco",
  "aceite", "oliva", "aderezo", "especial", "doble", "extra", "morada", "morron",
  "rojo", "verde", "negras", "ahumados"
]);

export function foldIngredient(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ingredientsFromText(description) {
  const cleaned = String(description || "")
    .replace(/1 pizza grande.*/i, "")
    .replace(/\d+\s*pulgadas.*/i, "");
  const parts = cleaned.split(/,| y /i);
  const found = [];
  for (const part of parts) {
    const words = foldIngredient(part).split(" ").filter(word => word && !DROP.has(word) && word.length > 2);
    if (!words.length) {
      continue;
    }
    const name = words.join(" ");
    if (!found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

const SPECIAL_EXTRAS = ["orilla rellena de queso", "queso extra"];

export function menuIngredients(descriptions = DESCRIPTIONS) {
  const all = [];
  for (const description of descriptions) {
    for (const name of ingredientsFromText(description)) {
      if (!all.includes(name)) {
        all.push(name);
      }
    }
  }
  for (const name of SPECIAL_EXTRAS) {
    if (!all.includes(name)) {
      all.push(name);
    }
  }
  return all;
}

export function bakeNote(value) {
  const text = foldIngredient(value);
  if (!text) {
    return "";
  }
  if (/\bdorad|\bbien cocid|\bmas horno|\bmas tiempo|\bhorno\b/.test(text)) {
    return "Bien doradita";
  }
  return "";
}

export function matchIngredient(said, catalog = menuIngredients()) {
  const text = foldIngredient(said);
  if (!text) {
    return "";
  }
  const sorted = [...catalog].sort((left, right) => right.length - left.length);
  return sorted.find(name => text.includes(name) || name.startsWith(text) || text.startsWith(name)) || "";
}

export function matchIngredients(utterance, catalog = menuIngredients()) {
  const text = foldIngredient(utterance);
  if (!/\b(extra|con|ponle|agrega|agregale|sin|quita|quitale|no quiero)\b/.test(text)) {
    return [];
  }
  const found = [];
  for (const name of [...catalog].sort((left, right) => right.length - left.length)) {
    if (text.includes(name) || (name.length > 4 && text.includes(name.slice(0, -1)))) {
      if (!found.includes(name)) {
        found.push(name);
      }
    }
  }
  return found;
}

const SAME_INGREDIENT = [
  ["pepperoni", "peperoni"]
];

function alreadyOnPizza(official, builtIn) {
  if (builtIn.has(official)) {
    return true;
  }
  return SAME_INGREDIENT.some(
    group => group.includes(official) && group.some(name => builtIn.has(name))
  );
}

export function billableExtras(requested, description, catalog = menuIngredients()) {
  const builtIn = new Set(ingredientsFromText(description));
  const extras = [];
  for (const said of requested || []) {
    const official = matchIngredient(said, catalog);
    if (!official || alreadyOnPizza(official, builtIn)) {
      continue;
    }
    if (!extras.includes(official)) {
      extras.push(official);
    }
  }
  return extras;
}

export const EXTRA_PRICE = 25;
