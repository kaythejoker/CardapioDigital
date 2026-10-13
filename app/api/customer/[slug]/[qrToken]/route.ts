import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cookieOptions,
  customerSession,
  hashToken,
  sessionCookie,
} from "@/lib/customer";
import { readAll } from "@/lib/manage-access";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  qrToken: z.string().regex(/^[a-f0-9]{32}$/),
});
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pin"), pin: z.string().regex(/^\d{4}$/) }),
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
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("cancel"), order_id: z.uuid() }),
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
      const jar = await cookies();
      let device = jar.get("comanda_device")?.value;
      if (!device || !z.uuid().safeParse(device).success) {
        device = randomUUID();
        jar.set("comanda_device", device, {
          ...cookieOptions,
          maxAge: 365 * 86400,
        });
      }
      // Vercel supplies this header. Never accept an IP from the body.
      const ip =
        request.headers.get("x-vercel-forwarded-for")?.split(",")[0] || "local";
      const token = randomBytes(32).toString("hex");
      const { data, error } = await db.rpc("verify_table_pin", {
        p_slug: slug,
        p_qr: qrToken,
        p_pin: input.data.pin,
        p_device: hashToken(`${device}:${ip}`),
        p_hash: hashToken(token),
      });
      if (error) throw error;
      if (data.error)
        return Response.json({ error: data.error }, { status: data.status });
      jar.set(sessionCookie(qrToken), token, cookieOptions);
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
    const { data, error } = await db.rpc("cancel_table_order", {
      p_slug: slug,
      p_qr: qrToken,
      p_hash: session.tokenHash,
      p_order: input.data.order_id,
    });
    if (error || !data)
      return Response.json(
        { error: "Esse pedido não pode mais ser cancelado" },
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
    const data = await readAll((start, end) =>
      session.db
        .from("orders")
        .select(
          "id,status,prep_minutes,total_cents,created_at,order_items(id,name_snapshot,unit_price_cents,quantity,note,modifiers_snapshot)",
        )
        .eq("tab_id", session.tab.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, end),
    );
    return Response.json(
      {
        orders: data,
        total_cents: data
          .filter((o) => o.status !== "cancelado")
          .reduce((sum, o) => sum + o.total_cents, 0),
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
