"use client";
// Histórico, relatórios e satisfação do gestor (spec-fase2.md, seções 8, 11 e 15).
// Os números vêm prontos do banco (report_summary, survey_summary, tab_history,
// tab_detail, audit_history) pela rota /api/history e /api/reports.
import { useCallback, useEffect, useState } from "react";
import { Download, Star } from "lucide-react";
import { actionClass, fieldClass, jsonRequest, panelClass } from "@/components/admin-ui";
import { money, PAYMENT_LABELS, STATION_LABELS, type PaymentMethod, type Station, type TabTotals } from "@/lib/menu-types";
import { DAY_LABEL, PERIODS } from "@/lib/periods";
import { LOCALE_TAGS, msg, type Locale, type Translate } from "@/lib/i18n";
import { useI18n } from "@/components/i18n";

export type PeriodState = { period: string; from?: string; to?: string };
export const periodQuery = (p: PeriodState) =>
  `period=${encodeURIComponent(p.period)}${p.period === "custom" ? `&from=${p.from ?? ""}&to=${p.to ?? ""}` : ""}`;

export const ACTION_LABELS: Record<string, string> = {
  mesa_aberta: msg("Mesa aberta"),
  pin_novo: msg("PIN novo"),
  pin_exigido: msg("PIN da mesa exigido"),
  pin_dispensado: msg("PIN da mesa dispensado"),
  comanda_fechada: msg("Comanda fechada"),
  comandas_unidas: msg("Comandas unidas"),
  mesa_unida: msg("Mesa unida"),
  mesa_separada: msg("Mesa separada"),
  pedido_enviado: msg("Pedido enviado"),
  pedido_em_preparo: msg("Pedido em preparo"),
  pedido_pronto: msg("Pedido pronto"),
  pedido_entregue: msg("Pedido entregue"),
  pedido_cancelado: msg("Pedido cancelado"),
  pedido_fixado: msg("Pedido fixado"),
  pedido_desafixado: msg("Pedido desafixado"),
  item_cancelado: msg("Item cancelado"),
  pagamento_registrado: msg("Pagamento registrado"),
  pagamento_estornado: msg("Pagamento estornado"),
  pagamento_marcado: msg("Pagamento marcado"),
  pagamento_desfeito: msg("Pagamento desfeito"),
  desconto_aplicado: msg("Desconto aplicado"),
  desconto_removido: msg("Desconto removido"),
  taxa_retirada: msg("Taxa de serviço retirada"),
  taxa_aplicada: msg("Taxa de serviço aplicada"),
  item_esgotado: msg("Item esgotado"),
  item_reposto: msg("Item reposto"),
  item_ativado: msg("Item ativado"),
  item_desativado: msg("Item desativado"),
  preco_alterado: msg("Preço alterado"),
  estoque_reposto: msg("Estoque reposto"),
  estoque_ajustado: msg("Estoque ajustado"),
  membro_adicionado: msg("Pessoa adicionada"),
  membro_removido: msg("Pessoa removida"),
  membro_alterado: msg("Acesso alterado"),
  chamada_criada: msg("Chamada do cliente"),
  chamada_atendida: msg("Chamada atendida"),
  chamada_expirada: msg("Chamada expirada"),
  chamada_cancelada: msg("Chamada cancelada"),
  dia_fechado: msg("Dia fechado"),
  avaliacao_enviada: msg("Avaliação enviada"),
  // Fase 3 (spec-fase3.md).
  pedidos_pausados: msg("Pedidos pausados"),
  pedidos_retomados: msg("Pedidos retomados"),
  mesa_bloqueada: msg("Mesa bloqueada para pedidos"),
  mesa_desbloqueada: msg("Mesa desbloqueada"),
  item_bloqueado: msg("Item bloqueado"),
  item_desbloqueado: msg("Item desbloqueado"),
  espera_adicionada: msg("Grupo entrou na espera"),
  espera_chamado: msg("Grupo chamado"),
  espera_aguardando: msg("Grupo voltou para a fila"),
  espera_sentado: msg("Grupo sentado"),
  espera_desistiu: msg("Grupo desistiu"),
};
const ROLE_LABELS: Record<string, string> = { manager: msg("Gestor"), waiter: msg("Garçom"), kitchen: msg("Cozinha"), bar: msg("Bar"), reseller: msg("Revenda"), customer: msg("Cliente"), system: msg("Sistema"), unknown: "—" };
const STATUS_LABELS: Record<string, string> = { recebido: msg("Recebido"), em_preparo: msg("Em preparo"), pronto: msg("Pronto"), entregue: msg("Entregue"), cancelado: msg("Cancelado") };
const CALL_STATUS: Record<string, string> = { aberta: msg("aberta"), atendida: msg("atendida"), expirada: msg("expirada"), cancelada: msg("cancelada") };

