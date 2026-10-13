import "server-only";
import { customerSession, customerTable } from "@/lib/customer";
import { type MenuData } from "@/lib/menu-types";

export async function loadMenu(
  slug: string,
  qrToken: string,
): Promise<MenuData | null> {
  const ctx = await customerTable(slug, qrToken);
  if (!ctx) return null;
  const [categories, items, tab, session] = await Promise.all([
    ctx.db
      .from("categories")
      .select("id,name,position")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("active", true)
      .order("position"),
    ctx.db
      .from("menu_items")
      .select(
        "id,category_id,name,description,price_cents,photo_url,prep_minutes,featured,position,modifier_groups(id,name,required,min_select,max_select,position,modifiers(id,name,price_cents,position))",
      )
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("active", true)
      .eq("sold_out", false)
      .order("position"),
    ctx.db
      .from("tabs")
      .select("id")
      .eq("table_id", ctx.table.id)
      .eq("status", "open")
      .maybeSingle(),
    customerSession(slug, qrToken, ctx),
  ]);
  if (categories.error || items.error || tab.error)
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
    items: (items.data ?? []).filter((i) => allowed.has(i.category_id)),
    open: !!tab.data,
    authorized: !!session,
  };
}
