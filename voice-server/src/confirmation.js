import { matchIngredient, EXTRA_PRICE } from "./menu-ingredients.js";

const SIZE_PRICES = { mediana: 200, grande: 220, familiar: 250 };

export function paymentForOrder(orderType, method) {
  if (orderType !== "pickup") {
    return "efectivo";
  }
  if (method === "tarjeta" || method === "transferencia" || method === "efectivo") {
    return method;
  }
  return "efectivo";
}

export function priceLine({ size, extra, extras, quantity, catalog, prices, extraPrice, extraPrices }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    return { ok: false, error: "Cantidad inválida" };
  }
  const sizePrices = prices || SIZE_PRICES;
  const toppingPrice = Number(extraPrice ?? EXTRA_PRICE);
  const base = sizePrices[size];
  if (!base) {
    return { ok: false, error: "Tamaño inválido" };
  }
  const requested = [...new Set([...(extras || []), extra].filter(Boolean))];
  const priced = [];
  for (const name of requested) {
    const official = matchIngredient(name, catalog);
    if (!official) {
      const known = matchIngredient(name);
      if (known && catalog) {
        return { ok: false, error: `${known} no está disponible. Di que no se puede agregar.` };
      }
      return { ok: false, error: "Extra inválido" };
    }
    if (!priced.some(item => item.nombre === official)) {
      const own = extraPrices?.[official];
      const price = own != null && Number.isFinite(Number(own)) ? Number(own) : toppingPrice;
      priced.push({ nombre: official, precio: price });
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
  const grandeLines = (draft.items || []).filter(item => item.size === "grande");
  const grandeCount = grandeLines.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const extrasOnGrandes = grandeLines.some(item => (item.extras && item.extras.length) || item.extra);
  const pairPromo = grandeCount === 2 && !extrasOnGrandes;
  const sizePrices = draft.prices || SIZE_PRICES;
  const extraPrice = draft.extraPrice ?? EXTRA_PRICE;
  const promoPair = Number(draft.promoPair ?? 400);
  for (const item of draft.items || []) {
    if (!sizePrices[item.size]) {
      const qty = Number(item.quantity);
      const unit = Number(item.unit);
      if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(unit)) {
        return { ok: false, error: "Bebida inválida" };
      }
      total += unit * qty;
      lines.push(`${qty} ${item.name || "refresco"}`);
      continue;
    }
    const priced = priceLine({ ...item, prices: sizePrices, extraPrice, extraPrices: draft.extraPrices });
    if (!priced.ok) {
      return priced;
    }
    const promoOff = pairPromo && item.size === "grande"
      ? sizePrices.grande - promoPair / 2
      : 0;
    const expected = priced.unit - promoOff;
    if (item.unit != null && Number(item.unit) !== expected) {
      return { ok: false, error: "El precio no coincide con el servidor" };
    }
    total += expected * priced.quantity;
    const extras = priced.extras
      .map(entry => (entry.nombre === "champinones" ? "champiñones" : entry.nombre))
      .join(" y ");
    const pizzaName = item.name ? ` de ${item.name}` : "";
    lines.push(`${priced.quantity} pizza${pizzaName} ${priced.size}${extras ? ` con ${extras}` : ""}`);
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
  const digits = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  const spokenCode = (draft.postalCode || "")
    .split("")
    .map(digit => digits[Number(digit)] || digit)
    .join(", ");
  const street = (draft.address || "")
    .replace(/,?\s*Hermosillo,?\s*Sonora/gi, "")
    .replace(/,?\s*C\.P\.\s*\d{5}/gi, "")
    .replace(/,\s*,/g, ", ")
    .replace(/,\s*$/, "")
    .trim();
  const pay = draft.paymentMethod === "tarjeta"
    ? "con tarjeta"
    : draft.paymentMethod === "transferencia"
      ? "por transferencia"
      : "en efectivo";
  const place = draft.orderType === "delivery"
    ? ` A ${street}. Código ${spokenCode}. El pago es ${pay}. Su pedido llegará a su domicilio en aproximadamente 30 minutos. Muchas gracias por llamar a Pizzería Hermosillo. Que tenga buen día. Hasta luego.`
    : ` Para recoger. El pago es ${pay}. Estará listo en aproximadamente 30 minutos. Muchas gracias por llamar a Pizzería Hermosillo. Que tenga buen día. Hasta luego.`;
  return {
    ok: true,
    version: draft.version || 1,
    total,
    lines,
    postalCode: draft.postalCode || "",
    address: draft.address || "",
    spoken: `Muy bien, ${draft.customerName}, su pedido ha quedado confirmado: ${lines.join(", ")}. Total ${total}.${place}`
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
