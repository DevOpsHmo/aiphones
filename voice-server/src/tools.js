import twilio from "twilio";
import { config } from "./config.js";
import { normalizePhone, supabase } from "./supabase.js";

const SIZE_PRICES = {
  mediana: 200,
  grande: 220,
  familiar: 250
};

function isPizza(product) {
  return (
    product.category === "Pizzas" ||
    /^pizza\b/i.test(product.name || "")
  );
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

function itemNotes(size, sauce) {
  return [size, sauce].filter(Boolean).join(", ");
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

  return {
    pizza_sizes: SIZE_PRICES,
    products: (data || []).map(product => ({
      ...product,
      price: isPizza(product) ? null : Number(product.price),
      sizes: isPizza(product) ? SIZE_PRICES : undefined,
      sauce_options: needsSauce(product)
        ? ["bbq", "buffalo"]
        : undefined
    }))
  };
}

export function formatMenuForPrompt(menu) {
  const lines = [
    "Pizzas: mediana $200, grande $220, familiar $250."
  ];

  for (const product of menu.products || []) {
    const price = product.sizes
      ? "precio por tamaño"
      : `$${Number(product.price).toFixed(0)}`;
    const sauce = product.sauce_options
      ? " Salsas: bbq o buffalo."
      : "";

    lines.push(
      `- ${product.name} | id ${product.id} | ${product.category} | ${price}.${sauce} ${product.description || ""}`.trim()
    );
  }

  return lines.join("\n");
}

const HERMOSILLO = {
  minLat: 28.85,
  maxLat: 29.3,
  minLng: -111.2,
  maxLng: -110.8
};

export async function checkAddressTool({
  postalCode,
  street,
  colony
}) {
  const cp = String(postalCode || "").replace(/\D/g, "");

  if (!/^83\d{3}$/.test(cp) || Number(cp) < 83000 || Number(cp) > 83299) {
    return {
      ok: false,
      error: "Ese código postal no es de Hermosillo, Sonora. Pídelo otra vez."
    };
  }

  if (!street?.trim() || !colony?.trim()) {
    return {
      ok: false,
      error: "Faltan la calle o la colonia."
    };
  }

  const query = [
    street.trim(),
    colony.trim(),
    cp,
    "Hermosillo",
    "Sonora",
    "Mexico"
  ].join(", ");

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "mx");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "AI-Phone/1.0 (Pizzeria Hermosillo)",
      "Accept-Language": "es"
    }
  });

  if (!response.ok) {
    return {
      ok: false,
      error: "No pude verificar la dirección. Pide que la repita."
    };
  }

  const rows = await response.json();
  const hit = rows[0];
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  const place = hit?.address || {};
  const city = place.city || place.town || place.municipality || "";
  const inside =
    city.toLowerCase().includes("hermosillo") &&
    lat >= HERMOSILLO.minLat &&
    lat <= HERMOSILLO.maxLat &&
    lng >= HERMOSILLO.minLng &&
    lng <= HERMOSILLO.maxLng;

  if (!hit || !inside) {
    return {
      ok: false,
      error: "Esa calle o colonia no está en Hermosillo, Sonora. Pide que la repita."
    };
  }

  const foundStreet = place.road || street.trim();
  const foundColony =
    place.suburb || place.neighbourhood || place.quarter || colony.trim();
  const foundCp = place.postcode || cp;

  return {
    ok: true,
    address: `${foundStreet}, ${foundColony}, C.P. ${foundCp}, Hermosillo, Sonora`
  };
}

export async function createOrderTool({
  businessId,
  callId,
  customerName,
  customerPhone,
  orderType,
  address,
  items,
  confirmed,
  paymentMethod
}) {
  if (confirmed === false) {
    throw new Error(
      "El pedido no se guardó porque no está confirmado."
    );
  }

  paymentMethod = paymentMethod || "efectivo";
  orderType = orderType || "delivery";

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
    !address?.trim()
  ) {
    throw new Error(
      "La dirección es obligatoria para delivery."
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
        "id,name,price,available,business_id,category"
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

    if (!product.available) {
      throw new Error(
        `El producto ${product.name} no está disponible.`
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

    if (isPizza(product)) {
      unitPrice = pizzaPrice(size);
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

    calculatedItems.push({
      product_id: product.id,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(size, sauce) || null
    });
  }

  let customer = null;

  if (customerPhone?.trim()) {
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", customerPhone)
      .maybeSingle();

    customer = data;
  }

  if (customer) {
    const { data, error } =
      await supabase
        .from("customers")
        .update({
          name: customerName,
          address:
            address || customer.address
        })
        .eq("id", customer.id)
        .select()
        .single();

    if (error) {
      throw error;
    }

    customer = data;
  } else {
    const { data, error } =
      await supabase
        .from("customers")
        .insert({
          business_id: businessId,
          name: customerName,
          phone:
            customerPhone || null,
          address:
            address || null
        })
        .select()
        .single();

    if (error) {
      throw error;
    }

    customer = data;
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

  return {
    success: true,
    order_id: order.id,
    total,
    currency: "MXN",
    payment_method: paymentMethod,
    customer_name: customerName
  };
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
    .select("id,customer_id,address,total,created_at,status")
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
      customer_name: customer?.name || "",
      address: order.address,
      items: items || []
    };
  }

  return { found: false };
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

  const expected = (last.customer_name || "").trim().toLowerCase();
  const given = (customerName || "").trim().toLowerCase();

  if (expected && given && expected !== given) {
    throw new Error(
      `El pedido está a nombre de ${last.customer_name}.`
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
    .update({
      product_id: product.id,
      name: product.name,
      quantity: nextQuantity,
      unit_price: unitPrice,
      subtotal,
      notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce) || null
    })
    .eq("id", item.id);

  if (itemError) {
    throw itemError;
  }

  const { error: orderError } = await supabase
    .from("orders")
    .update({ total: subtotal })
    .eq("id", last.order_id);

  if (orderError) {
    throw orderError;
  }

  return {
    success: true,
    order_id: last.order_id,
    customer_name: last.customer_name,
    item: product.name,
    notes: itemNotes(isPizza(product) ? nextSize : null, nextSauce),
    total: subtotal
  };
}

export async function endCallTool(callSid) {
  if (!callSid) {
    return { success: false };
  }

  await new Promise(resolve => setTimeout(resolve, 8000));

  await twilio(
    config.twilioAccountSid,
    config.twilioAuthToken
  )
    .calls(callSid)
    .update({ status: "completed" });

  return { success: true };
}
