import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function managerAccess(restaurantId: string) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: restaurant } = await db
    .from("restaurants")
    .select("*,resellers(brand_name,primary_color,logo_url)")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return null;
  const [member, reseller] = await Promise.all([
    db
      .from("restaurant_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .eq("role", "manager")
      .maybeSingle(),
    db
      .from("reseller_members")
      .select("reseller_id")
      .eq("user_id", user.id)
      .eq("reseller_id", restaurant.reseller_id)
      .maybeSingle(),
  ]);
  return member.data || reseller.data
    ? { db, user, restaurant, isReseller: !!reseller.data }
    : null;
}

export async function resellerAccess(id?: string) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  let query = db
    .from("reseller_members")
    .select("reseller_id,resellers(*)")
    .eq("user_id", user.id);
  if (id) query = query.eq("reseller_id", id);
  const { data } = await query.limit(1).maybeSingle();
  return data
    ? { db, user, reseller: data.resellers, resellerId: data.reseller_id }
    : null;
}

export async function readAll<T>(
  query: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export function saoPauloDayStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}T00:00:00-03:00`;
}
