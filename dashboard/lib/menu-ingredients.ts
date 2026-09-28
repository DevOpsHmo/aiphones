const DROP = new Set([
  "pizza", "de", "en", "con", "y", "banado", "banada", "rebanadas", "fresco",
  "aceite", "oliva", "aderezo", "especial", "doble", "extra", "morada", "morron",
  "rojo", "verde", "negras", "ahumados"
]);

const LABELS: Record<string, string> = {
  pina: "Piña",
  jamon: "Jamón",
  champinones: "Champiñones",
  jalapenos: "Jalapeños",
  cebolla: "Cebolla",
  cereza: "Cereza",
  tocino: "Tocino",
  pepperoni: "Pepperoni",
  peperoni: "Peperoni",
  queso: "Queso",
  "queso mozzarella": "Queso mozzarella",
  aceitunas: "Aceitunas",
  pimiento: "Pimiento",
  chorizo: "Chorizo",
  frijoles: "Frijoles",
  espinacas: "Espinacas",
  albahaca: "Albahaca",
  tomate: "Tomate",
  ostiones: "Ostiones",
  pollo: "Pollo",
  chilorio: "Chilorio",
  salami: "Salami",
  "orilla rellena de queso": "Orilla rellena de queso",
  "queso extra": "Queso extra",
  "salsa tomate": "Salsa de tomate",
  "salsa bufalo": "Salsa búfalo",
  "pollo salsa bbq": "Pollo en salsa BBQ",
  "pollo salsa chipotle": "Pollo en salsa chipotle",
  "pechuga pollo cilantro": "Pechuga de pollo"
};

export function foldIngredient(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ingredientDescription(value: string) {
  return String(value || "")
    .replace(/\.\s*\d*\s*pizzas?\b[\s\S]*$/i, "")
    .replace(/\b\d+\s*pizzas?\b[\s\S]*$/i, "")
    .replace(/\d+\s*(?:pulgadas|'|’|′).*$/i, "")
    .replace(/[.\s]+$/g, "")
    .trim();
}

export function ingredientsFromText(description: string) {
  const cleaned = ingredientDescription(description);
  const parts = cleaned.split(/,| y /i);
  const found: string[] = [];
  for (const part of parts) {
    const words = foldIngredient(part)
      .split(" ")
      .filter(word => word && !DROP.has(word) && word.length > 2);
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

export function descriptionHasIngredient(description: string, ingredientName: string) {
  const key = foldIngredient(ingredientName);
  if (!key) {
    return false;
  }
  if (ingredientsFromText(description).includes(key)) {
    return true;
  }
  const blob = ` ${foldIngredient(ingredientDescription(description))} `;
  return blob.includes(` ${key} `);
}

export function ingredientLabel(name: string) {
  return LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
}
