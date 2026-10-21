import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/supabase/env";

/**
 * 1. Domínio próprio (spec-fase2.md, seção 7): um host que não é o do projeto
 *    é resolvido no banco. Domínio da revenda serve /{slug}/m/{qr}; domínio do
 *    restaurante serve "/" (consulta) e /m/{qr} (mesa). A URL antiga segue valendo.
 * 2. Superfícies: o projeto público não expõe o painel; o painel manda o
 *    cardápio para o projeto público.
 * 3. Renova a sessão da equipe a cada requisição para /app.
 */
type HostInfo = { kind: "restaurant"; slug: string; restaurant_id: string; status: string } | { kind: "reseller"; reseller_id: string } | null;
const hostCache = new Map<string, { at: number; info: HostInfo }>();
const HOST_TTL = 60_000;

async function resolveHost(host: string): Promise<HostInfo> {
  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < HOST_TTL) return cached.info;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !url) return null;
  let info: HostInfo = null;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/resolve_host`, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_host: host }),
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) info = (await response.json()) ?? null;
  } catch {
    info = null;
  }
  hostCache.set(host, { at: Date.now(), info });
  return info;
}

function ownHost(host: string) {
  const own = [process.env.NEXT_PUBLIC_MENU_URL, process.env.NEXT_PUBLIC_ADMIN_URL, process.env.NEXT_PUBLIC_APP_URL]
    .filter((u): u is string => !!u)
    .map((u) => { try { return new URL(u).host; } catch { return ""; } });
  return !host || host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.endsWith(".vercel.app") || own.includes(host);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const mode = process.env.APP_SURFACE;
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  if (mode !== "admin" && !ownHost(host) && !path.startsWith("/_next") && !path.startsWith("/api/")) {
    const info = await resolveHost(host);
    if (info?.kind === "restaurant") {
      if (info.status !== "active") return new NextResponse(null, { status: 404 });
      const slugPath = `/${info.slug}`;
      if (path === "/" || path === slugPath || path === `${slugPath}/consulta`)
        return NextResponse.rewrite(new URL(`${slugPath}/consulta`, request.url));
      const own = path.match(/^\/m\/([a-f0-9]{32})$/);
      if (own) return NextResponse.rewrite(new URL(`${slugPath}/m/${own[1]}`, request.url));
      if (path.startsWith(`${slugPath}/m/`)) return NextResponse.next();
      return new NextResponse(null, { status: 404 });
    }
    if (info?.kind === "reseller") {
      if (/^\/[a-z0-9-]+\/(m\/[a-f0-9]{32}|consulta)$/.test(path)) return NextResponse.next();
      return new NextResponse(null, { status: 404 });
    }
    // Host desconhecido: segue o fluxo normal (ex.: pré-visualizações).
  }
  if (mode === "customer" && path.startsWith("/app")) {
    return NextResponse.redirect(new URL(path + request.nextUrl.search, process.env.NEXT_PUBLIC_ADMIN_URL!));
  }
  if (mode === "customer" && /^\/api\/(auth|manage|staff|team|revenda|upload|qr|history|reports|domains)(\/|$)/.test(path)) return new NextResponse(null, {status:404});
  if (mode === "admin" && /^\/[^/]+\/(m\/[^/]+|consulta)$/.test(path)) return NextResponse.redirect(new URL(path + request.nextUrl.search, process.env.NEXT_PUBLIC_MENU_URL!));
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
  matcher: ["/", "/app/:path*", "/api/:path*", "/m/:qrToken", "/:slug", "/:slug/m/:qrToken", "/:slug/consulta"],
};
