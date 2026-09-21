import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";

export async function createClient() {
  const { url, key, configured } = getSupabasePublicEnv();
  if (!configured) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellena Project Settings > API."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Llamado desde un Server Component: la sesion se refresca en middleware.
        }
      },
    },
  });
}
