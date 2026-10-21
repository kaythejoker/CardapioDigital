"use client";
// Histórico, relatórios e satisfação do gestor (spec-fase2.md, seções 8, 11 e 15).
// Os números vêm prontos do banco (report_summary, survey_summary, tab_history,
// tab_detail, audit_history) pela rota /api/history e /api/reports.
import { useCallback, useEffect, useState } from "react";
import { Download, Star } from "lucide-react";
import { actionClass, fieldClass, jsonRequest, panelClass } from "@/components/admin-ui";
import { money, PAYMENT_LABELS, STATION_LABELS, type PaymentMethod, type Station, type TabTotals } from "@/lib/menu-types";
import { DAY_LABEL, PERIODS } from "@/lib/periods";

export type PeriodState = { period: string; from?: string; to?: string };
export const periodQuery = (p: PeriodState) =>
  `period=${encodeURIComponent(p.period)}${p.period === "custom" ? `&from=${p.from ?? ""}&to=${p.to ?? ""}` : ""}`;

export const ACTION_LABELS: Record<string, string> = {
  mesa_aberta: "Mesa aberta",
  pin_novo: "PIN novo",
  comanda_fechada: "Comanda fechada",
  comandas_unidas: "Comandas unidas",
  mesa_unida: "Mesa unida",
  mesa_separada: "Mesa separada",
  pedido_enviado: "Pedido enviado",
  pedido_em_preparo: "Pedido em preparo",
  pedido_pronto: "Pedido pronto",
  pedido_entregue: "Pedido entregue",
  pedido_cancelado: "Pedido cancelado",
  pedido_fixado: "Pedido fixado",
  pedido_desafixado: "Pedido desafixado",
  item_cancelado: "Item cancelado",
  pagamento_registrado: "Pagamento registrado",
  pagamento_estornado: "Pagamento estornado",
  pagamento_marcado: "Pagamento marcado",
  pagamento_desfeito: "Pagamento desfeito",
  desconto_aplicado: "Desconto aplicado",
  desconto_removido: "Desconto removido",
  taxa_retirada: "Taxa de serviço retirada",
  taxa_aplicada: "Taxa de serviço aplicada",
  item_esgotado: "Item esgotado",
  item_reposto: "Item reposto",
  item_ativado: "Item ativado",
  item_desativado: "Item desativado",
  preco_alterado: "Preço alterado",
  estoque_reposto: "Estoque reposto",
  estoque_ajustado: "Estoque ajustado",
  membro_adicionado: "Pessoa adicionada",
  membro_removido: "Pessoa removida",
  membro_alterado: "Acesso alterado",
  chamada_criada: "Chamada do cliente",
  chamada_atendida: "Chamada atendida",
  chamada_expirada: "Chamada expirada",
  chamada_cancelada: "Chamada cancelada",
  dia_fechado: "Dia fechado",
  avaliacao_enviada: "Avaliação enviada",
};
const ROLE_LABELS: Record<string, string> = { manager: "Gestor", waiter: "Garçom", kitchen: "Cozinha", bar: "Bar", reseller: "Revenda", customer: "Cliente", system: "Sistema", unknown: "—" };
const STATUS_LABELS: Record<string, string> = { recebido: "Recebido", em_preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue", cancelado: "Cancelado" };

export const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (next: PeriodState) => void }) {
  return (
    <div className="period-picker">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button key={p.key} aria-pressed={value.period === p.key} onClick={() => onChange({ period: p.key })} className="period-button">
            {p.label}
          </button>
        ))}
        <button aria-pressed={value.period === "custom"} onClick={() => onChange({ period: "custom", from: value.from, to: value.to })} className="period-button">
          Intervalo
        </button>
      </div>
      {value.period === "custom" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onChange({ period: "custom", from: String(f.get("from")), to: String(f.get("to")) });
          }}
        >
          <label className="text-sm">De<input name="from" type="date" required defaultValue={value.from} className={fieldClass} aria-label="Data inicial" /></label>
          <label className="text-sm">Até<input name="to" type="date" required defaultValue={value.to} className={fieldClass} aria-label="Data final" /></label>
          <button className={actionClass}>Aplicar</button>
        </form>
      )}
    </div>
  );
}

