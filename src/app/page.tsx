import { redirect } from "next/navigation";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">Configura Supabase</h1>
        <p className="text-sm text-gray-600">
          Las claves ya están en <code className="rounded bg-gray-100 px-1">.env.local</code>. Falta
          el <code className="rounded bg-gray-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> (todavía es
          el placeholder).
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
          <li>
            Abre{" "}
            <a
              className="underline"
              href="https://supabase.com/dashboard/project/_/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              Project Settings → API
            </a>
            .
          </li>
          <li>
            Copia el <strong>Project URL</strong> (formato{" "}
            <code className="rounded bg-gray-100 px-1">https://xxxxx.supabase.co</code>) y pégalo
            aquí en el chat, o en <code className="rounded bg-gray-100 px-1">.env.local</code>.
          </li>
          <li>
            Reinicia <code className="rounded bg-gray-100 px-1">npm run dev</code>.
          </li>
        </ol>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/login");
}
