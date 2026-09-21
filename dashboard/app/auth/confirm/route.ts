import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (tokenHash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType
    });

    if (!error) {
      return NextResponse.redirect(
        new URL("/dashboard", url.origin)
      );
    }
  }

  return NextResponse.redirect(
    new URL("/login", url.origin)
  );
}
