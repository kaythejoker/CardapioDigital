import { randomInt } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readAll, saoPauloDayStart } from "@/lib/manage-access";
import { effectivePermissions } from "@/lib/permissions";
import { blockReason, paymentMethod, waitlistSchema } from "@/lib/manage-schema";

const roles = z.enum(["garcom", "cozinha", "bar", "gestor"]);
const PANEL_ROLES: Record<z.infer<typeof roles>, string[]> = {
  garcom: ["waiter", "manager"],
  cozinha: ["kitchen", "manager"],
  bar: ["bar", "manager"],
  gestor: ["manager"],
};
async function access(role: z.infer<typeof roles>, restaurantId: string | null) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await db
    .from("restaurant_members")
    .select(
      "restaurant_id,roles,permissions,restaurants(id,name,slug,primary_color,service_fee_percent,service_fee_optional,orders_paused,orders_paused_reason,resellers(brand_name,primary_color,logo_url,support_whatsapp,support_email,support_hours))",
    )
    .eq("user_id", user.id)
    .eq("active", true)
    .overlaps("roles", PANEL_ROLES[role]);
  const member = restaurantId
    ? memberships?.find((m) => m.restaurant_id === restaurantId)
    : memberships?.[0];
  return member
    ? {
        db,
        user,
        member,
        memberships,
        can: effectivePermissions(member.roles, member.permissions),
      }
    : null;
}
export async function GET(
  request: Request,
  context: RouteContext<"/api/staff/[role]">,
) {
  const role = roles.safeParse((await context.params).role);
  const restaurantId = new URL(request.url).searchParams.get("restaurant_id");
  if (
    !role.success ||
    (restaurantId && !z.uuid().safeParse(restaurantId).success)
  )
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const ctx = await access(role.data, restaurantId);
  if (!ctx)
    return Response.json(
      { error: "Faça login com um acesso autorizado" },
      { status: 401 },
    );
  const id = ctx.member.restaurant_id;
  // Chamadas sem atendimento em 30 minutos expiram ao carregar o painel.
  const [, accessInfo] = await Promise.all([
    ctx.db.rpc("expire_service_calls", { p_restaurant: id }),
    ctx.db.rpc("restaurant_access", { p_restaurant: id }),
  ]);
  const results = await Promise.all([
    ctx.db
      .from("tables")
      .select("id,label,qr_token,active")
      .eq("restaurant_id", id)
      .order("label"),
    ctx.db
      .from("tabs")
      .select("id,table_id,pin,opened_at,status,service_fee_percent,service_fee_waived,discount_cents,discount_reason,orders_blocked,orders_blocked_reason")
      .eq("restaurant_id", id)
      .eq("status", "open"),
    readAll((start, end) =>
      ctx.db
        .from("orders")
        .select(
          "id,tab_id,guest_id,status,prep_minutes,total_cents,pinned,created_at,started_at,ready_at,delivered_at,cancel_reason,station,batch_id,tabs!inner(status),order_items(id,name_snapshot,quantity,note,unit_price_cents,modifiers_snapshot,shared,cancelled_at,cancel_reason)",
        )
        .eq("restaurant_id", id)
        .eq("tabs.status", "open")
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, end),
    )
      .then((data) => ({ data, error: null }))
      .catch(() => ({
        data: null,
        error: { message: "Falha ao carregar pedidos" },
      })),
    ctx.db
      .from("menu_items")
      .select(
        "id,name,sold_out,sold_out_auto,active,price_cents,category_id,photo_url,prep_minutes,description,position,featured,stock_enabled,stock_quantity,low_stock_threshold,station,modifier_groups(*,modifiers(*))",
      )
      .eq("restaurant_id", id)
      .order("position"),
    ctx.db
      .from("kitchen_settings")
      .select("*")
      .eq("restaurant_id", id)
      .single(),
    ctx.db
      .from("categories")
      .select("*")
      .eq("restaurant_id", id)
      .order("position"),
    ctx.db
      .from("service_calls")
      .select("id,table_id,tab_id,guest_id,kind,note,created_at")
      .eq("restaurant_id", id)
      .eq("status", "aberta")
      .order("created_at"),
    ctx.db
      .from("tab_tables")
      .select("tab_id,table_id,added_at")
      .eq("restaurant_id", id)
      .is("released_at", null)
      .order("added_at"),
    // Lista de espera de hoje, para o salão (spec-fase3.md, seção 1).
    role.data === "garcom" && accessInfo.data?.features?.waitlist !== false
      ? ctx.db
          .from("waitlist_entries")
          .select("id,number,name,party_size,phone,note,status,public_token,table_id,created_at,called_at,seated_at,left_at")
          .eq("restaurant_id", id)
          .gte("created_at", saoPauloDayStart())
          .order("number")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const openTabIds = results[1].data?.map((t) => t.id) ?? [];
  const [guests, payments] = openTabIds.length
    ? await Promise.all([
        ctx.db
          .from("tab_guests")
          .select("id,tab_id,name,created_at,paid_cents")
          .in("tab_id", openTabIds)
          .order("created_at"),
        ctx.db
          .from("payments")
          .select("id,tab_id,guest_id,method,amount_cents,created_at")
          .in("tab_id", openTabIds)
          .is("voided_at", null)
          .order("created_at"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (results.some((r) => r.error) || guests.error || payments.error)
    return Response.json(
      { error: "Não foi possível carregar a operação" },
      { status: 503 },
    );
  return Response.json(
    {
      restaurant: ctx.member.restaurants,
      staff_name: typeof ctx.user.user_metadata?.name === "string" ? ctx.user.user_metadata.name : "Equipe",
      roles: ctx.member.roles,
      can: ctx.can,
      access: accessInfo.data,
      memberships: ctx.memberships,
      restaurant_id: id,
      tables: results[0].data,
      tabs: results[1].data,
      guests: guests.data,
      payments: payments.data,
      orders: results[2].data,
      items: results[3].data,
      settings: results[4].data,
      categories: results[5].data,
      calls: results[6].data,
      tab_tables: results[7].data,
      waitlist: results[8].data,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
const commands = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), table_id: z.uuid() }),
  z.object({ action: z.literal("rotate"), tab_id: z.uuid() }),
  z.object({ action: z.literal("close"), tab_id: z.uuid() }),
  z.object({
    action: z.literal("status"),
    order_id: z.uuid(),
    status: z.enum(["em_preparo", "pronto", "entregue", "cancelado"]),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    action: z.literal("cancel_item"),
    item_id: z.uuid(),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({ action: z.literal("attend_call"), call_id: z.uuid() }),
  z.object({ action: z.literal("merge"), tab_id: z.uuid(), table_id: z.uuid() }),
  z.object({ action: z.literal("split"), tab_id: z.uuid(), table_id: z.uuid() }),
  z.object({
    action: z.literal("pin"),
    order_id: z.uuid(),
    pinned: z.boolean(),
  }),
  z.object({
    action: z.literal("sold_out"),
    item_id: z.uuid(),
    sold_out: z.boolean(),
  }),
  z.object({
    action: z.literal("pay"),
    tab_id: z.uuid(),
    guest_id: z.uuid().nullable(),
    method: paymentMethod,
    amount_cents: z.number().int().min(1).max(100_000_000),
  }),
  z.object({
    action: z.literal("void_payment"),
    payment_id: z.uuid(),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    action: z.literal("discount"),
    tab_id: z.uuid(),
    cents: z.number().int().min(0).max(100_000_000),
    reason: z.string().trim().max(200),
  }),
  z.object({ action: z.literal("fee"), tab_id: z.uuid(), waived: z.boolean() }),
  // Fase 3: bloqueios e lista de espera.
  z.object({ action: z.literal("pause_orders"), paused: z.boolean(), reason: blockReason }),
  z.object({ action: z.literal("block_tab"), tab_id: z.uuid(), blocked: z.boolean(), reason: blockReason }),
  z.object({ action: z.literal("waitlist_add"), data: waitlistSchema }),
  z.object({
    action: z.literal("waitlist_status"),
    entry_id: z.uuid(),
    status: z.enum(["aguardando", "chamado", "desistiu"]),
  }),
  z.object({ action: z.literal("waitlist_seat"), entry_id: z.uuid(), table_id: z.uuid().nullable() }),
]);
const WAITLIST_ACTIONS = new Set(["waitlist_add", "waitlist_status", "waitlist_seat"]);
export async function POST(
  request: Request,
  context: RouteContext<"/api/staff/[role]">,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const role = roles.safeParse((await context.params).role);
  const raw = await request.json().catch(() => null);
  const input = commands.safeParse(raw);
  const restaurant = z.uuid().safeParse(raw?.restaurant_id);
  if (!role.success || !input.success || !restaurant.success)
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const ctx = await access(role.data, restaurant.data);
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  const cmd = input.data;
  const { data: restaurantAccess } = await ctx.db.rpc("restaurant_access", { p_restaurant: restaurant.data });
  if (restaurantAccess?.blocked)
    return Response.json(
      { error: "Assinatura suspensa: o painel está em modo leitura. Fale com a revenda" },
      { status: 403 },
    );
  if ((cmd.action === "discount" || cmd.action === "fee") && restaurantAccess && !restaurantAccess.features.finance)
    return Response.json({ error: "Função não incluída no seu plano" }, { status: 403 });
  const blocksAction = cmd.action === "pause_orders" || cmd.action === "block_tab";
  const waitlistAction = WAITLIST_ACTIONS.has(cmd.action);
  if (
    restaurantAccess &&
    ((blocksAction && !restaurantAccess.features.order_blocks) ||
      (waitlistAction && !restaurantAccess.features.waitlist))
  )
    return Response.json({ error: "Função não incluída no seu plano" }, { status: 403 });
  // A lista de espera é do salão; cozinha e bar não chegam nela.
  if (waitlistAction && role.data !== "garcom")
    return Response.json({ error: "Acesso negado" }, { status: 403 });
  // O banco também confere (triggers); aqui a mensagem fica mais clara.
  const needed =
    blocksAction
      ? "block_orders"
      : cmd.action === "close"
      ? "close_tab"
      : cmd.action === "pay" || cmd.action === "void_payment"
        ? "register_payment"
        : cmd.action === "discount"
          ? "apply_discount"
        : cmd.action === "cancel_item" ||
            (cmd.action === "status" && cmd.status === "cancelado")
          ? "cancel_items"
          : cmd.action === "merge" || cmd.action === "split"
            ? "merge_tables"
            : null;
  if (needed && !ctx.can[needed])
    return Response.json(
      { error: "Você não tem permissão para esta ação" },
      { status: 403 },
    );
  let result;
  if (cmd.action === "open") {
    const { data: table } = await ctx.db
      .from("tables")
      .select("id")
      .eq("id", cmd.table_id)
      .eq("restaurant_id", restaurant.data)
      .maybeSingle();
    if (!table)
      return Response.json({ error: "Mesa indisponível" }, { status: 404 });
    result = await ctx.db.rpc("open_table", { p_table: cmd.table_id });
  } else if (cmd.action === "rotate") {
    for (let i = 0; i < 30; i++) {
      result = await ctx.db
        .from("tabs")
        .update({ pin: randomInt(10000).toString().padStart(4, "0") })
        .eq("id", cmd.tab_id)
        .eq("restaurant_id", restaurant.data)
        .eq("status", "open")
        .select("id,pin")
        .maybeSingle();
      if (result.error?.code !== "23505") break;
    }
  } else if (cmd.action === "close")
    result = await ctx.db
      .from("tabs")
      .update({ status: "closed" })
      .eq("id", cmd.tab_id)
      .eq("restaurant_id", restaurant.data)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
  else if (cmd.action === "status")
    result = await ctx.db
      .from("orders")
      .update(
        cmd.status === "cancelado"
          ? { status: cmd.status, cancel_reason: cmd.reason || null }
          : { status: cmd.status },
      )
      .eq("id", cmd.order_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "merge" || cmd.action === "split") {
    const { data: tab } = await ctx.db
      .from("tabs")
      .select("id")
      .eq("id", cmd.tab_id)
      .eq("restaurant_id", restaurant.data)
      .eq("status", "open")
      .maybeSingle();
    if (!tab)
      return Response.json({ error: "Comanda indisponível" }, { status: 404 });
    const rpc = await ctx.db.rpc(cmd.action === "merge" ? "merge_table" : "split_table", {
      p_tab: cmd.tab_id,
      p_table: cmd.table_id,
    });
    result = { error: rpc.error, data: rpc.error ? null : { ok: true, result: rpc.data } };
  } else if (cmd.action === "attend_call")
    result = await ctx.db
      .from("service_calls")
      .update({ status: "atendida" })
      .eq("id", cmd.call_id)
      .eq("restaurant_id", restaurant.data)
      .eq("status", "aberta")
      .select("id")
      .maybeSingle();
  else if (cmd.action === "cancel_item") {
    const { data: line } = await ctx.db
      .from("order_items")
      .select("id,orders!inner(restaurant_id)")
      .eq("id", cmd.item_id)
      .eq("orders.restaurant_id", restaurant.data)
      .maybeSingle();
    if (!line)
      return Response.json({ error: "Item indisponível" }, { status: 404 });
    result = await ctx.db.rpc("cancel_order_item", {
      p_item: cmd.item_id,
      p_reason: cmd.reason || null,
    });
  }
  else if (cmd.action === "pin")
    result = await ctx.db
      .from("orders")
      .update({ pinned: cmd.pinned })
      .eq("id", cmd.order_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "pay" || cmd.action === "discount" || cmd.action === "fee") {
    const { data: tab } = await ctx.db
      .from("tabs")
      .select("id")
      .eq("id", cmd.tab_id)
      .eq("restaurant_id", restaurant.data)
      .eq("status", "open")
      .maybeSingle();
    if (!tab)
      return Response.json({ error: "Comanda indisponível" }, { status: 404 });
    const rpc =
      cmd.action === "pay"
        ? await ctx.db.rpc("register_payment", { p_tab: cmd.tab_id, p_guest: cmd.guest_id, p_method: cmd.method, p_amount: cmd.amount_cents })
        : cmd.action === "discount"
          ? await ctx.db.rpc("apply_discount", { p_tab: cmd.tab_id, p_cents: cmd.cents, p_reason: cmd.reason })
          : await ctx.db.rpc("set_service_fee", { p_tab: cmd.tab_id, p_waived: cmd.waived });
    result = { error: rpc.error, data: rpc.error ? null : { ok: true, result: rpc.data } };
  } else if (cmd.action === "void_payment") {
    const { data: payment } = await ctx.db
      .from("payments")
      .select("id")
      .eq("id", cmd.payment_id)
      .eq("restaurant_id", restaurant.data)
      .maybeSingle();
    if (!payment)
      return Response.json({ error: "Pagamento não encontrado" }, { status: 404 });
    const rpc = await ctx.db.rpc("void_payment", { p_payment: cmd.payment_id, p_reason: cmd.reason || null });
    result = { error: rpc.error, data: rpc.error ? null : { ok: true } };
  } else if (cmd.action === "pause_orders")
    result = await ctx.db.rpc("set_orders_paused", {
      p_restaurant: restaurant.data,
      p_paused: cmd.paused,
      p_reason: cmd.reason || null,
    });
  else if (cmd.action === "block_tab") {
    const { data: tab } = await ctx.db
      .from("tabs")
      .select("id")
      .eq("id", cmd.tab_id)
      .eq("restaurant_id", restaurant.data)
      .eq("status", "open")
      .maybeSingle();
    if (!tab)
      return Response.json({ error: "Comanda indisponível" }, { status: 404 });
    result = await ctx.db.rpc("set_tab_blocked", {
      p_tab: cmd.tab_id,
      p_blocked: cmd.blocked,
      p_reason: cmd.reason || null,
    });
  } else if (cmd.action === "waitlist_add")
    result = await ctx.db
      .rpc("add_waitlist_entry", {
        p_restaurant: restaurant.data,
        p_name: cmd.data.name,
        p_party: cmd.data.party_size,
        p_phone: cmd.data.phone || null,
        p_note: cmd.data.note || null,
      })
      .select("id,number,public_token")
      .single();
  else if (cmd.action === "waitlist_status")
    result = await ctx.db
      .from("waitlist_entries")
      .update({ status: cmd.status })
      .eq("id", cmd.entry_id)
      .eq("restaurant_id", restaurant.data)
      .select("id,status")
      .maybeSingle();
  else if (cmd.action === "waitlist_seat") {
    const { data: entry } = await ctx.db
      .from("waitlist_entries")
      .select("id")
      .eq("id", cmd.entry_id)
      .eq("restaurant_id", restaurant.data)
      .maybeSingle();
    if (!entry)
      return Response.json({ error: "Grupo não encontrado" }, { status: 404 });
    result = await ctx.db.rpc("seat_waitlist_entry", {
      p_entry: cmd.entry_id,
      p_table: cmd.table_id,
    });
  } else
    result = await ctx.db
      .from("menu_items")
      .update({ sold_out: cmd.sold_out })
      .eq("id", cmd.item_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  if (!result || result.error || !result.data)
    return Response.json(
      { error: friendlyError(result?.error?.message) },
      { status: 409 },
    );
  return Response.json({ ok: true, data: result.data });
}

/** Mensagens das RPCs chegam prontas; erros técnicos viram uma frase curta. */
function friendlyError(message?: string | null) {
  if (!message) return "Operação não permitida";
  if (/violates|constraint|syntax|does not exist/i.test(message)) return "Operação não permitida";
  return message;
}
