import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  canOpenManagerPanel,
  effectivePermissions,
  ALL_PERMISSIONS,
  type EffectivePermissions,
} from "@/lib/permissions";
import { ALL_FEATURES, type Access } from "@/lib/features";

/**
 * Acesso ao painel do gestor: gestor do restaurante, revendedor dono dele ou
 * membro com alguma permissão de gestão (cardápio, estoque, relatórios,
 * financeiro). `can` traz as permissões efetivas para as rotas conferirem.
 */
export async function managerAccess(restaurantId: string) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: restaurant } = await db
    .from("restaurants")
    .select("*,resellers(brand_name,primary_color,logo_url,support_whatsapp,support_email,support_hours,domain,domain_status)")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return null;
  const [member, reseller, accessRpc] = await Promise.all([
    db
      .from("restaurant_members")
      .select("roles,permissions,active")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .eq("active", true)
      .maybeSingle(),
    db
      .from("reseller_members")
      .select("reseller_id")
      .eq("user_id", user.id)
      .eq("reseller_id", restaurant.reseller_id)
      .maybeSingle(),
    db.rpc("restaurant_access", { p_restaurant: restaurantId }),
  ]);
  const roles: string[] = member.data?.roles ?? [];
  const isReseller = !!reseller.data;
  const isManager = roles.includes("manager");
  if (!isReseller && !canOpenManagerPanel(roles, member.data?.permissions))
    return null;
  const can: EffectivePermissions =
    isReseller || isManager
      ? ALL_PERMISSIONS
      : effectivePermissions(roles, member.data?.permissions);
  const access: Access = accessRpc.data ?? {
    status: "ativa",
    blocked: false,
    plan: null,
    features: ALL_FEATURES,
    period_end: null,
    trial_ends_at: null,
    max_tables: null,
  };
  return { db, user, restaurant, isReseller, isManager, roles, can, access };
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
