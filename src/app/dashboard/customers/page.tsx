"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = customers.filter(
    (c) =>
      c.phone.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.address ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Clientes</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por telefono, nombre o direccion"
          className="w-80 rounded-lg border bg-white px-3 py-1.5 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Telefono</th>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Direccion</th>
                <th className="px-4 py-2">Desde</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-2">{c.name ?? "—"}</td>
                  <td className="px-4 py-2">{c.address ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(c.created_at).toLocaleDateString("es-MX")}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Sin clientes.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