export const when = (iso: string, locale: Locale = "pt") =>
  new Date(iso).toLocaleString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const time = (iso: string, locale: Locale = "pt") =>
  new Date(iso).toLocaleTimeString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (next: PeriodState) => void }) {
  const { t } = useI18n();
  return (
    <div className="period-picker">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button key={p.key} aria-pressed={value.period === p.key} onClick={() => onChange({ period: p.key })} className="period-button">
            {t(p.label)}
          </button>
        ))}
        <button aria-pressed={value.period === "custom"} onClick={() => onChange({ period: "custom", from: value.from, to: value.to })} className="period-button">{t("Intervalo")}</button>
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
          <label className="text-sm">{t("De")}<input name="from" type="date" required defaultValue={value.from} className={fieldClass} aria-label={t("Data inicial")} /></label>
          <label className="text-sm">{t("Até")}<input name="to" type="date" required defaultValue={value.to} className={fieldClass} aria-label={t("Data final")} /></label>
          <button className={actionClass}>{t("Aplicar")}</button>
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
  const { locale, t } = useI18n();
  const name = (id: string | null) => (id ? data.names[id] ?? t("Equipe") : "—");
  const guest = (id: string | null) => data.guests.find((g) => g.id === id)?.name ?? (id ? t("Pessoa") : t("Mesa"));
  const at = (iso: string) => time(iso, locale);
  const tab = data.tab;
  const labels = tab.table + (tab.tables.length ? ` + ${tab.tables.map((x) => x.label).join(", ")}` : "");
  return (
    <section className={`${panelClass} tab-detail`} aria-label={t("Comanda da mesa {label}", { label: tab.table })}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-2xl">{t("Mesa {label}", { label: labels })}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Aberta {when} por {name}", { when: when(tab.opened_at, locale), name: name(tab.opened_by) })}
            {" • "}
            {tab.closed_at ? t("fechada {when} por {name}", { when: when(tab.closed_at, locale), name: name(tab.closed_by) }) : t("ainda aberta")}
            {tab.merged_into && ` • ${t("unida a outra comanda")}`}
          </p>
        </div>
        <button className="rounded-xl border px-3 py-2 text-sm" onClick={onClose}>{t("Fechar detalhe")}</button>
      </header>
      <div className="tab-detail-grid">
        <div>
          <h4>{t("Pessoas")}</h4>
          {data.guests.map((g) => (
            <p key={g.id}>
              {g.name} <small>{t("entrou {time}", { time: at(g.created_at) })}{g.paid_cents != null ? ` • ${t("pagou {value}", { value: money(g.paid_cents) })}` : ""}</small>
            </p>
          ))}
          {!data.guests.length && <p className="text-muted-foreground">{t("Sem nome.")}</p>}
          <h4>{t("Pagamentos")}</h4>
          {data.payments.map((p) => (
            <p key={p.id} className={p.voided_at ? "line-through text-muted-foreground" : ""}>
              {t(PAYMENT_LABELS[p.method])} {money(p.amount_cents)} • {guest(p.guest_id)}{" "}
              <small>
                {t("{time} por {name}", { time: at(p.created_at), name: name(p.received_by) })}
                {p.voided_at ? ` • ${t("estornado")}${p.void_reason ? ` (${p.void_reason})` : ""}` : ""}
              </small>
            </p>
          ))}
          {!data.payments.length && <p className="text-muted-foreground">{t("Nenhum pagamento.")}</p>}
          <h4>{t("Totais")}</h4>
          <p>
            {t("Itens {value}", { value: money(tab.totals.items_cents) })} • {t("Taxa {value}", { value: money(tab.totals.fee_cents) })}
            {tab.totals.fee_waived ? ` ${t("(retirada)")}` : ""} • {t("Desconto {value}", { value: money(tab.totals.discount_cents) })}
            {tab.totals.discount_reason ? ` (${tab.totals.discount_reason})` : ""}
          </p>
          <p>
            <b>{t("Total {value}", { value: money(tab.totals.due_cents) })}</b> • {t("pago {value}", { value: money(tab.totals.paid_cents) })}
          </p>
          {data.calls.length > 0 && (
            <>
              <h4>{t("Chamadas")}</h4>
              {data.calls.map((c) => (
                <p key={c.id}>
                  {c.kind === "conta" ? t("Pediu a conta") : c.kind === "garcom" ? t("Chamou o garçom") : t("Outro: {note}", { note: c.note ?? "" })}{" "}
                  <small>
                    {at(c.created_at)} • {CALL_STATUS[c.status] ? t(CALL_STATUS[c.status]) : c.status}
                    {c.attended_by ? ` ${t("por {name}", { name: name(c.attended_by) })}` : ""}
                  </small>
                </p>
              ))}
            </>
          )}
          {data.surveys.length > 0 && <><h4>{t("Avaliações")}</h4>{data.surveys.map((s) => <p key={s.guest_id}>{guest(s.guest_id)}: {"★".repeat(s.rating)}{"☆".repeat(5 - s.rating)} {s.comment && <small>“{s.comment}”</small>}</p>)}</>}
        </div>
        <div>
          <h4>{t("Pedidos")}</h4>
          {data.orders.map((o) => (
            <div key={o.id} className="tab-detail-order">
              <p><b>{at(o.created_at)} • {guest(o.guest_id)} • {STATION_LABELS[o.station] ? t(STATION_LABELS[o.station]) : o.station} • {STATUS_LABELS[o.status] ? t(STATUS_LABELS[o.status]) : o.status}</b> <span>{money(o.total_cents)}</span></p>
              {o.cancel_reason && <small>{t("Motivo: {reason}", { reason: t(o.cancel_reason) })}{o.cancelled_by ? ` (${name(o.cancelled_by)})` : ""}</small>}
              {o.items.map((i) => (
                <p key={i.id} className={i.cancelled_at ? "line-through text-muted-foreground" : ""}>
                  {i.quantity}× {i.name}{i.modifiers?.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : ""}{i.note ? ` • ${i.note}` : ""}{i.shared ? ` • ${t("dividido")}` : ""}
                  {i.cancelled_at && <small> {t("cancelado")}{i.cancel_reason ? ` — ${t(i.cancel_reason)}` : ""}{i.cancelled_by ? ` (${name(i.cancelled_by)})` : ""}</small>}
                  <span> {money(i.unit_price_cents * i.quantity)}</span>
                </p>
              ))}
            </div>
          ))}
          {!data.orders.length && <p className="text-muted-foreground">{t("Nenhum pedido.")}</p>}
          <h4>{t("Linha do tempo")}</h4>
          <ol className="tab-detail-log">
            {data.log.map((l) => (
              <li key={l.id}>
                <small>{at(l.created_at)}</small> {ACTION_LABELS[l.action] ? t(ACTION_LABELS[l.action]) : l.action}{" "}
                <small>— {l.actor_id ? name(l.actor_id) : ROLE_LABELS[l.actor_role] ? t(ROLE_LABELS[l.actor_role]) : l.actor_role}</small>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function HistoryView({ restaurantId, canViewReports }: { restaurantId: string; canViewReports: boolean }) {
  const { locale, t } = useI18n();
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
      setError(e instanceof Error ? e.message : msg("Não foi possível carregar"));
    }
  }, [restaurantId, period, tab, filterAction]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const open = async (tabId: string) => {
    try {
      setDetail(await jsonRequest(`/api/history/${restaurantId}?tab_id=${tabId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : msg("Não foi possível carregar"));
    }
  };
  const tabs = (data?.tabs ?? []).filter((row) => !filterTable || row.table === filterTable || row.tables.includes(filterTable));
  const totalDue = tabs.reduce((s, row) => s + (row.totals?.due_cents ?? 0), 0);
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {!canViewReports && <p className="text-sm text-muted-foreground">{t("Você vê as comandas fechadas de hoje.")}</p>}
      {canViewReports && (
        <nav className="flex gap-2">
          <button className="period-button" aria-pressed={tab === "comandas"} onClick={() => setTab("comandas")}>{t("Comandas")}</button>
          <button className="period-button" aria-pressed={tab === "operacoes"} onClick={() => setTab("operacoes")}>{t("Operações")}</button>
        </nav>
      )}
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{t(error)}</p>}
      {detail && <TabDetail data={detail} onClose={() => setDetail(null)} />}
      {tab === "comandas" && data && (
        <section className={panelClass}>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-2xl">{t("Comandas fechadas")}</h3>
            <div className="flex items-center gap-3 text-sm">
              <input placeholder={t("Filtrar por mesa")} aria-label={t("Filtrar por mesa")} value={filterTable} onChange={(e) => setFilterTable(e.target.value)} className="rounded-xl border px-3 py-2" />
              <span className="text-muted-foreground">{t("{n} comandas • {value}", { n: tabs.length, value: money(totalDue) })}</span>
            </div>
          </header>
          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead><tr><th>{t("Mesa")}</th><th>{t("Fechada")}</th><th>{t("Pessoas")}</th><th>{t("Pedidos")}</th><th>{t("Cancelados")}</th><th>{t("Total")}</th><th>{t("Pago")}</th><th>{t("Fechou")}</th><th></th></tr></thead>
              <tbody>
                {tabs.map((row) => (
                  <tr key={row.id} className={row.merged_into ? "opacity-60" : ""}>
                    <td>{row.table}{row.tables.length ? ` + ${row.tables.join(", ")}` : ""}{row.merged_into && <small> {t("unida")}</small>}</td>
                    <td>{when(row.closed_at, locale)}</td>
                    <td>{row.guests}</td>
                    <td>{row.orders}</td>
                    <td>{row.cancelled_items || "—"}</td>
                    <td>{money(row.totals?.due_cents ?? 0)}</td>
                    <td>{money(row.totals?.paid_cents ?? 0)}</td>
                    <td>{row.closed_by ? data.names[row.closed_by] ?? t("Equipe") : "—"}</td>
                    <td><button className="text-sm underline" aria-label={t("Ver comanda da mesa {label}", { label: row.table })} onClick={() => void open(row.id)}>{t("Ver")}</button></td>
                  </tr>
                ))}
                {!tabs.length && <tr><td colSpan={9}>{t("Nenhuma comanda fechada no período.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "operacoes" && audit && (
        <section className={panelClass}>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-2xl">{t("Operações")}</h3>
            <select aria-label={t("Tipo de operação")} value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
              <option value="">{t("Todos os tipos")}</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </header>
          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead><tr><th>{t("Quando")}</th><th>{t("Operação")}</th><th>{t("Quem")}</th><th>{t("Detalhe")}</th></tr></thead>
              <tbody>
                {audit.entries.map((l) => (
                  <tr key={l.id}>
                    <td>{when(l.created_at, locale)}</td>
                    <td>{ACTION_LABELS[l.action] ? t(ACTION_LABELS[l.action]) : l.action}</td>
                    <td>{l.actor_id ? audit.names[l.actor_id] ?? t("Equipe") : ROLE_LABELS[l.actor_role] ? t(ROLE_LABELS[l.actor_role]) : l.actor_role}</td>
                    <td className="text-muted-foreground">{describe(l.action, l.data, t)}{l.tab_id && <button className="ml-2 underline" onClick={() => void open(l.tab_id!)}>{t("ver comanda")}</button>}</td>
                  </tr>
                ))}
                {!audit.entries.length && <tr><td colSpan={4}>{t("Nenhuma operação no período.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function describe(action: string, data: Record<string, unknown>, t: Translate) {
  const parts: string[] = [];
  if (typeof data.number === "number" && action.startsWith("espera_")) parts.push(t("senha {n}", { n: data.number }));
  if (typeof data.name === "string") parts.push(data.name);
  if (typeof data.label === "string") parts.push(t("mesa {label}", { label: data.label }));
  if (typeof data.party_size === "number") parts.push(data.party_size === 1 ? t("1 pessoa") : t("{n} pessoas", { n: data.party_size }));
  if (typeof data.amount_cents === "number") parts.push(money(data.amount_cents));
  if (typeof data.total_cents === "number" && action.startsWith("pedido_")) parts.push(money(data.total_cents));
  if (typeof data.method === "string") parts.push(PAYMENT_LABELS[data.method as PaymentMethod] ? t(PAYMENT_LABELS[data.method as PaymentMethod]) : data.method);
  if (typeof data.reason === "string" && data.reason) parts.push(t(data.reason));
  if (typeof data.quantity === "number") parts.push(t("{n} un.", { n: data.quantity }));
  if (typeof data.from === "number" && typeof data.to === "number") parts.push(`${money(data.from)} → ${money(data.to)}`);
  if (typeof data.rating === "number") parts.push(t("{n} estrelas", { n: data.rating }));
  if (typeof data.kind === "string") parts.push(data.kind === "conta" ? t("pediu a conta") : data.kind === "garcom" ? t("chamou o garçom") : t("outro"));
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
    const timer = setTimeout(async () => {
      setError("");
      try {
        setData(await jsonRequest(`/api/reports/${restaurantId}?${periodQuery(period)}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : msg("Não foi possível carregar"));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [restaurantId, period]);
  return { data, error };
}

/** Rótulos das colunas passam por t() aqui; os valores chegam prontos. */
function ReportTable<R>({ title, rows, columns, csv, empty = msg("Sem dados no período.") }: { title: string; rows: R[]; columns: { label: string; value: (row: R) => string | number }[]; csv: string; empty?: string }) {
  const { t } = useI18n();
  return (
    <section className={`${panelClass} report-table`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-xl">{title}</h3>
        <a href={csv} className="flex items-center gap-1 text-sm underline" aria-label={t("Exportar CSV de {title}", { title })}><Download size={14} /> {t("Exportar CSV")}</a>
      </header>
      <div className="queue-table-wrap">
        <table className="queue-table">
          <thead><tr>{columns.map((c) => <th key={c.label}>{t(c.label)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.label}>{c.value(r)}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={columns.length}>{t(empty)}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportsView({ restaurantId }: { restaurantId: string }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<PeriodState>({ period: "7d" });
  const { data, error } = useReport(restaurantId, period);
  const csv = (table: string) => `/api/reports/${restaurantId}?${periodQuery(period)}&format=csv&table=${table}`;
  const r = data?.report;
  const stats = r
    ? [
        { label: t("Pedidos"), value: String(r.orders), detail: t("{value} em itens", { value: money(r.items_cents) }) },
        { label: t("Comandas fechadas"), value: String(r.tabs_closed), detail: t("{n} pessoas", { n: r.guests }) },
        { label: t("Ticket por comanda"), value: money(r.tabs_closed ? Math.round(r.items_cents / r.tabs_closed) : 0), detail: t("Itens ÷ comandas") },
        { label: t("Ticket por pessoa"), value: money(r.guests ? Math.round(r.items_cents / r.guests) : 0), detail: t("Itens ÷ pessoas") },
        { label: t("Taxa e descontos"), value: `${money(r.fee_cents)} / ${money(r.discount_cents)}`, detail: t("Comandas fechadas") },
        { label: t("Mesa ocupada"), value: r.table_minutes_avg != null ? t("{n} min", { n: r.table_minutes_avg }) : "—", detail: t("Tempo médio por comanda") },
      ]
    : [];
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{t(error)}</p>}
      {data && r && (
        <>
          <p className="text-sm text-muted-foreground">{t("Período: {from} até {to} (exclusivo)", { from: DAY_LABEL(data.range.from), to: DAY_LABEL(data.range.to) })}</p>
          <div className="dashboard-stats report-stats">{stats.map((s) => <article className="stat-card" key={s.label}><div><p>{s.label}</p><strong>{s.value}</strong><span className="stat-detail">{s.detail}</span></div></article>)}</div>
          <div className="report-grid">
            <ReportTable title={t("Vendas por dia")} rows={r.by_day} csv={csv("by_day")} columns={[{ label: msg("Dia"), value: (x) => DAY_LABEL(x.day) }, { label: msg("Pedidos"), value: (x) => x.orders }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Vendas por hora")} rows={r.by_hour} csv={csv("by_hour")} columns={[{ label: msg("Hora"), value: (x) => `${x.hour}h` }, { label: msg("Pedidos"), value: (x) => x.orders }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Por categoria")} rows={r.by_category} csv={csv("by_category")} columns={[{ label: msg("Categoria"), value: (x) => x.name }, { label: msg("Qtd."), value: (x) => x.quantity }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Por item")} rows={r.by_item} csv={csv("by_item")} columns={[{ label: msg("Item"), value: (x) => x.name }, { label: msg("Qtd."), value: (x) => x.quantity }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Por mesa")} rows={r.by_table} csv={csv("by_table")} columns={[{ label: msg("Mesa"), value: (x) => x.label }, { label: msg("Comandas"), value: (x) => x.tabs }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Por garçom")} rows={r.by_staff} csv={csv("by_staff")} columns={[{ label: msg("Pessoa"), value: (x) => data.names[x.user_id] ?? t("Equipe") }, { label: msg("Abriu"), value: (x) => x.opened }, { label: msg("Fechou"), value: (x) => x.closed }]} />
            <ReportTable title={t("Formas de pagamento")} rows={r.by_method} csv={csv("by_method")} columns={[{ label: msg("Forma"), value: (x) => (PAYMENT_LABELS[x.method] ? t(PAYMENT_LABELS[x.method]) : x.method) }, { label: msg("Valor"), value: (x) => money(x.cents) }]} />
            <ReportTable title={t("Cancelamentos")} rows={r.cancellations} csv={csv("cancellations")} columns={[{ label: msg("Motivo"), value: (x) => t(x.reason) }, { label: msg("Qtd."), value: (x) => x.quantity }, { label: msg("Valor"), value: (x) => money(x.cents) }]} empty={msg("Nenhum cancelamento.")} />
            <ReportTable title={t("Tempo de preparo por setor")} rows={r.prep_by_station} csv={csv("prep_by_station")} columns={[{ label: msg("Setor"), value: (x) => (STATION_LABELS[x.station] ? t(STATION_LABELS[x.station]) : x.station) }, { label: msg("Média (min)"), value: (x) => x.avg_minutes }, { label: msg("Pedidos"), value: (x) => x.orders }]} />
          </div>
          {Object.keys(r.cancellations_by_role).length > 0 && (
            <p className="text-sm text-muted-foreground">{t("Quem cancelou:")} {Object.entries(r.cancellations_by_role).map(([role, n]) => `${ROLE_LABELS[role] ? t(ROLE_LABELS[role]) : role} ${n}`).join(" • ")}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SurveyView({ restaurantId }: { restaurantId: string }) {
  const { locale, t } = useI18n();
  const [period, setPeriod] = useState<PeriodState>({ period: "30d" });
  const { data, error } = useReport(restaurantId, period);
  const [detail, setDetail] = useState<TabDetailData | null>(null);
  const s = data?.survey;
  const stars = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} ★`);
  const open = async (tabId: string) => setDetail(await jsonRequest(`/api/history/${restaurantId}?tab_id=${tabId}`));
  return (
    <div className="space-y-5">
      <PeriodPicker value={period} onChange={setPeriod} />
      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-white">{t(error)}</p>}
      {detail && <TabDetail data={detail} onClose={() => setDetail(null)} />}
      {s && (
        <>
          <div className="dashboard-stats report-stats">
            <article className="stat-card"><span className="stat-icon"><Star size={25} /></span><div><p>{t("Nota geral")}</p><strong>{stars(s.avg_rating)}</strong><span className="stat-detail">{s.responses === 1 ? t("1 resposta") : t("{n} respostas", { n: s.responses })}</span></div></article>
            <article className="stat-card"><div><p>{t("Comida")}</p><strong>{stars(s.avg_food)}</strong><span className="stat-detail">{t("Nota opcional")}</span></div></article>
            <article className="stat-card"><div><p>{t("Atendimento")}</p><strong>{stars(s.avg_service)}</strong><span className="stat-detail">{t("Nota opcional")}</span></div></article>
            <article className="stat-card"><div><p>{t("Tempo de espera")}</p><strong>{stars(s.avg_wait)}</strong><span className="stat-detail">{t("Nota opcional")}</span></div></article>
            <article className="stat-card"><div><p>{t("Taxa de resposta")}</p><strong>{s.guests ? `${Math.round((s.responses / s.guests) * 100)}%` : "—"}</strong><span className="stat-detail">{t("{n} de {total} pessoas", { n: s.responses, total: s.guests })}</span></div></article>
          </div>
          <div className="report-grid">
            <section className={panelClass}>
              <h3 className="mb-3 font-heading text-xl">{t("Distribuição")}</h3>
              {[5, 4, 3, 2, 1].map((n) => {
                const count = s.distribution?.[String(n)] ?? 0;
                const pct = s.responses ? Math.round((count / s.responses) * 100) : 0;
                return <div key={n} className="survey-bar"><span>{n} ★</span><div><i style={{ width: `${pct}%` }} /></div><small>{count}</small></div>;
              })}
            </section>
            <section className={panelClass}>
              <h3 className="mb-3 font-heading text-xl">{t("Etiquetas mais marcadas")}</h3>
              <div className="flex flex-wrap gap-2">{s.tags.map((tag) => <span key={tag.tag} className="merge-chip">{t(tag.tag)} <small>{tag.n}</small></span>)}{!s.tags.length && <p className="text-muted-foreground">{t("Nenhuma etiqueta ainda.")}</p>}</div>
            </section>
          </div>
          <ReportTable
            title={t("Comentários")}
            rows={s.comments}
            csv={`/api/reports/${restaurantId}?${periodQuery(period)}&format=csv&table=comments`}
            columns={[
              { label: msg("Quando"), value: (c) => when(c.created_at, locale) },
              { label: msg("Mesa"), value: (c) => c.table },
              { label: msg("Pessoa"), value: (c) => c.guest },
              { label: msg("Nota"), value: (c) => "★".repeat(c.rating) },
              { label: msg("Etiquetas"), value: (c) => c.tags.map((tag) => t(tag)).join(", ") },
              { label: msg("Comentário"), value: (c) => c.comment ?? "" },
            ]}
            empty={msg("Nenhuma avaliação no período.")}
          />
          {s.comments.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("Abrir comanda:")}{" "}
              {s.comments.slice(0, 20).map((c) => (
                <button key={c.id} className="mr-2 underline" onClick={() => void open(c.tab_id)}>
                  {t("mesa {label}", { label: c.table })} ({when(c.created_at, locale)})
                </button>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}
