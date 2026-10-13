import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
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

export async function customerTable(slug: string, qr: string) {
  const db = createAdminClient();
  const { data: restaurant, error } = await db
    .from("restaurants")
    .select(
      "id,name,slug,logo_url,cover_url,primary_color,background_color,resellers(brand_name,logo_url,primary_color)",
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
    .select("tab_id")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;
  const { data: tab } = await context.db
    .from("tabs")
    .select("id,status")
    .eq("id", session.tab_id)
    .eq("table_id", context.table.id)
    .eq("status", "open")
    .maybeSingle();
  return tab ? { ...context, tab, tokenHash: hashToken(token) } : null;
}
