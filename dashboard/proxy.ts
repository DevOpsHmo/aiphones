import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "./lib/supabase/env";

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}

function withSecurity(response: NextResponse, policy: string) {
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  response.headers.set("X-DNS-Prefetch-Control", "off");
}

function nextWithNonce(request: NextRequest, requestHeaders: Headers) {
  return NextResponse.next({
    request: { headers: requestHeaders }
  });
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const { url, key, configured } = getSupabasePublicEnv();
  if (!configured) {
    const response = nextWithNonce(request, requestHeaders);
    withSecurity(response, policy);
    return response;
  }

  let response = nextWithNonce(request, requestHeaders);

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

          response = nextWithNonce(request, requestHeaders);

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
      const redirect = NextResponse.redirect(new URL("/login", request.url));
      withSecurity(redirect, policy);
      return redirect;
    }

    if (user && pathname === "/login") {
      const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
      withSecurity(redirect, policy);
      return redirect;
    }
  } catch {
    withSecurity(response, policy);
    return response;
  }

  withSecurity(response, policy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)"
  ]
};
