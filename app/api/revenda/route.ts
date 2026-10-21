import { z } from "zod";
import { resellerAccess } from "@/lib/manage-access";
import { imageUrl } from "@/lib/manage-schema";
import { FEATURES } from "@/lib/features";
import { domainsConfigured } from "@/lib/vercel-domains";

export async function GET() {
  const ctx = await resellerAccess();
  if (!ctx)
    return Response.json(
      { error: "Acesso da revenda necessário" },
      { status: 403 },
    );
  const [restaurants, plans, subscriptions, payments] = await Promise.all([
    ctx.db
      .from("restaurants")
      .select("*")
      .eq("reseller_id", ctx.resellerId)
      .order("created_at", { ascending: false }),
    ctx.db.from("plans").select("*").eq("reseller_id", ctx.resellerId).order("created_at"),
    ctx.db.from("subscriptions").select("*"),
    ctx.db
      .from("subscription_payments")
      .select("id,subscription_id,amount_cents,paid_at,period_start,period_end,method,note")
      .order("paid_at", { ascending: false })
      .limit(200),
  ]);
  if (restaurants.error || plans.error || subscriptions.error || payments.error)
    return Response.json(
      { error: "Não foi possível carregar restaurantes" },
      { status: 503 },
    );
  // Média de satisfação (30 dias) e acesso efetivo (status da assinatura) por restaurante.
  const extras = await Promise.all(
    (restaurants.data ?? []).map(async (r) => {
      const [rating, access] = await Promise.all([
        ctx.db.rpc("restaurant_rating", { p_restaurant: r.id }),
        ctx.db.rpc("restaurant_access", { p_restaurant: r.id }),
      ]);
      return [r.id, { rating: rating.data ?? { avg: null, responses: 0 }, access: access.data }] as const;
    }),
  );
  return Response.json(
    {
      reseller: ctx.reseller,
      restaurants: restaurants.data,
      plans: plans.data,
      subscriptions: subscriptions.data,
      subscription_payments: payments.data,
      ratings: Object.fromEntries(extras.map(([id, e]) => [id, e.rating])),
      access: Object.fromEntries(extras.map(([id, e]) => [id, e.access])),
      domains_configured: domainsConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
const featuresSchema = z
  .object(Object.fromEntries(FEATURES.map((f) => [f.key, z.boolean().optional()])) as Record<(typeof FEATURES)[number]["key"], z.ZodOptional<z.ZodBoolean>>)
  .strict();
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  }),
  z.object({
    action: z.literal("status"),
    id: z.uuid(),
    status: z.enum(["active", "inactive"]),
  }),
  z.object({
    action: z.literal("brand"),
    name: z.string().trim().min(1).max(100),
    brand_name: z.string().trim().min(1).max(100),
    logo_url: imageUrl,
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    domain: z
      .union([
        z.literal(""),
        z
          .string()
          .max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
        z.null(),
      ])
      .transform((v) => v || null),
    support_whatsapp: z
      .union([z.literal(""), z.string().regex(/^\+?[0-9]{8,15}$/), z.null()])
      .transform((v) => v || null)
      .optional(),
    support_email: z.union([z.literal(""), z.email().max(254), z.null()]).transform((v) => v || null).optional(),
    support_hours: z.string().trim().max(120).transform((v) => v || null).optional(),
  }),
  z.object({
    action: z.literal("plan"),
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    price_cents: z.number().int().min(0).max(100_000_000),
    billing_period: z.enum(["mensal", "anual"]),
    max_tables: z.number().int().min(1).max(10_000).nullable(),
    trial_days: z.number().int().min(0).max(365),
    features: featuresSchema,
    is_default: z.boolean(),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("subscription"),
    restaurant_id: z.uuid(),
    plan_id: z.uuid(),
    status: z.enum(["teste", "ativa", "suspensa", "cancelada"]),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("subscription_payment"),
    restaurant_id: z.uuid(),
    amount_cents: z.number().int().min(0).max(100_000_000),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(["pix", "boleto", "transferencia", "cartao", "outro"]),
    note: z.string().trim().max(200).optional(),
  }),
]);
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const input = command.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Confira os dados, o endereço e a cor da marca" },
      { status: 400 },
    );
  const ctx = await resellerAccess();
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  const cmd = input.data;
  let result: { error: { message: string; code?: string } | null; data: unknown };
  if (cmd.action === "create")
    result = await ctx.db
      .from("restaurants")
      .insert({ reseller_id: ctx.resellerId, name: cmd.name, slug: cmd.slug })
      .select("*")
      .single();
  else if (cmd.action === "status")
    result = await ctx.db
      .from("restaurants")
      .update({ status: cmd.status })
      .eq("id", cmd.id)
      .eq("reseller_id", ctx.resellerId)
      .select("id")
      .maybeSingle();
  else if (cmd.action === "brand") {
    const { action: _action, ...fields } = cmd;
    void _action;
    result = await ctx.db
      .from("resellers")
      .update(fields)
      .eq("id", ctx.resellerId)
      .select("id")
      .single();
  } else if (cmd.action === "plan") {
    const { action: _action, id, ...fields } = cmd;
    void _action;
    if (fields.is_default)
      // Só um plano padrão por revenda.
      await ctx.db.from("plans").update({ is_default: false }).eq("reseller_id", ctx.resellerId).neq("id", id ?? "00000000-0000-0000-0000-000000000000");
    result = id
      ? await ctx.db.from("plans").update(fields).eq("id", id).eq("reseller_id", ctx.resellerId).select("id").maybeSingle()
      : await ctx.db.from("plans").insert({ ...fields, reseller_id: ctx.resellerId }).select("id").single();
  } else if (cmd.action === "subscription") {
    const rpc = await ctx.db.rpc("set_subscription", {
      p_restaurant: cmd.restaurant_id,
      p_plan: cmd.plan_id,
      p_status: cmd.status,
      p_period_end: cmd.period_end ?? null,
      p_notes: cmd.notes ?? null,
    });
    result = { error: rpc.error, data: rpc.error ? null : rpc.data };
  } else {
    const rpc = await ctx.db.rpc("register_subscription_payment", {
      p_restaurant: cmd.restaurant_id,
      p_amount: cmd.amount_cents,
      p_period_start: cmd.period_start,
      p_period_end: cmd.period_end,
      p_method: cmd.method,
      p_note: cmd.note ?? null,
    });
    result = { error: rpc.error, data: rpc.error ? null : rpc.data };
  }
  if (result.error || !result.data)
    return Response.json(
      {
        error:
          result.error?.code === "23505"
            ? "Esse endereço já está em uso"
            : result.error?.message && !/violates|constraint/i.test(result.error.message)
              ? result.error.message
              : "Não foi possível salvar",
      },
      { status: 409 },
    );
  return Response.json({ ok: true, data: result.data });
}
