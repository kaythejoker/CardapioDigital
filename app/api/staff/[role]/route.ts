import { randomInt } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/manage-access";

const roles = z.enum(["garcom", "cozinha", "gestor"]);
async function access(role: string, restaurantId: string | null) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const allowed =
    role === "garcom"
      ? ["waiter", "manager"]
      : role === "cozinha"
        ? ["kitchen", "manager"]
        : ["manager"];
  const { data: memberships } = await db
    .from("restaurant_members")
    .select(
      "restaurant_id,role,restaurants(id,name,slug,primary_color,resellers(brand_name,primary_color,logo_url))",
    )
    .eq("user_id", user.id)
    .in("role", allowed);
  const member = restaurantId
    ? memberships?.find((m) => m.restaurant_id === restaurantId)
    : memberships?.[0];
  return member ? { db, user, member, memberships } : null;
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
  const results = await Promise.all([
    ctx.db
      .from("tables")
      .select("id,label,qr_token,active")
      .eq("restaurant_id", id)
      .order("label"),
    ctx.db
      .from("tabs")
      .select("id,table_id,pin,opened_at,status")
      .eq("restaurant_id", id)
      .eq("status", "open"),
    readAll((start, end) =>
      ctx.db
        .from("orders")
        .select(
          "id,tab_id,guest_id,status,prep_minutes,total_cents,pinned,created_at,started_at,ready_at,delivered_at,tabs!inner(status),order_items(id,name_snapshot,quantity,note,unit_price_cents,modifiers_snapshot,shared)",
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
        "id,name,sold_out,active,price_cents,category_id,photo_url,prep_minutes,description,position,featured,modifier_groups(*,modifiers(*))",
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
  ]);
  const guests = results[1].data?.length
    ? await ctx.db
        .from("tab_guests")
        .select("id,tab_id,name,created_at,paid_cents")
        .in(
          "tab_id",
          results[1].data.map((t) => t.id),
        )
        .order("created_at")
    : { data: [], error: null };
  if (results.some((r) => r.error) || guests.error)
    return Response.json(
      { error: "Não foi possível carregar a operação" },
      { status: 503 },
    );
  return Response.json(
    {
      restaurant: ctx.member.restaurants,
      staff_name: typeof ctx.user.user_metadata?.name === "string" ? ctx.user.user_metadata.name : "Equipe",
      memberships: ctx.memberships,
      restaurant_id: id,
      tables: results[0].data,
      tabs: results[1].data,
      guests: guests.data,
      orders: results[2].data,
      items: results[3].data,
      settings: results[4].data,
      categories: results[5].data,
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
  }),
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
    action: z.literal("paid"),
    guest_id: z.uuid(),
    paid_cents: z.number().int().min(0).max(100_000_000).nullable(),
  }),
]);
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
      .update({ status: cmd.status })
      .eq("id", cmd.order_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "pin")
    result = await ctx.db
      .from("orders")
      .update({ pinned: cmd.pinned })
      .eq("id", cmd.order_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "paid")
    result = await ctx.db
      .from("tab_guests")
      .update({ paid_cents: cmd.paid_cents })
      .eq("id", cmd.guest_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  else
    result = await ctx.db
      .from("menu_items")
      .update({ sold_out: cmd.sold_out })
      .eq("id", cmd.item_id)
      .eq("restaurant_id", restaurant.data)
      .select("id")
      .maybeSingle();
  if (!result || result.error || !result.data)
    return Response.json(
      { error: result?.error?.message || "Operação não permitida" },
      { status: 409 },
    );
  return Response.json({ ok: true, data: result.data });
}
