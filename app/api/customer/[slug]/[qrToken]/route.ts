import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cookieOptions,
  customerSession,
  deviceId,
  hashToken,
  sessionCookie,
} from "@/lib/customer";
import { readAll } from "@/lib/manage-access";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  qrToken: z.string().regex(/^[a-f0-9]{32}$/),
});
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("pin"),
    // Vazio quando o restaurante dispensou o PIN; o banco decide.
    pin: z.string().regex(/^(\d{4})?$/),
    name: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("order"),
    request_id: z.uuid(),
    items: z
      .array(
        z.object({
          item_id: z.uuid(),
          quantity: z.number().int().min(1).max(99),
          note: z.string().max(200).default(""),
          modifier_ids: z.array(z.uuid()).max(50),
          shared: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("cancel"), order_id: z.uuid() }),
  z.object({ action: z.literal("cancel_item"), item_id: z.uuid() }),
  z.object({
    action: z.literal("call"),
    kind: z.enum(["garcom", "conta", "ajuda"]),
    note: z.string().trim().max(80).optional(),
  }),
  z.object({ action: z.literal("cancel_call"), call_id: z.uuid() }),
  z.object({
    action: z.literal("survey"),
    rating: z.number().int().min(1).max(5),
    food_rating: z.number().int().min(1).max(5).nullable().default(null),
    service_rating: z.number().int().min(1).max(5).nullable().default(null),
    wait_rating: z.number().int().min(1).max(5).nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    comment: z.string().trim().max(300).default(""),
  }),
]);

export async function POST(
  request: Request,
  context: RouteContext<"/api/customer/[slug]/[qrToken]">,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const params = paramsSchema.safeParse(await context.params);
  const input = command.safeParse(await request.json().catch(() => null));
  if (!params.success || !input.success)
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const { slug, qrToken } = params.data;
  const db = createAdminClient();
  try {
    if (input.data.action === "pin") {
      const device = (await deviceId(true))!;
      const token = randomBytes(32).toString("hex");
      const { data, error } = await db.rpc("verify_table_pin", {
        p_slug: slug,
        p_qr: qrToken,
        p_pin: input.data.pin,
        p_device: device,
        p_hash: hashToken(token),
        p_name: input.data.name,
      });
      if (error) throw error;
      if (data.error)
        return Response.json({ error: data.error }, { status: data.status });
      (await cookies()).set(sessionCookie(qrToken), token, cookieOptions);
      return Response.json({ ok: true });
    }
    if (input.data.action === "survey") {
      // A sessão já foi apagada ao fechar; o que vale é o convite de 24 h.
      const token = (await cookies()).get(sessionCookie(qrToken))?.value;
      if (!token)
        return Response.json({ error: "A avaliação não está mais disponível" }, { status: 401 });
      const { data, error } = await db.rpc("submit_survey", {
        p_slug: slug,
        p_qr: qrToken,
        p_hash: hashToken(token),
        p_rating: input.data.rating,
        p_food: input.data.food_rating,
        p_service: input.data.service_rating,
        p_wait: input.data.wait_rating,
        p_tags: input.data.tags,
        p_comment: input.data.comment || null,
      });
      if (error)
        return Response.json({ error: error.message }, { status: error.code === "28000" ? 401 : 409 });
      return Response.json(data, { status: 201 });
    }
    if (input.data.action === "call" || input.data.action === "cancel_call") {
      // Chamar o garçom funciona mesmo sem PIN (mesa livre), com limite por aparelho.
      const device = (await deviceId(true))!;
      const session = await customerSession(slug, qrToken);
      if (input.data.action === "call") {
        const { data, error } = await db.rpc("create_service_call", {
          p_slug: slug,
          p_qr: qrToken,
          p_hash: session?.tokenHash ?? null,
          p_device: device,
          p_kind: input.data.kind,
          p_note: input.data.note || null,
        });
        if (error) throw error;
        if (data.error)
          return Response.json({ error: data.error }, { status: data.status });
        return Response.json(data, { status: data.already ? 200 : 201 });
      }
      const { data, error } = await db.rpc("cancel_service_call", {
        p_slug: slug,
        p_qr: qrToken,
        p_hash: session?.tokenHash ?? null,
        p_device: device,
        p_call: input.data.call_id,
      });
      if (error || !data)
        return Response.json(
          { error: "Essa chamada já foi atendida" },
          { status: 409 },
        );
      return Response.json({ ok: true });
    }
    const session = await customerSession(slug, qrToken);
    if (!session)
      return Response.json(
        { error: "Digite o código da mesa novamente" },
        { status: 401 },
      );
    if (input.data.action === "order") {
      const { data, error } = await db.rpc("submit_table_order", {
        p_slug: slug,
        p_qr: qrToken,
        p_hash: session.tokenHash,
        p_request: input.data.request_id,
        p_items: input.data.items,
      });
      if (error)
        return Response.json(
          { error: error.message },
          { status: error.code === "28000" ? 401 : 409 },
        );
      return Response.json(data, { status: 201 });
    }
    const { data, error } =
      input.data.action === "cancel"
        ? await db.rpc("cancel_table_order", {
            p_slug: slug,
            p_qr: qrToken,
            p_hash: session.tokenHash,
            p_order: input.data.order_id,
          })
        : await db.rpc("cancel_table_order_item", {
            p_slug: slug,
            p_qr: qrToken,
            p_hash: session.tokenHash,
            p_item: input.data.item_id,
          });
    if (error || !data)
      return Response.json(
        {
          error:
            input.data.action === "cancel"
              ? "Esse pedido não pode mais ser cancelado"
              : "Esse item não pode mais ser cancelado",
        },
        { status: 409 },
      );
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Não foi possível concluir. Tente novamente" },
      { status: 503 },
    );
  }
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/customer/[slug]/[qrToken]">,
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return Response.json({ error: "Endereço inválido" }, { status: 400 });
  try {
    const session = await customerSession(
      params.data.slug,
      params.data.qrToken,
    );
    if (!session)
      return Response.json(
        { error: "A comanda foi fechada ou sua sessão expirou" },
        { status: 401 },
      );
    const [data, guests, totals] = await Promise.all([
      readAll((start, end) =>
        session.db
          .from("orders")
          .select(
            "id,guest_id,status,prep_minutes,total_cents,created_at,station,batch_id,order_items(id,menu_item_id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot,shared,cancelled_at)",
          )
          .eq("tab_id", session.tab.id)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, end),
      ),
      session.db
        .from("tab_guests")
        .select("id,name,created_at,paid_cents")
        .eq("tab_id", session.tab.id)
        .order("created_at"),
      session.db.rpc("tab_totals", { p_tab: session.tab.id }),
    ]);
    if (guests.error) throw guests.error;
    return Response.json(
      {
        me: session.guestId,
        guests: guests.data,
        orders: data,
        total_cents: data
          .filter((o) => o.status !== "cancelado")
          .reduce((sum, o) => sum + o.total_cents, 0),
        totals: totals.data ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Não foi possível atualizar sua comanda" },
      { status: 503 },
    );
  }
}
