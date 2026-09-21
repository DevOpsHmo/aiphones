"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Call } from "@/lib/types";

export default function CallsPage() {
  const supabase = createClient();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("calls")
      .select("*, orders(id, total, status)")
      .order("created_at", { ascending: false });
    setCalls((data as Call[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("calls-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Llamadas</h1>
      {loading ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-gray-500">Aun no hay llamadas registradas.</p>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <div key={call.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="font-medium">{call.from} → {call.to}</p>
                <p className="text-xs text-gray-500">
                  {call.duration}s · {new Date(call.created_at).toLocaleString("es-MX")}
                  {call.orders ? ` · Pedido #${call.orders.id.slice(0, 6).toUpperCase()} ($${Number(call.orders.total).toFixed(2)}, ${call.orders.status})` : " · sin pedido"}
                </p>
              </div>
              {call.transcript && (
                <button
                  onClick={() => setOpen(open === call.id ? null : call.id)}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  {open === call.id ? "Ocultar transcripcion" : "Ver transcripcion"}
                </button>
              )}
              {open === call.id && (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                  {call.transcript}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
