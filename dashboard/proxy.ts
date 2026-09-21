import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "./lib/supabase/env";

export async function proxy(request: NextRequest) {
  const { url, key, configured } = getSupabasePublicEnv();
  if (!configured) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request
  });

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([keyName, headerValue]) => {
            response.headers.set(keyName, headerValue);
          });
        }
      }
    });

    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const pathname = request.nextUrl.pathname;

    const isPublic =
      pathname === "/" ||
      pathname === "/manifest.webmanifest" ||
      pathname === "/icon" ||
      pathname === "/apple-icon" ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/auth");

    if (!user && !isPublic) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch {
    return response;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)"
  ]
};
