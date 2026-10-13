import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/supabase/env";

/** Renova a sessão da equipe a cada requisição para /app. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const mode = process.env.APP_SURFACE;
  if (mode === "customer" && path.startsWith("/app")) {
    return NextResponse.redirect(new URL(path + request.nextUrl.search, process.env.NEXT_PUBLIC_ADMIN_URL!));
  }
  if (mode === "customer" && /^\/api\/(auth|manage|staff|team|revenda|upload|qr)(\/|$)/.test(path)) return new NextResponse(null, {status:404});
  if (mode === "admin" && /^\/[^/]+\/m\/[^/]+/.test(path)) return NextResponse.redirect(new URL(path + request.nextUrl.search, process.env.NEXT_PUBLIC_MENU_URL!));
  if (!path.startsWith("/app")) return NextResponse.next();
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*", "/:slug/m/:qrToken"],
};
