import { z } from "zod";
import { managerAccess, readAll, saoPauloDayStart } from "@/lib/manage-access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  itemSchema,
  restaurantSchema,
  settingsSchema,
} from "@/lib/manage-schema";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/manage/[restaurantId]">,
) {
  const parsed = z.uuid().safeParse((await context.params).restaurantId);
  if (!parsed.success)
    return Response.json({ error: "Restaurante inválido" }, { status: 400 });
  const ctx = await managerAccess(parsed.data);
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  try {
    const id = parsed.data;
    const [categories, items, tables, settings, members, tabs, orders] =
      await Promise.all([
        ctx.db
          .from("categories")
          .select("*")
          .eq("restaurant_id", id)
          .order("position"),
        ctx.db
          .from("menu_items")
          .select("*,modifier_groups(*,modifiers(*))")
          .eq("restaurant_id", id)
          .order("position"),
        ctx.db
          .from("tables")
          .select("*")
          .eq("restaurant_id", id)
          .order("label"),
        ctx.db
          .from("kitchen_settings")
          .select("*")
          .eq("restaurant_id", id)
          .single(),
        ctx.db
          .from("restaurant_members")
          .select("user_id,role,created_at")
          .eq("restaurant_id", id),
        ctx.db
          .from("tabs")
          .select("id,table_id,pin,opened_at")
          .eq("restaurant_id", id)
          .eq("status", "open"),
        readAll((start, end) =>
          ctx.db
            .from("orders")
            .select("*,order_items(*)")
            .eq("restaurant_id", id)
            .gte("created_at", saoPauloDayStart())
            .order("created_at")
            .range(start, end),
        ),
      ]);
    if (
      [categories, items, tables, settings, members, tabs].some((r) => r.error)
    )
      throw new Error("Consulta indisponível");
    const admin = createAdminClient();
    const team = await Promise.all(
      (members.data ?? []).map(async (m) => {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        return {
          ...m,
          email: data.user?.email ?? "",
          name: data.user?.user_metadata?.name ?? "",
        };
      }),
    );
    return Response.json(
      {
        restaurant: ctx.restaurant,
        categories: categories.data,
        items: items.data,
        tables: tables.data,
        settings: settings.data,
        team,
        tabs: tabs.data,
        orders,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Não foi possível carregar o painel" },
      { status: 503 },
    );
  }
}

const commands = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("category"),
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    active: z.boolean(),
    position: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("item"),
    id: z.uuid().optional(),
    data: itemSchema,
  }),
  z.object({
    action: z.literal("toggle_item"),
    id: z.uuid(),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("reorder"),
    kind: z.enum(["categories", "menu_items"]),
    ids: z.array(z.uuid()).min(1).max(1000),
  }),
  z.object({
    action: z.literal("table"),
    id: z.uuid().optional(),
    label: z.string().trim().min(1).max(40),
    active: z.boolean(),
  }),
  z.object({ action: z.literal("settings"), data: settingsSchema }),
  z.object({ action: z.literal("restaurant"), data: restaurantSchema }),
  z.object({ action: z.literal("remove_member"), user_id: z.uuid() }),
]);
export async function POST(
  request: Request,
  context: RouteContext<"/api/manage/[restaurantId]">,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const id = z.uuid().safeParse((await context.params).restaurantId);
  const input = commands.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return Response.json(
      {
        error: input.success
          ? "Restaurante inválido"
          : input.error.issues[0].message,
      },
      { status: 400 },
    );
  const ctx = await managerAccess(id.data);
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  const cmd = input.data;
  let result;
  if (cmd.action === "category") {
    const values = {
      name: cmd.name,
      active: cmd.active,
      position: cmd.position,
    };
    result = cmd.id
      ? await ctx.db
          .from("categories")
          .update(values)
          .eq("id", cmd.id)
          .eq("restaurant_id", id.data)
          .select("id")
          .maybeSingle()
      : await ctx.db
          .from("categories")
          .insert({ ...values, restaurant_id: id.data })
          .select("id")
          .single();
  } else if (cmd.action === "item")
    result = await ctx.db.rpc("save_menu_item", {
      p_restaurant: id.data,
      p_item: cmd.id ?? null,
      p_data: cmd.data,
    });
  else if (cmd.action === "toggle_item")
    result = await ctx.db
      .from("menu_items")
      .update({ active: cmd.active })
      .eq("id", cmd.id)
      .eq("restaurant_id", id.data)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "reorder")
    result = await ctx.db.rpc("reorder_menu", {
      p_restaurant: id.data,
      p_kind: cmd.kind,
      p_ids: cmd.ids,
    });
  else if (cmd.action === "table") {
    if (cmd.id && !cmd.active) {
      const { count } = await ctx.db
        .from("tabs")
        .select("id", { count: "exact", head: true })
        .eq("table_id", cmd.id)
        .eq("status", "open");
      if (count)
        return Response.json(
          { error: "Feche a comanda antes de desativar a mesa" },
          { status: 409 },
        );
    }
    const values = { label: cmd.label, active: cmd.active };
    result = cmd.id
      ? await ctx.db
          .from("tables")
          .update(values)
          .eq("id", cmd.id)
          .eq("restaurant_id", id.data)
          .select("id")
          .maybeSingle()
      : await ctx.db
          .from("tables")
          .insert({ ...values, restaurant_id: id.data })
          .select("id")
          .single();
  } else if (cmd.action === "settings")
    result = await ctx.db
      .from("kitchen_settings")
      .update(cmd.data)
      .eq("restaurant_id", id.data)
      .select("restaurant_id")
      .single();
  else if (cmd.action === "restaurant")
    result = await ctx.db
      .from("restaurants")
      .update(cmd.data)
      .eq("id", id.data)
      .select("id")
      .single();
  else {
    if (cmd.user_id === ctx.user.id)
      return Response.json(
        { error: "Você não pode remover seu próprio acesso" },
        { status: 409 },
      );
    const { data: member } = await ctx.db
      .from("restaurant_members")
      .select("role")
      .eq("user_id", cmd.user_id)
      .eq("restaurant_id", id.data)
      .maybeSingle();
    if (member?.role === "manager" && !ctx.isReseller)
      return Response.json(
        { error: "Apenas a revenda remove gestores" },
        { status: 403 },
      );
    result = await ctx.db
      .from("restaurant_members")
      .delete()
      .eq("restaurant_id", id.data)
      .eq("user_id", cmd.user_id)
      .select("user_id")
      .maybeSingle();
  }
  if (result.error || (cmd.action !== "reorder" && !result.data))
    return Response.json(
      { error: result.error?.message || "Registro indisponível" },
      { status: 409 },
    );
  return Response.json({ ok: true, data: result.data });
}
