import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dayStart, periodRange } from "@/lib/periods";
import { staffNames } from "@/lib/staff-names";
import { PAYMENT_LABELS, STATION_LABELS, type PaymentMethod, type Station } from "@/lib/menu-types";

/**
 * Relatórios e satisfação por período (até 12 meses), calculados no banco.
 * `?format=csv&table=<nome>` exporta uma das tabelas em CSV para o Excel em
 * português (UTF-8 com BOM, separador ponto e vírgula).
 */
const CSV_TABLES = {
  by_day: ["Dia", "Pedidos", "Valor (R$)"],
  by_hour: ["Hora", "Pedidos", "Valor (R$)"],
  by_category: ["Categoria", "Quantidade", "Valor (R$)"],
  by_item: ["Item", "Quantidade", "Valor (R$)"],
  by_table: ["Mesa", "Comandas", "Valor (R$)"],
  by_staff: ["Pessoa", "Mesas abertas", "Comandas fechadas"],
  by_method: ["Forma de pagamento", "Valor (R$)"],
  cancellations: ["Motivo", "Quantidade", "Valor (R$)"],
  prep_by_station: ["Setor", "Tempo médio (min)", "Pedidos"],
  comments: ["Data", "Mesa", "Pessoa", "Nota", "Etiquetas", "Comentário"],
} as const;
type CsvTable = keyof typeof CSV_TABLES;

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(
  request: Request,
  context: RouteContext<"/api/reports/[restaurantId]">,
) {
  const id = z.uuid().safeParse((await context.params).restaurantId);
  if (!id.success)
    return Response.json({ error: "Restaurante inválido" }, { status: 400 });
  const url = new URL(request.url);
  const params = z
    .object({
      period: z.string().max(20).default("today"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      format: z.enum(["json", "csv"]).default("json"),
      table: z.enum(Object.keys(CSV_TABLES) as [CsvTable, ...CsvTable[]]).optional(),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!params.success)
    return Response.json({ error: "Filtros inválidos" }, { status: 400 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Faça login" }, { status: 401 });
  const range = periodRange(params.data.period, params.data.from, params.data.to);
  const from = dayStart(range.from);
  const to = dayStart(range.to);
  try {
    const [report, survey] = await Promise.all([
      db.rpc("report_summary", { p_restaurant: id.data, p_from: from, p_to: to }),
      db.rpc("survey_summary", { p_restaurant: id.data, p_from: from, p_to: to }),
    ]);
    if (report.error || survey.error)
      return Response.json({ error: (report.error ?? survey.error)!.message }, { status: 403 });
    const names = await staffNames((report.data.by_staff ?? []).map((s: { user_id: string }) => s.user_id));
    if (params.data.format === "csv") {
      const table = params.data.table ?? "by_item";
      const rows = rowsFor(table, report.data, survey.data, names);
      const csv = "﻿" + [CSV_TABLES[table], ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-${table}-${range.from}-a-${range.to}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return Response.json(
      { range, report: report.data, survey: survey.data, names },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Não foi possível gerar o relatório" }, { status: 503 });
  }
}

function rowsFor(table: CsvTable, report: Record<string, unknown>, survey: Record<string, unknown>, names: Record<string, string>): unknown[][] {
  const list = <T,>(key: string) => ((table === "comments" ? survey : report)[key] as T[] | undefined) ?? [];
  switch (table) {
    case "by_day":
      return list<{ day: string; orders: number; cents: number }>("by_day").map((r) => [r.day.split("-").reverse().join("/"), r.orders, reais(r.cents)]);
    case "by_hour":
      return list<{ hour: number; orders: number; cents: number }>("by_hour").map((r) => [`${r.hour}h`, r.orders, reais(r.cents)]);
    case "by_category":
    case "by_item":
      return list<{ name: string; quantity: number; cents: number }>(table).map((r) => [r.name, r.quantity, reais(r.cents)]);
    case "by_table":
      return list<{ label: string; tabs: number; cents: number }>("by_table").map((r) => [r.label, r.tabs, reais(r.cents)]);
    case "by_staff":
      return list<{ user_id: string; opened: number; closed: number }>("by_staff").map((r) => [names[r.user_id] ?? "Equipe", r.opened, r.closed]);
    case "by_method":
      return list<{ method: PaymentMethod; cents: number }>("by_method").map((r) => [PAYMENT_LABELS[r.method] ?? r.method, reais(r.cents)]);
    case "cancellations":
      return list<{ reason: string; quantity: number; cents: number }>("cancellations").map((r) => [r.reason, r.quantity, reais(r.cents)]);
    case "prep_by_station":
      return list<{ station: Station; avg_minutes: number; orders: number }>("prep_by_station").map((r) => [STATION_LABELS[r.station] ?? r.station, r.avg_minutes, r.orders]);
    case "comments":
      return list<{ created_at: string; table: string; guest: string; rating: number; tags: string[]; comment: string | null }>("comments").map((r) => [
        new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), r.table, r.guest, r.rating, r.tags.join(", "), r.comment ?? "",
      ]);
  }
}
