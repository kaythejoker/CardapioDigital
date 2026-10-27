import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const sessionCookie = (qr: string) => `comanda_${qr}`;
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 8 * 60 * 60,
};

/**
 * Identificação do celular (cookie + IP), a mesma usada pelo bloqueio de PIN.
 * Com `create`, grava o cookie quando ainda não existe (só em route handlers).
 */
export async function deviceId(create = false) {
  const jar = await cookies();
  let device = jar.get("comanda_device")?.value;
  const valid = !!device && /^[0-9a-f-]{36}$/.test(device);
  if (!valid) {
    if (!create) return null;
    device = randomUUID();
    jar.set("comanda_device", device, { ...cookieOptions, maxAge: 365 * 86400 });
  }
  // A Vercel fornece este cabeçalho. Nunca aceitar IP do corpo da requisição.
  const ip =
    (await headers()).get("x-vercel-forwarded-for")?.split(",")[0] || "local";
  return hashToken(`${device}:${ip}`);
}

export async function customerTable(slug: string, qr: string) {
  const db = createAdminClient();
  const { data: restaurant, error } = await db
    .from("restaurants")
    .select(
      "id,name,slug,logo_url,cover_url,primary_color,background_color,custom_domain,custom_domain_status,orders_paused,orders_paused_reason,pin_required,resellers(brand_name,logo_url,primary_color,domain,domain_status)",
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!restaurant) return null;
  const { data: table, error: tableError } = await db
    .from("tables")
    .select("id,label,qr_token")
    .eq("restaurant_id", restaurant.id)
    .eq("qr_token", qr)
    .eq("active", true)
    .maybeSingle();
  if (tableError) throw tableError;
  if (!table) return null;
  return { db, restaurant, table };
}

export async function customerSession(
  slug: string,
  qr: string,
  existing?: Awaited<ReturnType<typeof customerTable>>,
) {
  const context = existing ?? (await customerTable(slug, qr));
  if (!context) return null;
  const token = (await cookies()).get(sessionCookie(qr))?.value;
  if (!token) return null;
  const { data: session, error } = await context.db
    .from("tab_sessions")
    .select("tab_id,guest_id")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;
  // A comanda da sessão precisa ser a comanda aberta desta mesa (principal ou unida).
  const { data: openTab } = await context.db.rpc("tab_for_table", {
    p_table: context.table.id,
  });
  if (!openTab || openTab !== session.tab_id) return null;
  const tab = { id: session.tab_id as string, status: "open" };
  // Sessões anteriores à divisão por pessoa não têm nome: o cliente entra de novo.
  return session.guest_id
    ? { ...context, tab, guestId: session.guest_id, tokenHash: hashToken(token) }
    : null;
}
