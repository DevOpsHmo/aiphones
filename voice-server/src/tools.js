import { supabase } from "./supabase.js";

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
    products: data || []
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
  if (confirmed !== true) {
    throw new Error(
      "El pedido requiere confirmación explícita."
    );
  }

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
        "id,name,price,available,business_id"
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

    const unitPrice =
      Number(product.price);

    const subtotal =
      unitPrice * quantity;

    total += subtotal;

    calculatedItems.push({
      product_id: product.id,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      subtotal
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
    payment_method: paymentMethod
  };
}
