import "server-only";
import { cookies } from "next/headers";
import { customerSession, customerTable, deviceId, hashToken, sessionCookie } from "@/lib/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableUrl } from "@/lib/menu-origin";
import { type MenuData } from "@/lib/menu-types";

/** Cardápio sem mesa (domínio próprio do restaurante): só consulta, sem pedir. */
export async function loadMenuConsult(slug: string): Promise<MenuData | null> {
  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants")
    .select("id,name,slug,logo_url,cover_url,primary_color,background_color,resellers(brand_name,logo_url,primary_color)")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (!restaurant) return null;
  const base = {
    restaurant: {
      name: restaurant.name,
      logo_url: restaurant.logo_url,
      cover_url: restaurant.cover_url,
      primary_color: restaurant.primary_color,
      background_color: restaurant.background_color,
      resellers: restaurant.resellers as unknown as MenuData["restaurant"]["resellers"],
    },
    table: null,
    open: false,
    authorized: false,
    calls: [],
    survey: null,
    consult: true,
  };
  const { data: access } = await db.rpc("restaurant_access", { p_restaurant: restaurant.id });
  if (access?.blocked) return { ...base, categories: [], items: [], suspended: true };
  const [categories, items] = await Promise.all([
    db.from("categories").select("id,name,position").eq("restaurant_id", restaurant.id).eq("active", true).order("position"),
    db
      .from("menu_items")
      .select("id,category_id,name,description,price_cents,photo_url,prep_minutes,featured,position,modifier_groups(id,name,required,min_select,max_select,position,modifiers(id,name,price_cents,position))")
      .eq("restaurant_id", restaurant.id)
      .eq("active", true)
      .eq("sold_out", false)
      .order("position"),
  ]);
  if (categories.error || items.error) throw new Error("Não foi possível carregar o cardápio");
  const allowed = new Set(categories.data?.map((c) => c.id));
  return { ...base, categories: categories.data ?? [], items: (items.data ?? []).filter((i) => allowed.has(i.category_id)) };
}

export async function loadMenu(
  slug: string,
  qrToken: string,
): Promise<MenuData | null> {
  const ctx = await customerTable(slug, qrToken);
  if (!ctx) return null;
  const token = (await cookies()).get(sessionCookie(qrToken))?.value;
  // Assinatura suspensa: o cardápio mostra o aviso e não lista itens nem aceita pedidos.
  const { data: access } = await ctx.db.rpc("restaurant_access", { p_restaurant: ctx.restaurant.id });
  if (access?.blocked)
    return {
      restaurant: {
        name: ctx.restaurant.name,
        logo_url: ctx.restaurant.logo_url,
        cover_url: ctx.restaurant.cover_url,
        primary_color: ctx.restaurant.primary_color,
        background_color: ctx.restaurant.background_color,
        resellers: ctx.restaurant.resellers as unknown as MenuData["restaurant"]["resellers"],
      },
      table: { label: ctx.table.label },
      categories: [],
      items: [],
      open: false,
      authorized: false,
      calls: [],
      survey: null,
      suspended: true,
    };
  const [categories, items, tab, session, calls, device, invite] = await Promise.all([
    ctx.db
      .from("categories")
      .select("id,name,position")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("active", true)
      .order("position"),
    ctx.db
      .from("menu_items")
      .select(
        "id,category_id,name,description,price_cents,photo_url,prep_minutes,featured,position,stock_enabled,stock_quantity,modifier_groups(id,name,required,min_select,max_select,position,modifiers(id,name,price_cents,position))",
      )
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("active", true)
      .eq("sold_out", false)
      .order("position"),
    ctx.db.rpc("tab_for_table", { p_table: ctx.table.id }),
    customerSession(slug, qrToken, ctx),
    ctx.db
      .from("service_calls")
      .select("id,kind,created_at,device_id,tab_id")
      .eq("table_id", ctx.table.id)
      .eq("status", "aberta")
      .order("created_at"),
    deviceId(),
    // Comanda recém-fechada: o celular ainda pode responder a pesquisa por 24 h.
    token
      ? ctx.db.rpc("survey_invite", { p_slug: slug, p_qr: qrToken, p_hash: hashToken(token) })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (categories.error || items.error || tab.error || calls.error)
    throw new Error("Não foi possível carregar o cardápio");
  const allowed = new Set(categories.data?.map((c) => c.id));
  // Explicit serialization keeps PINs and server-only session details off the client.
  return {
    restaurant: {
      name: ctx.restaurant.name,
      logo_url: ctx.restaurant.logo_url,
      cover_url: ctx.restaurant.cover_url,
      primary_color: ctx.restaurant.primary_color,
      background_color: ctx.restaurant.background_color,
      resellers: ctx.restaurant
        .resellers as unknown as MenuData["restaurant"]["resellers"],
    },
    table: { label: ctx.table.label },
    categories: categories.data ?? [],
    items: (items.data ?? [])
      .filter((i) => allowed.has(i.category_id))
      .map(({ stock_enabled, stock_quantity, ...item }) => ({
        ...item,
        stock_left: stock_enabled ? stock_quantity : null,
      })),
    open: !!tab.data,
    authorized: !!session,
    menu_url: tableUrl(ctx.restaurant, qrToken),
    survey:
      !session && invite.data && !invite.data.answered
        ? { guest_name: invite.data.guest_name as string, tab_id: invite.data.tab_id as string }
        : null,
    // Chamadas abertas da mesa; "mine" = este celular ou esta comanda.
    calls: (calls.data ?? []).map((c) => ({
      id: c.id,
      kind: c.kind as "garcom" | "conta" | "ajuda",
      created_at: c.created_at,
      mine:
        (!!device && c.device_id === device) ||
        (!!session && c.tab_id === session.tab.id),
    })),
  };
}
