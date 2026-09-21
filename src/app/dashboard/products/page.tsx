"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/lib/types";

const emptyForm = { name: "", price: "", category: "General" };

export default function ProductsPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const price = parseFloat(form.price);
    if (!form.name.trim() || isNaN(price) || price < 0) {
      alert("Nombre y precio valido son obligatorios");
      return;
    }
    const { error } = await supabase
      .from("products")
      .insert({ name: form.name.trim(), price, category: form.category.trim() || "General" });
    if (error) return alert(error.message);
    setForm(emptyForm);
    await load();
  }

  function startEdit(product: Product) {
    setEditing(product);
    setEditForm({ name: product.name, price: String(product.price), category: product.category });
  }

  async function saveEdit() {
    if (!editing) return;
    const price = parseFloat(editForm.price);
    if (!editForm.name.trim() || isNaN(price) || price < 0) {
      alert("Nombre y precio valido son obligatorios");
      return;
    }
    const { error } = await supabase
      .from("products")
      .update({ name: editForm.name.trim(), price, category: editForm.category.trim() || "General" })
      .eq("id", editing.id);
    if (error) return alert(error.message);
    setEditing(null);
    await load();
  }

  async function toggleActive(product: Product) {
    const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
    if (error) return alert(error.message);
    await load();
  }

  async function removeProduct(product: Product) {
    if (!confirm(`Eliminar "${product.name}"?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) return alert(error.message);
    await load();
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Productos</h1>

      <form onSubmit={addProduct} className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border bg-white p-4 shadow-sm">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Nombre"
          required
          className="min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <input
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          placeholder="Precio"
          type="number"
          step="0.01"
          min="0"
          required
          className="w-28 rounded-lg border px-3 py-2 text-sm"
        />
        <input
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          placeholder="Categoria"
          className="w-36 rounded-lg border px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white">Agregar</button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Precio</th>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2">Activo</th>
                <th className="px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) =>
                editing?.id === p.id ? (
                  <tr key={p.id} className="border-b">
                    <td className="px-4 py-2">
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded border px-2 py-1" />
                    </td>
                    <td className="px-4 py-2">
                      <input value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} type="number" step="0.01" min="0" className="w-24 rounded border px-2 py-1" />
                    </td>
                    <td className="px-4 py-2">
                      <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-32 rounded border px-2 py-1" />
                    </td>
                    <td className="px-4 py-2">{p.active ? "Si" : "No"}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={saveEdit} className="mr-2 rounded-lg bg-black px-3 py-1 text-xs text-white">Guardar</button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border px-3 py-1 text-xs">Cancelar</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2">${Number(p.price).toFixed(2)}</td>
                    <td className="px-4 py-2">{p.category}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => toggleActive(p)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${p.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>
                        {p.active ? "Activo" : "Inactivo"}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => startEdit(p)} className="mr-2 rounded-lg border px-3 py-1 text-xs hover:bg-gray-100">Editar</button>
                      <button onClick={() => removeProduct(p)} className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">Eliminar</button>
                    </td>
                  </tr>
                )
              )}
              {products.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Sin productos. Agrega el menu para que la IA pueda tomar pedidos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
