import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridas");
}

// Cliente con service_role: bypassa RLS. Solo se usa en este servidor.
export const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function fetchActiveProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, price, category")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`products: ${error.message}`);
  return data ?? [];
}

export async function upsertCustomer({ phone, name, address }) {
  const { data: existing, error: findErr } = await supabase
    .from("customers")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (findErr) throw new Error(`customers find: ${findErr.message}`);

  if (existing) {
    const patch = {};
    if (name) patch.name = name;
    if (address) patch.address = address;
    if (Object.keys(patch).length === 0) return existing;
    const { data, error } = await supabase
      .from("customers")
      .update(patch)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(`customers update: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({ phone, name: name ?? null, address: address ?? null })
    .select()
    .single();
  if (error) throw new Error(`customers insert: ${error.message}`);
  return data;
}

export async function insertOrder({ customerId, items, total, orderType, address }) {
  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      items,
      total,
      order_type: orderType,
      address,
      status: "PENDIENTE",
    })
    .select()
    .single();
  if (error) throw new Error(`orders insert: ${error.message}`);
  return data;
}

export async function saveCall({ callSid, from, to, duration, transcript, orderId }) {
  const { error } = await supabase.from("calls").upsert(
    { call_sid: callSid, from, to, duration, transcript, order_id: orderId },
    { onConflict: "call_sid" }
  );
  if (error) throw new Error(`calls upsert: ${error.message}`);
}
