"use client";
// Planos e assinaturas da revenda (spec-fase2.md, seção 13).
import { useState } from "react";
import { actionClass, fieldClass, panelClass } from "@/components/admin-ui";
import { money } from "@/lib/menu-types";
import { FEATURES, STATUS_LABELS, type Access, type FeatureKey } from "@/lib/features";
import { useI18n } from "@/components/i18n";
import { LOCALE_TAGS, type Locale } from "@/lib/i18n";

export type Plan = {
  id: string;
  name: string;
  price_cents: number;
  billing_period: "mensal" | "anual";
  max_tables: number | null;
  trial_days: number;
  features: Partial<Record<FeatureKey, boolean>>;
  is_default: boolean;
  active: boolean;
};
export type Subscription = {
  id: string;
  restaurant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  notes: string | null;
};
export type SubscriptionPayment = {
  id: string;
  subscription_id: string;
  amount_cents: number;
  paid_at: string;
  period_start: string;
  period_end: string;
  method: string | null;
  note: string | null;
};

const date = (iso: string | null, locale: Locale = "pt") => (iso ? new Date(iso).toLocaleDateString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo" }) : "—");
const dayInput = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "");

export function PlanForm({ plan, busy, onSave, onClose }: { plan: Plan | null; busy: boolean; onSave: (body: unknown) => Promise<unknown>; onClose: () => void }) {
  const { t } = useI18n();
  const [features, setFeatures] = useState<Partial<Record<FeatureKey, boolean>>>(plan?.features ?? Object.fromEntries(FEATURES.map((f) => [f.key, true])));
  return (
    <form
      className={`${panelClass} space-y-4`}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({
          action: "plan",
          ...(plan ? { id: plan.id } : {}),
          name: f.get("name"),
          price_cents: Math.round(Number(f.get("price") || 0) * 100),
          billing_period: f.get("period"),
          max_tables: f.get("max_tables") ? Number(f.get("max_tables")) : null,
          trial_days: Number(f.get("trial") || 0),
          features,
          is_default: f.get("default") === "on",
          active: f.get("active") === "on",
        }).then((ok) => { if (ok) onClose(); });
      }}
    >
      <h3 className="font-heading text-2xl">{plan ? t("Editar plano {name}", { name: plan.name }) : t("Novo plano")}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label>{t("Nome")}<input name="name" required maxLength={60} defaultValue={plan?.name ?? ""} className={fieldClass} /></label>
        <label>{t("Preço (R$)")}<input name="price" type="number" min={0} step="0.01" defaultValue={(plan?.price_cents ?? 0) / 100} className={fieldClass} aria-label={t("Preço do plano")} /></label>
        <label>{t("Cobrança")}<select name="period" defaultValue={plan?.billing_period ?? "mensal"} className={fieldClass}><option value="mensal">{t("Mensal")}</option><option value="anual">{t("Anual")}</option></select></label>
        <label>{t("Máximo de mesas")}<input name="max_tables" type="number" min={1} max={10000} defaultValue={plan?.max_tables ?? ""} placeholder={t("Sem limite")} className={fieldClass} /></label>
        <label>{t("Dias de teste")}<input name="trial" type="number" min={0} max={365} defaultValue={plan?.trial_days ?? 14} className={fieldClass} /></label>
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">{t("Módulos incluídos")}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {FEATURES.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={features[f.key] ?? false} onChange={(e) => setFeatures((x) => ({ ...x, [f.key]: e.target.checked }))} aria-label={t(f.label)} />
              <span><b>{t(f.label)}</b><small className="block text-muted-foreground">{t(f.hint)}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2"><input name="default" type="checkbox" defaultChecked={plan?.is_default ?? false} />{t("Plano padrão dos restaurantes novos")}</label>
        <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={plan?.active ?? true} />{t("Ativo")}</label>
      </div>
      <div className="flex gap-3"><button disabled={busy} className={actionClass}>{t("Salvar plano")}</button><button type="button" onClick={onClose}>{t("Voltar")}</button></div>
    </form>
  );
}

