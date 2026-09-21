import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!client) {
    const { url, key, configured } = getSupabasePublicEnv();
    if (!configured) {
      throw new Error(
        "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y reinicia npm run dev."
      );
    }
    client = createBrowserClient(url, key);
  }
  return client;
}