type HistoryTab = {
  id: string; opened_at: string; closed_at: string; opened_by: string | null; closed_by: string | null; merged_into: string | null;
  table: string; tables: string[]; guests: number; orders: number; cancelled_items: number; totals: TabTotals;
};
export type TabDetailData = {
  tab: { id: string; status: string; opened_at: string; closed_at: string | null; opened_by: string | null; closed_by: string | null; merged_into: string | null; table: string; tables: { label: string; added_at: string; released_at: string | null }[]; totals: TabTotals };
  guests: { id: string; name: string; created_at: string; paid_cents: number | null }[];
  orders: { id: string; status: string; station: Station; guest_id: string | null; total_cents: number; created_at: string; cancel_reason: string | null; cancelled_by: string | null;
    items: { id: string; name: string; quantity: number; unit_price_cents: number; note: string | null; shared: boolean; modifiers: { name: string }[]; cancelled_at: string | null; cancel_reason: string | null; cancelled_by: string | null }[] }[];
  payments: { id: string; guest_id: string | null; method: PaymentMethod; amount_cents: number; received_by: string | null; created_at: string; voided_at: string | null; void_reason: string | null }[];
  calls: { id: string; kind: string; note: string | null; status: string; created_at: string; attended_at: string | null; attended_by: string | null }[];
  surveys: { rating: number; comment: string | null; guest_id: string; created_at: string }[];
  log: { id: number; action: string; actor_id: string | null; actor_role: string; data: Record<string, unknown>; created_at: string }[];
  names: Record<string, string>;
};

