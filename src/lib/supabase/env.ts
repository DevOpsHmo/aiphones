export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const configured =
    url.startsWith("https://") &&
    !url.includes("TU-PROYECTO") &&
    key.length > 20;

  return { url, key, configured };
}
