import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function logout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const NAV = [
  { href: "/dashboard", label: "Pedidos" },
  { href: "/dashboard/products", label: "Productos" },
  { href: "/dashboard/customers", label: "Clientes" },
  { href: "/dashboard/calls", label: "Llamadas" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold">Pedidos por Voz</span>
            <nav className="flex gap-4">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-sm text-gray-600 hover:text-black">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">{user.email}</span>
            <form action={logout}>
              <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
