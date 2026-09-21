// Construye los items del pedido con precios reales de la base de datos
// (nunca se confía en el total que devuelva la IA).
export function buildOrderItems(products, requested) {
  const items = [];
  for (const req of requested) {
    const name = String(req.product_name ?? "").trim();
    const quantity = Math.max(1, parseInt(req.quantity, 10) || 1);
    const product = matchProduct(products, name);
    if (product) {
      items.push({
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: Number(product.price),
      });
    } else {
      items.push({ product_id: null, product_name: name, quantity, unit_price: 0 });
    }
  }
  const total = items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
  return { items, total: Math.round(total * 100) / 100 };
}

function matchProduct(products, name) {
  const norm = normalize(name);
  return (
    products.find((p) => normalize(p.name) === norm) ??
    products.find(
      (p) =>
        norm.includes(normalize(p.name)) || normalize(p.name).includes(norm)
    ) ??
    null
  );
}

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
