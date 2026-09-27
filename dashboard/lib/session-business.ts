import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionBusiness = {
  id: string;
  name: string;
  monthly_minute_limit?: number | null;
  minute_warning?: number | null;
  minutes_reset_at?: string | null;
};

export async function loadSessionBusiness(supabase: SupabaseClient) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, businesses(*)")
      .eq("id", userId)
      .maybeSingle();
    const linked = profile?.businesses as SessionBusiness | SessionBusiness[] | null;
    const business = Array.isArray(linked) ? linked[0] : linked;
    if (profile?.business_id && business) {
      return { ...business, id: profile.business_id as string };
    }
  }

  const { data } = await supabase.from("businesses").select("*").limit(1).maybeSingle();
  return (data as SessionBusiness | null) || null;
}
