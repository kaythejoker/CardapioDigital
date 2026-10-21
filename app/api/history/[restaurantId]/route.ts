import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dayStart, periodRange } from "@/lib/periods";
import { staffNames } from "@/lib/staff-names";

/**
 * Histórico de comandas e operações. A permissão é conferida pelas funções do
 * banco: gestor (ou quem tem view_reports) vê até 12 meses; garçom só hoje.
 *   ?tab_id=…                      detalhe de uma comanda
 *   ?period=today|7d|…|custom&from&to   comandas fechadas
 *   &audit=1&action=…&actor=…      linha do tempo das operações
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/history/[restaurantId]">,
) {
  const id = z.uuid().safeParse((await context.params).restaurantId);
  if (!id.success)
    return Response.json({ error: "Restaurante inválido" }, { status: 400 });
  const url = new URL(request.url);
  const params = z
    .object({
      tab_id: z.uuid().optional(),
      period: z.string().max(20).default("today"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      audit: z.enum(["1"]).optional(),
      action: z.string().max(40).optional(),
      actor: z.uuid().optional(),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!params.success)
    return Response.json({ error: "Filtros inválidos" }, { status: 400 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Faça login" }, { status: 401 });
  try {
    if (params.data.tab_id) {
      const { data, error } = await db.rpc("tab_detail", { p_tab: params.data.tab_id });
      if (error) return Response.json({ error: error.message }, { status: 403 });
      if (!data) return Response.json({ error: "Comanda não encontrada" }, { status: 404 });
      const ids = [
        data.tab.opened_by,
        data.tab.closed_by,
        ...data.orders.map((o: { cancelled_by: string | null }) => o.cancelled_by),
        ...data.orders.flatMap((o: { items: { cancelled_by: string | null }[] }) => o.items.map((i) => i.cancelled_by)),
        ...data.payments.map((p: { received_by: string | null }) => p.received_by),
        ...data.calls.map((c: { attended_by: string | null }) => c.attended_by),
        ...data.log.map((l: { actor_id: string | null }) => l.actor_id),
      ];
      return Response.json({ ...data, names: await staffNames(ids) }, { headers: { "Cache-Control": "no-store" } });
    }
    const range = periodRange(params.data.period, params.data.from, params.data.to);
    const from = dayStart(range.from);
    const to = dayStart(range.to);
    if (params.data.audit) {
      const { data, error } = await db.rpc("audit_history", {
        p_restaurant: id.data,
        p_from: from,
        p_to: to,
        p_action: params.data.action ?? null,
        p_actor: params.data.actor ?? null,
        p_limit: 500,
      });
      if (error) return Response.json({ error: error.message }, { status: 403 });
      return Response.json(
        { range, entries: data, names: await staffNames(data.map((l: { actor_id: string | null }) => l.actor_id)) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data, error } = await db.rpc("tab_history", { p_restaurant: id.data, p_from: from, p_to: to });
    if (error) return Response.json({ error: error.message }, { status: 403 });
    return Response.json(
      { range, tabs: data, names: await staffNames(data.flatMap((t: { opened_by: string | null; closed_by: string | null }) => [t.opened_by, t.closed_by])) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Não foi possível carregar o histórico" }, { status: 503 });
  }
}
