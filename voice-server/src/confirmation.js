import { matchIngredient, EXTRA_PRICE } from "./menu-ingredients.js";

const SIZE_PRICES = { mediana: 200, grande: 220, familiar: 250 };

export function priceLine({ size, extra, extras, quantity }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    return { ok: false, error: "Cantidad inválida" };
  }
  const base = SIZE_PRICES[size];
  if (!base) {
    return { ok: false, error: "Tamaño inválido" };
  }
  const requested = [...new Set([...(extras || []), extra].filter(Boolean))];
  const priced = [];
  for (const name of requested) {
    const official = matchIngredient(name);
    if (!official) {
      return { ok: false, error: "Extra inválido" };
    }
    if (!priced.some(item => item.nombre === official)) {
      priced.push({ nombre: official, precio: EXTRA_PRICE });
    }
  }
  const extrasTotal = priced.reduce((sum, item) => sum + item.precio, 0);
  const unit = base + extrasTotal;
  return {
    ok: true,
    base,
    extras: priced,
    extrasTotal,
    unit,
    subtotal: unit * qty,
    quantity: qty,
    size,
    extra: priced[0]?.nombre || ""
  };
}

export function buildConfirmation(draft) {
  const lines = [];
  let total = 0;
  for (const item of draft.items || []) {
    const priced = priceLine(item);
    if (!priced.ok) {
      return priced;
    }
    if (priced.unit !== item.unit && item.unit != null) {
      return { ok: false, error: "El precio no coincide con el servidor" };
    }
    total += priced.subtotal;
    const topping = priced.extra === "champinones" ? " con champiñones" : "";
    lines.push(`${priced.quantity} pizza ${priced.size}${topping} ${priced.subtotal}`);
  }
  if (!lines.length) {
    return { ok: false, error: "Pedido incompleto" };
  }
  if (draft.orderType === "delivery") {
    if (!draft.address?.trim()) {
      return { ok: false, error: "Falta la dirección" };
    }
    if (!/^\d{5}$/.test(draft.postalCode || "")) {
      return { ok: false, error: "Falta el código postal" };
    }
  }
  if (draft.claimedTotal != null && Number(draft.claimedTotal) !== total) {
    return { ok: false, error: "El total dicho no es el del servidor" };
  }
  const place = draft.orderType === "delivery"
    ? ` Domicilio ${draft.address}, C.P. ${draft.postalCode}.`
    : " Para recoger.";
  return {
    ok: true,
    version: draft.version || 1,
    total,
    lines,
    postalCode: draft.postalCode || "",
    address: draft.address || "",
    spoken: `Muy bien, ${draft.customerName}. Tu pedido quedó listo: ${lines.join(", ")}. Total ${total}.${place} ¿Tiene alguna duda con tu pedido?`
  };
}

export function reviseDraft(draft, patch) {
  return {
    ...draft,
    ...patch,
    version: (draft.version || 1) + 1,
    spoken: null
  };
}

export function acceptSpoken(draft, confirmation) {
  if (!confirmation?.ok) {
    return { ok: false, error: confirmation?.error || "Sin confirmación" };
  }
  if (confirmation.version !== draft.version) {
    return { ok: false, error: "El pedido cambió. Hay que confirmar otra vez." };
  }
  return { ok: true, spoken: confirmation.spoken, total: confirmation.total };
}
