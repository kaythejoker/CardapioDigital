import { z } from "zod";
import { managerAccess, readAll, saoPauloDayStart } from "@/lib/manage-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { menuOrigin } from "@/lib/menu-origin";
import { domainsConfigured } from "@/lib/vercel-domains";
import {
  financeSettingsSchema,
  itemSchema,
  memberSchema,
  restaurantSchema,
  settingsSchema,
  stationSchema,
  stockSchema,
  surveySettingsSchema,
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
    const teamAllowed = ctx.isManager || ctx.isReseller;
    const [categories, items, tables, settings, members, tabs, orders, tabTables, movements, finance] =
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
        teamAllowed
          ? ctx.db
              .from("restaurant_members")
              .select("user_id,roles,permissions,active,created_at")
              .eq("restaurant_id", id)
              .order("created_at")
          : Promise.resolve({ data: [], error: null }),
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
        ctx.db
          .from("tab_tables")
          .select("tab_id,table_id")
          .eq("restaurant_id", id)
          .is("released_at", null),
        ctx.can.manage_stock
          ? ctx.db
              .from("stock_movements")
              .select("id,menu_item_id,kind,quantity,balance_after,note,created_by,created_at")
              .eq("restaurant_id", id)
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [], error: null }),
        ctx.can.view_finance ? loadFinance(ctx.db, id) : Promise.resolve({ data: null, error: null }),
      ]);
    if (
      [categories, items, tables, settings, members, tabs, tabTables, movements, finance].some(
        (r) => r.error,
      )
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
        me: {
          user_id: ctx.user.id,
          is_manager: ctx.isManager,
          is_reseller: ctx.isReseller,
          can: ctx.can,
        },
        access: ctx.access,
        menu_origin: menuOrigin(ctx.restaurant),
        domains_configured: domainsConfigured(),
        categories: categories.data,
        items: items.data,
        tables: tables.data,
        settings: settings.data,
        team,
        tabs: tabs.data,
        tab_tables: tabTables.data,
        orders,
        stock_movements: movements.data,
        finance: finance.data,
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

/** Financeiro de hoje: comandas fechadas, pagamentos por forma e fechamentos recentes. */
async function loadFinance(db: Awaited<ReturnType<typeof managerAccess>> extends infer T ? (T extends { db: infer D } ? D : never) : never, id: string) {
  const dayStart = saoPauloDayStart();
  const [closedTabs, payments, closures, tables, openTabs] = await Promise.all([
    db
      .from("tabs")
      .select("id,table_id,opened_at,closed_at,closed_by,service_fee_percent,service_fee_waived,discount_cents,discount_reason")
      .eq("restaurant_id", id)
      .eq("status", "closed")
      .is("merged_into", null)
      .gte("closed_at", dayStart)
      .order("closed_at", { ascending: false }),
    db
      .from("payments")
      .select("id,tab_id,guest_id,method,amount_cents,created_at,voided_at")
      .eq("restaurant_id", id)
      .gte("created_at", dayStart)
      .order("created_at", { ascending: false }),
    db
      .from("cash_closures")
      .select("id,day,closed_at,closed_by,totals,note")
      .eq("restaurant_id", id)
      .order("day", { ascending: false })
      .limit(30),
    db.from("tables").select("id,label").eq("restaurant_id", id),
    db.from("tabs").select("id", { count: "exact", head: true }).eq("restaurant_id", id).eq("status", "open"),
  ]);
  const failed = [closedTabs, payments, closures, tables].find((r) => r.error);
  if (failed) return { data: null, error: failed.error };
  const totals = await Promise.all(
    (closedTabs.data ?? []).map(async (t) => {
      const { data } = await db.rpc("tab_totals", { p_tab: t.id });
      return { ...t, label: tables.data?.find((x) => x.id === t.table_id)?.label ?? "—", totals: data };
    }),
  );
  return {
    data: {
      day_start: dayStart,
      closed_tabs: totals,
      payments: payments.data,
      closures: closures.data,
      open_tabs: openTabs.count ?? 0,
    },
    error: null,
  };
}

const commands = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("category"),
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    active: z.boolean(),
    position: z.number().int().min(0),
    station: stationSchema.default("cozinha"),
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
  z.object({ action: z.literal("member"), data: memberSchema }),
  z.object({ action: z.literal("stock"), data: stockSchema }),
  z.object({ action: z.literal("finance_settings"), data: financeSettingsSchema }),
  z.object({ action: z.literal("survey_settings"), data: surveySettingsSchema }),
  z.object({
    action: z.literal("close_day"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().trim().max(500).optional(),
  }),
]);
const MENU_ACTIONS = new Set(["category", "item", "toggle_item", "reorder"]);
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
  // Assinatura suspensa: painel só leitura. Módulo fora do plano: 403.
  if (ctx.access.blocked && !ctx.isReseller)
    return Response.json(
      { error: "Assinatura suspensa: o painel está em modo leitura. Fale com a revenda" },
      { status: 403 },
    );
  const feature =
    cmd.action === "stock"
      ? "stock"
      : cmd.action === "finance_settings" || cmd.action === "close_day"
        ? "finance"
        : cmd.action === "survey_settings"
          ? "surveys"
          : null;
  if (feature && !ctx.access.features[feature])
    return Response.json({ error: "Função não incluída no seu plano" }, { status: 403 });
  // Quem não é gestor só chega aqui com permissão de gestão; cardápio exige
  // edit_menu e o resto é exclusivo do gestor ou da revenda.
  const allowed = MENU_ACTIONS.has(cmd.action)
    ? ctx.can.edit_menu
    : cmd.action === "stock"
      ? ctx.can.manage_stock
      : cmd.action === "close_day"
        ? ctx.can.view_finance
        : ctx.isManager || ctx.isReseller;
  if (!allowed)
    return Response.json(
      { error: "Você não tem permissão para esta ação" },
      { status: 403 },
    );
  let result;
  if (cmd.action === "category") {
    const values = {
      name: cmd.name,
      active: cmd.active,
      position: cmd.position,
      station: cmd.station,
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
  else if (cmd.action === "finance_settings" || cmd.action === "survey_settings")
    result = await ctx.db
      .from("restaurants")
      .update(cmd.data)
      .eq("id", id.data)
      .select("id")
      .single();
  else if (cmd.action === "close_day") {
    const day = cmd.day ?? saoPauloDayStart().slice(0, 10);
    const rpc = await ctx.db.rpc("close_day", { p_restaurant: id.data, p_day: day, p_note: cmd.note || null });
    result = { error: rpc.error, data: rpc.error ? null : rpc.data };
  } else if (cmd.action === "stock") {
    const { data: item } = await ctx.db
      .from("menu_items")
      .select("id")
      .eq("id", cmd.data.item_id)
      .eq("restaurant_id", id.data)
      .maybeSingle();
    if (!item)
      return Response.json({ error: "Item indisponível" }, { status: 404 });
    const rpc = await ctx.db.rpc("adjust_stock", {
      p_item: cmd.data.item_id,
      p_kind: cmd.data.kind,
      p_quantity: cmd.data.quantity,
      p_note: cmd.data.note || null,
    });
    result = { error: rpc.error, data: { balance: rpc.data } };
  } else {
    const userId = cmd.action === "member" ? cmd.data.user_id : cmd.user_id;
    if (userId === ctx.user.id)
      return Response.json(
        { error: "Você não pode alterar seu próprio acesso" },
        { status: 409 },
      );
    const { data: member } = await ctx.db
      .from("restaurant_members")
      .select("roles")
      .eq("user_id", userId)
      .eq("restaurant_id", id.data)
      .maybeSingle();
    if (!member)
      return Response.json({ error: "Pessoa não encontrada" }, { status: 404 });
    const touchesManager =
      member.roles.includes("manager") ||
      (cmd.action === "member" && cmd.data.roles.includes("manager"));
    if (touchesManager && !ctx.isReseller)
      return Response.json(
        { error: "Apenas a revenda altera o acesso de gestores" },
        { status: 403 },
      );
    result =
      cmd.action === "member"
        ? await ctx.db
            .from("restaurant_members")
            .update({
              roles: cmd.data.roles,
              permissions: cmd.data.permissions,
              active: cmd.data.active,
            })
            .eq("restaurant_id", id.data)
            .eq("user_id", userId)
            .select("user_id")
            .maybeSingle()
        : await ctx.db
            .from("restaurant_members")
            .delete()
            .eq("restaurant_id", id.data)
            .eq("user_id", userId)
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