export function PlansView({ plans, subscriptions, busy, onSave }: { plans: Plan[]; subscriptions: Subscription[]; busy: boolean; onSave: (body: unknown) => Promise<unknown> }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const count = (planId: string) => subscriptions.filter((s) => s.plan_id === planId).length;
  return (
    <div className="space-y-5">
      {editing && <PlanForm plan={editing === "new" ? null : plans.find((p) => p.id === editing) ?? null} busy={busy} onSave={onSave} onClose={() => setEditing(null)} />}
      {!editing && <button className={actionClass} onClick={() => setEditing("new")}>{t("Novo plano")}</button>}
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => (
          <article key={p.id} className={`${panelClass} ${p.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-2xl">{p.name}{p.is_default && <small className="ml-2 rounded-full bg-secondary px-2 py-1 text-xs">{t("padrão")}</small>}</h3>
                <p className="text-sm text-muted-foreground">{money(p.price_cents)} / {p.billing_period === "anual" ? t("ano") : t("mês")} • {t("{n} dias de teste", { n: p.trial_days })} • {p.max_tables ? t("até {n} mesas", { n: p.max_tables }) : t("mesas ilimitadas")} • {t("{n} restaurante(s)", { n: count(p.id) })}</p>
              </div>
              <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => setEditing(p.id)}>{t("Editar")}</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {FEATURES.map((f) => <span key={f.key} className={`merge-chip ${p.features?.[f.key] ? "" : "opacity-50 line-through"}`}>{t(f.label)}</span>)}
            </div>
          </article>
        ))}
        {!plans.length && <p className="text-muted-foreground">{t("Nenhum plano ainda. Crie o primeiro e marque como padrão.")}</p>}
      </div>
    </div>
  );
}

export function SubscriptionPanel({ restaurantId, access, subscription, plans, payments, busy, onSave }: {
  restaurantId: string; access: Access | undefined; subscription: Subscription | undefined; plans: Plan[];
  payments: SubscriptionPayment[]; busy: boolean; onSave: (body: unknown) => Promise<unknown>;
}) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"none" | "plan" | "payment">("none");
  const status = access?.status ?? "ativa";
  return (
    <div className="subscription-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`subscription-status ${status}`}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ? t(STATUS_LABELS[status as keyof typeof STATUS_LABELS]) : status}</span>
        <small className="text-muted-foreground">
          {access?.plan ? t("Plano {plan}", { plan: access.plan }) : t("Sem assinatura")}
          {status === "teste" && access?.trial_ends_at ? ` • ${t("teste até {date}", { date: date(access.trial_ends_at, locale) })}` : ""}
          {status !== "teste" && access?.period_end ? ` • ${t("vence {date}", { date: date(access.period_end, locale) })}` : status !== "teste" && access?.plan ? ` • ${t("sem vencimento")}` : ""}
        </small>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <button className="underline" onClick={() => setMode(mode === "plan" ? "none" : "plan")}>{t("Plano e status")}</button>
        <button className="underline" onClick={() => setMode(mode === "payment" ? "none" : "payment")}>{t("Registrar pagamento")}</button>
      </div>
      {mode === "plan" && (
        <form
          className="finance-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              action: "subscription",
              restaurant_id: restaurantId,
              plan_id: f.get("plan"),
              status: f.get("status"),
              period_end: f.get("period_end") || null,
              notes: f.get("notes") || undefined,
            }).then((ok) => { if (ok) setMode("none"); });
          }}
        >
          <label>{t("Plano")}<select name="plan" defaultValue={subscription?.plan_id ?? plans.find((p) => p.is_default)?.id ?? plans[0]?.id} aria-label={t("Plano")}>{plans.filter((p) => p.active || p.id === subscription?.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>{t("Status")}<select name="status" defaultValue={subscription?.status === "atrasada" ? "ativa" : subscription?.status ?? "teste"} aria-label={t("Status da assinatura")}><option value="teste">{t("Em teste")}</option><option value="ativa">{t("Ativa")}</option><option value="suspensa">{t("Suspensa")}</option><option value="cancelada">{t("Cancelada")}</option></select></label>
          <label>{t("Vencimento (opcional)")}<input name="period_end" type="date" defaultValue={dayInput(subscription?.current_period_end ?? null)} aria-label={t("Vencimento")} /></label>
          <label>{t("Observação")}<input name="notes" maxLength={500} defaultValue={subscription?.notes ?? ""} /></label>
          <div className="flex gap-3"><button disabled={busy} className={actionClass}>{t("Salvar assinatura")}</button><button type="button" onClick={() => setMode("none")}>{t("Voltar")}</button></div>
        </form>
      )}
      {mode === "payment" && (
        <form
          className="finance-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              action: "subscription_payment",
              restaurant_id: restaurantId,
              amount_cents: Math.round(Number(f.get("amount") || 0) * 100),
              period_start: f.get("start"),
              period_end: f.get("end"),
              method: f.get("method"),
              note: f.get("note") || undefined,
            }).then((ok) => { if (ok) setMode("none"); });
          }}
        >
          <p className="text-sm text-muted-foreground">{t("Recebido fora do sistema (Pix, boleto, transferência). O pagamento estende o vencimento e reativa a assinatura.")}</p>
          <label>{t("Valor (R$)")}<input name="amount" type="number" min={0} step="0.01" required defaultValue={((plans.find((p) => p.id === subscription?.plan_id)?.price_cents ?? 0) / 100).toFixed(2)} aria-label={t("Valor pago")} /></label>
          <label>{t("Período pago: de")} <input name="start" type="date" required aria-label={t("Início do período")} /></label>
          <label>{t("até")}<input name="end" type="date" required aria-label={t("Fim do período")} /></label>
          <label>{t("Forma")}<select name="method" defaultValue="pix" aria-label={t("Forma de pagamento da assinatura")}><option value="pix">Pix</option><option value="boleto">{t("Boleto")}</option><option value="transferencia">{t("Transferência")}</option><option value="cartao">{t("Cartão")}</option><option value="outro">{t("Outro")}</option></select></label>
          <label>{t("Observação")}<input name="note" maxLength={200} /></label>
          <div className="flex gap-3"><button disabled={busy} className={actionClass}>{t("Confirmar pagamento")}</button><button type="button" onClick={() => setMode("none")}>{t("Voltar")}</button></div>
        </form>
      )}
      {payments.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("{n} pagamento(s)", { n: payments.length })}</summary>
          {payments.map((p) => <p key={p.id}>{date(p.paid_at, locale)} • {money(p.amount_cents)} • {t("{from} a {to}", { from: p.period_start.split("-").reverse().join("/"), to: p.period_end.split("-").reverse().join("/") })}{p.method ? ` • ${p.method}` : ""}{p.note ? ` • ${p.note}` : ""}</p>)}
        </details>
      )}
    </div>
  );
}