export function TabDetail({ data, onClose }: { data: TabDetailData; onClose: () => void }) {
  const name = (id: string | null) => (id ? data.names[id] ?? "Equipe" : "—");
  const guest = (id: string | null) => data.guests.find((g) => g.id === id)?.name ?? (id ? "Pessoa" : "Mesa");
  const t = data.tab;
  return (
    <section className={`${panelClass} tab-detail`} aria-label={`Comanda da mesa ${t.table}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-2xl">Mesa {t.table}{t.tables.length ? ` + ${t.tables.map((x) => x.label).join(", ")}` : ""}</h3>
          <p className="text-sm text-muted-foreground">
            Aberta {when(t.opened_at)} por {name(t.opened_by)}{t.closed_at ? ` • fechada ${when(t.closed_at)} por ${name(t.closed_by)}` : " • ainda aberta"}
            {t.merged_into && " • unida a outra comanda"}
          </p>
        </div>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={onClose}>Fechar detalhe</button>
      </header>
      <div className="tab-detail-grid">
        <div>
          <h4>Pessoas</h4>
          {data.guests.map((g) => <p key={g.id}>{g.name} <small>entrou {time(g.created_at)}{g.paid_cents != null ? ` • pagou ${money(g.paid_cents)}` : ""}</small></p>)}
          {!data.guests.length && <p className="text-muted-foreground">Sem nome.</p>}
          <h4>Pagamentos</h4>
          {data.payments.map((p) => (
            <p key={p.id} className={p.voided_at ? "line-through text-muted-foreground" : ""}>
              {PAYMENT_LABELS[p.method]} {money(p.amount_cents)} • {guest(p.guest_id)} <small>{time(p.created_at)} por {name(p.received_by)}{p.voided_at ? ` • estornado${p.void_reason ? ` (${p.void_reason})` : ""}` : ""}</small>
            </p>
          ))}
          {!data.payments.length && <p className="text-muted-foreground">Nenhum pagamento.</p>}
          <h4>Totais</h4>
          <p>Itens {money(t.totals.items_cents)} • Taxa {money(t.totals.fee_cents)}{t.totals.fee_waived ? " (retirada)" : ""} • Desconto {money(t.totals.discount_cents)}{t.totals.discount_reason ? ` (${t.totals.discount_reason})` : ""}</p>
          <p><b>Total {money(t.totals.due_cents)}</b> • pago {money(t.totals.paid_cents)}</p>
          {data.calls.length > 0 && <><h4>Chamadas</h4>{data.calls.map((c) => <p key={c.id}>{c.kind === "conta" ? "Pediu a conta" : c.kind === "garcom" ? "Chamou o garçom" : `Outro: ${c.note ?? ""}`} <small>{time(c.created_at)} • {c.status}{c.attended_by ? ` por ${name(c.attended_by)}` : ""}</small></p>)}</>}
          {data.surveys.length > 0 && <><h4>Avaliações</h4>{data.surveys.map((s) => <p key={s.guest_id}>{guest(s.guest_id)}: {"★".repeat(s.rating)}{"☆".repeat(5 - s.rating)} {s.comment && <small>“{s.comment}”</small>}</p>)}</>}
        </div>
        <div>
          <h4>Pedidos</h4>
          {data.orders.map((o) => (
            <div key={o.id} className="tab-detail-order">
              <p><b>{time(o.created_at)} • {guest(o.guest_id)} • {STATION_LABELS[o.station] ?? o.station} • {STATUS_LABELS[o.status] ?? o.status}</b> <span>{money(o.total_cents)}</span></p>
              {o.cancel_reason && <small>Motivo: {o.cancel_reason}{o.cancelled_by ? ` (${name(o.cancelled_by)})` : ""}</small>}
              {o.items.map((i) => (
                <p key={i.id} className={i.cancelled_at ? "line-through text-muted-foreground" : ""}>
                  {i.quantity}× {i.name}{i.modifiers?.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : ""}{i.note ? ` • ${i.note}` : ""}{i.shared ? " • dividido" : ""}
                  {i.cancelled_at && <small> cancelado{i.cancel_reason ? ` — ${i.cancel_reason}` : ""}{i.cancelled_by ? ` (${name(i.cancelled_by)})` : ""}</small>}
                  <span> {money(i.unit_price_cents * i.quantity)}</span>
                </p>
              ))}
            </div>
          ))}
          {!data.orders.length && <p className="text-muted-foreground">Nenhum pedido.</p>}
          <h4>Linha do tempo</h4>
          <ol className="tab-detail-log">
            {data.log.map((l) => <li key={l.id}><small>{time(l.created_at)}</small> {ACTION_LABELS[l.action] ?? l.action} <small>— {l.actor_id ? name(l.actor_id) : ROLE_LABELS[l.actor_role] ?? l.actor_role}</small></li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function HistoryView({ restaurantId, canViewReports }: { restaurantId: string; canViewReports: boolean }) {
  const [period, setPeriod] = useState<PeriodState>({ period: "today" });
  const [tab, setTab] = useState<"comandas" | "operacoes">("comandas");
  const [data, setData] = useState<{ tabs: HistoryTab[]; names: Record<string, string> } | null>(null);
  const [audit, setAudit] = useState<{ entries: (TabDetailData["log"][number] & { tab_id: string | null })[]; names: Record<string, string> } | null>(null);
  const [detail, setDetail] = useState<TabDetailData | null>(null);
  const [error, setError] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterTable, setFilterTable] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      if (tab === "comandas") setData(await jsonRequest(`/api/history/${restaurantId}?${periodQuery(period)}`));
      else setAudit(await jsonRequest(`/api/history/${restaurantId}?${periodQuery(period)}&audit=1${filterAction ? `&action=${filterAction}` : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar");
    }
  }, [restaurantId, period, tab, filterAction]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  const open = async (tabId: string) => {
    try {
      setDetail(await jsonRequest(`/api/history/${restaurantId}?tab_id=${tabId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar");
    }
  };
  const tabs = (data?.tabs ?? []).filter((t) => !filterTable || t.table === filterTable || t.tables.includes(filterTable));
  const totalDue = tabs.reduce((s, t) => s + (t.totals?.due_cents ?? 0), 0);
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {!canViewReports && <p className="text-sm text-muted-foreground">Você vê as comandas fechadas de hoje.</p>}
      {canViewReports && (
        <nav className="flex gap-2">
          <button className="period-button" aria-pressed={tab === "comandas"} onClick={() => setTab("comandas")}>Comandas</button>
          <button className="period-button" aria-pressed={tab === "operacoes"} onClick={() => setTab("operacoes")}>Operações</button>
        </nav>
      )}
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{error}</p>}
      {detail && <TabDetail data={detail} onClose={() => setDetail(null)} />}
      {tab === "comandas" && data && (
        <section className={panelClass}>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-2xl">Comandas fechadas</h3>
            <div className="flex items-center gap-3 text-sm">
              <input placeholder="Filtrar por mesa" aria-label="Filtrar por mesa" value={filterTable} onChange={(e) => setFilterTable(e.target.value)} className="rounded-xl border px-3 py-2" />
              <span className="text-muted-foreground">{tabs.length} comandas • {money(totalDue)}</span>
            </div>
          </header>
          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead><tr><th>Mesa</th><th>Fechada</th><th>Pessoas</th><th>Pedidos</th><th>Cancelados</th><th>Total</th><th>Pago</th><th>Fechou</th><th></th></tr></thead>
              <tbody>
                {tabs.map((t) => (
                  <tr key={t.id} className={t.merged_into ? "opacity-60" : ""}>
                    <td>{t.table}{t.tables.length ? ` + ${t.tables.join(", ")}` : ""}{t.merged_into && <small> unida</small>}</td>
                    <td>{when(t.closed_at)}</td>
                    <td>{t.guests}</td>
                    <td>{t.orders}</td>
                    <td>{t.cancelled_items || "—"}</td>
                    <td>{money(t.totals?.due_cents ?? 0)}</td>
                    <td>{money(t.totals?.paid_cents ?? 0)}</td>
                    <td>{t.closed_by ? data.names[t.closed_by] ?? "Equipe" : "—"}</td>
                    <td><button className="text-sm underline" aria-label={`Ver comanda da mesa ${t.table}`} onClick={() => void open(t.id)}>Ver</button></td>
                  </tr>
                ))}
                {!tabs.length && <tr><td colSpan={9}>Nenhuma comanda fechada no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "operacoes" && audit && (
        <section className={panelClass}>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-2xl">Operações</h3>
            <select aria-label="Tipo de operação" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
              <option value="">Todos os tipos</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </header>
          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead><tr><th>Quando</th><th>Operação</th><th>Quem</th><th>Detalhe</th></tr></thead>
              <tbody>
                {audit.entries.map((l) => (
                  <tr key={l.id}>
                    <td>{when(l.created_at)}</td>
                    <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                    <td>{l.actor_id ? audit.names[l.actor_id] ?? "Equipe" : ROLE_LABELS[l.actor_role] ?? l.actor_role}</td>
                    <td className="text-muted-foreground">{describe(l.action, l.data)}{l.tab_id && <button className="ml-2 underline" onClick={() => void open(l.tab_id!)}>comanda</button>}</td>
                  </tr>
                ))}
                {!audit.entries.length && <tr><td colSpan={4}>Nenhuma operação no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function describe(action: string, data: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof data.name === "string") parts.push(data.name);
  if (typeof data.label === "string") parts.push(`mesa ${data.label}`);
  if (typeof data.amount_cents === "number") parts.push(money(data.amount_cents));
  if (typeof data.total_cents === "number" && action.startsWith("pedido_")) parts.push(money(data.total_cents));
  if (typeof data.method === "string") parts.push(PAYMENT_LABELS[data.method as PaymentMethod] ?? data.method);
  if (typeof data.reason === "string" && data.reason) parts.push(data.reason);
  if (typeof data.quantity === "number") parts.push(`${data.quantity} un.`);
  if (typeof data.from === "number" && typeof data.to === "number") parts.push(`${money(data.from)} → ${money(data.to)}`);
  if (typeof data.rating === "number") parts.push(`${data.rating} estrelas`);
  if (typeof data.kind === "string") parts.push(data.kind === "conta" ? "pediu a conta" : data.kind === "garcom" ? "chamou o garçom" : "outro");
  if (typeof data.percent === "number") parts.push(`${data.percent}%`);
  return parts.join(" • ");
}

type Report = {
  orders: number; items_cents: number; tabs_closed: number; guests: number; fee_cents: number; discount_cents: number; table_minutes_avg: number | null;
  by_day: { day: string; orders: number; cents: number }[]; by_hour: { hour: number; orders: number; cents: number }[];
  by_category: { name: string; quantity: number; cents: number }[]; by_item: { name: string; quantity: number; cents: number }[];
  by_table: { label: string; tabs: number; cents: number }[]; by_staff: { user_id: string; opened: number; closed: number }[];
  by_method: { method: PaymentMethod; cents: number }[]; cancellations: { reason: string; quantity: number; cents: number }[];
  cancellations_by_role: Record<string, number>; prep_by_station: { station: Station; avg_minutes: number; orders: number }[];
};
type Survey = {
  responses: number; avg_rating: number | null; avg_food: number | null; avg_service: number | null; avg_wait: number | null;
  distribution: Record<string, number> | null; guests: number; tags: { tag: string; n: number }[];
  comments: { id: string; rating: number; comment: string | null; tags: string[]; created_at: string; guest: string; tab_id: string; table: string }[];
};

function useReport(restaurantId: string, period: PeriodState) {
  const [data, setData] = useState<{ report: Report; survey: Survey; names: Record<string, string>; range: { from: string; to: string } } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(async () => {
      setError("");
      try {
        setData(await jsonRequest(`/api/reports/${restaurantId}?${periodQuery(period)}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível carregar");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [restaurantId, period]);
  return { data, error };
}

function ReportTable<T>({ title, rows, columns, csv, empty = "Sem dados no período." }: { title: string; rows: T[]; columns: { label: string; value: (row: T) => string | number }[]; csv: string; empty?: string }) {
  return (
    <section className={`${panelClass} report-table`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-xl">{title}</h3>
        <a href={csv} className="flex items-center gap-1 text-sm underline" aria-label={`Exportar CSV de ${title}`}><Download size={14} /> Exportar CSV</a>
      </header>
      <div className="queue-table-wrap">
        <table className="queue-table">
          <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.label}>{c.value(r)}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportsView({ restaurantId }: { restaurantId: string }) {
  const [period, setPeriod] = useState<PeriodState>({ period: "7d" });
  const { data, error } = useReport(restaurantId, period);
  const csv = (table: string) => `/api/reports/${restaurantId}?${periodQuery(period)}&format=csv&table=${table}`;
  const r = data?.report;
  const stats = r
    ? [
        { label: "Pedidos", value: String(r.orders), detail: `${money(r.items_cents)} em itens` },
        { label: "Comandas fechadas", value: String(r.tabs_closed), detail: `${r.guests} pessoas` },
        { label: "Ticket por comanda", value: money(r.tabs_closed ? Math.round(r.items_cents / r.tabs_closed) : 0), detail: "Itens ÷ comandas" },
        { label: "Ticket por pessoa", value: money(r.guests ? Math.round(r.items_cents / r.guests) : 0), detail: "Itens ÷ pessoas" },
        { label: "Taxa e descontos", value: `${money(r.fee_cents)} / ${money(r.discount_cents)}`, detail: "Comandas fechadas" },
        { label: "Mesa ocupada", value: r.table_minutes_avg != null ? `${r.table_minutes_avg} min` : "—", detail: "Tempo médio por comanda" },
      ]
    : [];
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{error}</p>}
      {data && r && (
        <>
          <p className="text-sm text-muted-foreground">Período: {DAY_LABEL(data.range.from)} até {DAY_LABEL(data.range.to)} (exclusivo)</p>
          <div className="dashboard-stats report-stats">{stats.map((s) => <article className="stat-card" key={s.label}><div><p>{s.label}</p><strong>{s.value}</strong><span className="stat-detail">{s.detail}</span></div></article>)}</div>
          <div className="report-grid">
            <ReportTable title="Vendas por dia" rows={r.by_day} csv={csv("by_day")} columns={[{ label: "Dia", value: (x) => DAY_LABEL(x.day) }, { label: "Pedidos", value: (x) => x.orders }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Vendas por hora" rows={r.by_hour} csv={csv("by_hour")} columns={[{ label: "Hora", value: (x) => `${x.hour}h` }, { label: "Pedidos", value: (x) => x.orders }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Por categoria" rows={r.by_category} csv={csv("by_category")} columns={[{ label: "Categoria", value: (x) => x.name }, { label: "Qtd.", value: (x) => x.quantity }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Por item" rows={r.by_item} csv={csv("by_item")} columns={[{ label: "Item", value: (x) => x.name }, { label: "Qtd.", value: (x) => x.quantity }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Por mesa" rows={r.by_table} csv={csv("by_table")} columns={[{ label: "Mesa", value: (x) => x.label }, { label: "Comandas", value: (x) => x.tabs }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Por garçom" rows={r.by_staff} csv={csv("by_staff")} columns={[{ label: "Pessoa", value: (x) => data.names[x.user_id] ?? "Equipe" }, { label: "Abriu", value: (x) => x.opened }, { label: "Fechou", value: (x) => x.closed }]} />
            <ReportTable title="Formas de pagamento" rows={r.by_method} csv={csv("by_method")} columns={[{ label: "Forma", value: (x) => PAYMENT_LABELS[x.method] ?? x.method }, { label: "Valor", value: (x) => money(x.cents) }]} />
            <ReportTable title="Cancelamentos" rows={r.cancellations} csv={csv("cancellations")} columns={[{ label: "Motivo", value: (x) => x.reason }, { label: "Qtd.", value: (x) => x.quantity }, { label: "Valor", value: (x) => money(x.cents) }]} empty={`Nenhum cancelamento.${Object.keys(r.cancellations_by_role).length ? "" : ""}`} />
            <ReportTable title="Tempo de preparo por setor" rows={r.prep_by_station} csv={csv("prep_by_station")} columns={[{ label: "Setor", value: (x) => STATION_LABELS[x.station] ?? x.station }, { label: "Média (min)", value: (x) => x.avg_minutes }, { label: "Pedidos", value: (x) => x.orders }]} />
          </div>
          {Object.keys(r.cancellations_by_role).length > 0 && (
            <p className="text-sm text-muted-foreground">Quem cancelou: {Object.entries(r.cancellations_by_role).map(([role, n]) => `${ROLE_LABELS[role] ?? role} ${n}`).join(" • ")}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SurveyView({ restaurantId }: { restaurantId: string }) {
  const [period, setPeriod] = useState<PeriodState>({ period: "30d" });
  const { data, error } = useReport(restaurantId, period);
  const [detail, setDetail] = useState<TabDetailData | null>(null);
  const s = data?.survey;
  const stars = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} ★`);
  const open = async (tabId: string) => setDetail(await jsonRequest(`/api/history/${restaurantId}?tab_id=${tabId}`));
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{error}</p>}
      {detail && <TabDetail data={detail} onClose={() => setDetail(null)} />}
      {s && (
        <>
          <div className="dashboard-stats report-stats">
            <article className="stat-card"><span className="stat-icon"><Star size={25} /></span><div><p>Nota geral</p><strong>{stars(s.avg_rating)}</strong><span className="stat-detail">{s.responses} {s.responses === 1 ? "resposta" : "respostas"}</span></div></article>
            <article className="stat-card"><div><p>Comida</p><strong>{stars(s.avg_food)}</strong><span className="stat-detail">Nota opcional</span></div></article>
            <article className="stat-card"><div><p>Atendimento</p><strong>{stars(s.avg_service)}</strong><span className="stat-detail">Nota opcional</span></div></article>
            <article className="stat-card"><div><p>Tempo de espera</p><strong>{stars(s.avg_wait)}</strong><span className="stat-detail">Nota opcional</span></div></article>
            <article className="stat-card"><div><p>Taxa de resposta</p><strong>{s.guests ? `${Math.round((s.responses / s.guests) * 100)}%` : "—"}</strong><span className="stat-detail">{s.responses} de {s.guests} pessoas</span></div></article>
          </div>
          <div className="report-grid">
            <section className={panelClass}>
              <h3 className="mb-3 font-heading text-xl">Distribuição</h3>
              {[5, 4, 3, 2, 1].map((n) => {
                const count = s.distribution?.[String(n)] ?? 0;
                const pct = s.responses ? Math.round((count / s.responses) * 100) : 0;
                return <div key={n} className="survey-bar"><span>{n} ★</span><div><i style={{ width: `${pct}%` }} /></div><small>{count}</small></div>;
              })}
            </section>
            <section className={panelClass}>
              <h3 className="mb-3 font-heading text-xl">Etiquetas mais marcadas</h3>
              <div className="flex flex-wrap gap-2">{s.tags.map((t) => <span key={t.tag} className="merge-chip">{t.tag} <small>{t.n}</small></span>)}{!s.tags.length && <p className="text-muted-foreground">Nenhuma etiqueta ainda.</p>}</div>
            </section>
          </div>
          <ReportTable
            title="Comentários"
            rows={s.comments}
            csv={`/api/reports/${restaurantId}?${periodQuery(period)}&format=csv&table=comments`}
            columns={[
              { label: "Quando", value: (c) => when(c.created_at) },
              { label: "Mesa", value: (c) => c.table },
              { label: "Pessoa", value: (c) => c.guest },
              { label: "Nota", value: (c) => "★".repeat(c.rating) },
              { label: "Etiquetas", value: (c) => c.tags.join(", ") },
              { label: "Comentário", value: (c) => c.comment ?? "" },
            ]}
            empty="Nenhuma avaliação no período."
          />
          {s.comments.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Abrir comanda: {s.comments.slice(0, 20).map((c) => <button key={c.id} className="mr-2 underline" onClick={() => void open(c.tab_id)}>mesa {c.table} ({when(c.created_at)})</button>)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
