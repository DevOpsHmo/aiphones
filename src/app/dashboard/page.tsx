"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderStatus } from "@/lib/types";

const STATUSES: OrderStatus[] = ["PENDIENTE", "CONFIRMADO", "PREPARANDO", "LISTO", "ENTREGADO"];

const badge: Record<OrderStatus, string> = {
  PENDIENTE: "bg-yellow-100 text-yellow-800",
  CONFIRMADO: "bg-blue-100 text-blue-800",
  PREPARANDO: "bg-purple-100 text-purple-800",
  LISTO: "bg-green-100 text-green-800",
  ENTREGADO: "bg-gray-200 text-gray-600",
};

export default function OrdersPage() {
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrderStatus | "TODOS">("TODOS");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("*, customers(name, phone)")
      .order("created_at", { ascending: false });
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  async function setStatus(order: Order, status: OrderStatus) {
    const { error } = await supabase.from("orders").update({ status }).eq("id", order.id);
    if (error) alert(error.message);
    else await load();
  }

  const visible = filter === "TODOS" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pedidos</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as OrderStatus | "TODOS")}
          className="rounded-lg border bg-white px-3 py-1.5 text-sm"
        >
          <option value="TODOS">Todos</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500">No hay pedidos{filter !== "TODOS" ? ` con estado ${filter}` : ""}.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((order) => (
            <div key={order.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    #{order.id.slice(0, 6).toUpperCase()} · {order.customers?.name ?? "Cliente"} ·{" "}
                    <span className="text-gray-500">{order.customers?.phone}</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {order.items.map((it) => `${it.quantity}× ${it.product_name}`).join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {order.order_type === "delivery" ? `Entrega: ${order.address ?? "sin direccion"}` : "Recoge en tienda"} ·{" "}
                    {new Date(order.created_at).toLocaleString("es-MX")}
                  </p>
                </div>
                <p className="text-base font-semibold">${Number(order.total).toFixed(2)}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge[order.status]}`}>
                  {order.status}
                </span>
                <span className="flex-1" />
                {STATUSES.filter((s) => s !== order.status).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(order, s)}
                    className="rounded-lg border px-2.5 py-1 text-xs hover:bg-gray-100"
                  >
                    → {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
