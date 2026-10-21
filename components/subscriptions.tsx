"use client";
// Planos e assinaturas da revenda (spec-fase2.md, seção 13).
import { useState } from "react";
import { actionClass, fieldClass, panelClass } from "@/components/admin-ui";
import { money } from "@/lib/menu-types";
import { FEATURES, STATUS_LABELS, type Access, type FeatureKey } from "@/lib/features";

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

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const dayInput = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "");

export function PlanForm({ plan, busy, onSave, onClose }: { plan: Plan | null; busy: boolean; onSave: (body: unknown) => Promise<unknown>; onClose: () => void }) {
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
      <h3 className="font-heading text-2xl">{plan ? `Editar plano ${plan.name}` : "Novo plano"}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label>Nome<input name="name" required maxLength={60} defaultValue={plan?.name ?? ""} className={fieldClass} /></label>
        <label>Preço (R$)<input name="price" type="number" min={0} step="0.01" defaultValue={(plan?.price_cents ?? 0) / 100} className={fieldClass} aria-label="Preço do plano" /></label>
        <label>Cobrança<select name="period" defaultValue={plan?.billing_period ?? "mensal"} className={fieldClass}><option value="mensal">Mensal</option><option value="anual">Anual</option></select></label>
        <label>Máximo de mesas<input name="max_tables" type="number" min={1} max={10000} defaultValue={plan?.max_tables ?? ""} placeholder="Sem limite" className={fieldClass} /></label>
        <label>Dias de teste<input name="trial" type="number" min={0} max={365} defaultValue={plan?.trial_days ?? 14} className={fieldClass} /></label>
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">Módulos incluídos</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {FEATURES.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={features[f.key] ?? false} onChange={(e) => setFeatures((x) => ({ ...x, [f.key]: e.target.checked }))} aria-label={f.label} />
              <span><b>{f.label}</b><small className="block text-muted-foreground">{f.hint}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2"><input name="default" type="checkbox" defaultChecked={plan?.is_default ?? false} />Plano padrão dos restaurantes novos</label>
        <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={plan?.active ?? true} />Ativo</label>
      </div>
      <div className="flex gap-3"><button disabled={busy} className={actionClass}>Salvar plano</button><button type="button" onClick={onClose}>Voltar</button></div>
    </form>
  );
}

export function PlansView({ plans, subscriptions, busy, onSave }: { plans: Plan[]; subscriptions: Subscription[]; busy: boolean; onSave: (body: unknown) => Promise<unknown> }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const count = (planId: string) => subscriptions.filter((s) => s.plan_id === planId).length;
  return (
    <div className="space-y-5">
      {editing && <PlanForm plan={editing === "new" ? null : plans.find((p) => p.id === editing) ?? null} busy={busy} onSave={onSave} onClose={() => setEditing(null)} />}
      {!editing && <button className={actionClass} onClick={() => setEditing("new")}>Novo plano</button>}
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => (
          <article key={p.id} className={`${panelClass} ${p.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-2xl">{p.name}{p.is_default && <small className="ml-2 rounded-full bg-secondary px-2 py-1 text-xs">padrão</small>}</h3>
                <p className="text-sm text-muted-foreground">{money(p.price_cents)} / {p.billing_period === "anual" ? "ano" : "mês"} • {p.trial_days} dias de teste • {p.max_tables ? `até ${p.max_tables} mesas` : "mesas ilimitadas"} • {count(p.id)} restaurante(s)</p>
              </div>
              <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => setEditing(p.id)}>Editar</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {FEATURES.map((f) => <span key={f.key} className={`merge-chip ${p.features?.[f.key] ? "" : "opacity-50 line-through"}`}>{f.label}</span>)}
            </div>
          </article>
        ))}
        {!plans.length && <p className="text-muted-foreground">Nenhum plano ainda. Crie o primeiro e marque como padrão.</p>}
      </div>
    </div>
  );
}

export function SubscriptionPanel({ restaurantId, access, subscription, plans, payments, busy, onSave }: {
  restaurantId: string; access: Access | undefined; subscription: Subscription | undefined; plans: Plan[];
  payments: SubscriptionPayment[]; busy: boolean; onSave: (body: unknown) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<"none" | "plan" | "payment">("none");
  const status = access?.status ?? "ativa";
  return (
    <div className="subscription-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`subscription-status ${status}`}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}</span>
        <small className="text-muted-foreground">
          {access?.plan ? `Plano ${access.plan}` : "Sem assinatura"}
          {status === "teste" && access?.trial_ends_at ? ` • teste até ${date(access.trial_ends_at)}` : ""}
          {status !== "teste" && access?.period_end ? ` • vence ${date(access.period_end)}` : status !== "teste" && access?.plan ? " • sem vencimento" : ""}
        </small>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <button className="underline" onClick={() => setMode(mode === "plan" ? "none" : "plan")}>Plano e status</button>
        <button className="underline" onClick={() => setMode(mode === "payment" ? "none" : "payment")}>Registrar pagamento</button>
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
          <label>Plano<select name="plan" defaultValue={subscription?.plan_id ?? plans.find((p) => p.is_default)?.id ?? plans[0]?.id} aria-label="Plano">{plans.filter((p) => p.active || p.id === subscription?.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={subscription?.status === "atrasada" ? "ativa" : subscription?.status ?? "teste"} aria-label="Status da assinatura"><option value="teste">Em teste</option><option value="ativa">Ativa</option><option value="suspensa">Suspensa</option><option value="cancelada">Cancelada</option></select></label>
          <label>Vencimento (opcional)<input name="period_end" type="date" defaultValue={dayInput(subscription?.current_period_end ?? null)} aria-label="Vencimento" /></label>
          <label>Observação<input name="notes" maxLength={500} defaultValue={subscription?.notes ?? ""} /></label>
          <div className="flex gap-3"><button disabled={busy} className={actionClass}>Salvar assinatura</button><button type="button" onClick={() => setMode("none")}>Voltar</button></div>
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
          <p className="text-sm text-muted-foreground">Recebido fora do sistema (Pix, boleto, transferência). O pagamento estende o vencimento e reativa a assinatura.</p>
          <label>Valor (R$)<input name="amount" type="number" min={0} step="0.01" required defaultValue={((plans.find((p) => p.id === subscription?.plan_id)?.price_cents ?? 0) / 100).toFixed(2)} aria-label="Valor pago" /></label>
          <label>Período pago: de<input name="start" type="date" required aria-label="Início do período" /></label>
          <label>até<input name="end" type="date" required aria-label="Fim do período" /></label>
          <label>Forma<select name="method" defaultValue="pix" aria-label="Forma de pagamento da assinatura"><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select></label>
          <label>Observação<input name="note" maxLength={200} /></label>
          <div className="flex gap-3"><button disabled={busy} className={actionClass}>Confirmar pagamento</button><button type="button" onClick={() => setMode("none")}>Voltar</button></div>
        </form>
      )}
      {payments.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{payments.length} pagamento(s)</summary>
          {payments.map((p) => <p key={p.id}>{date(p.paid_at)} • {money(p.amount_cents)} • {p.period_start.split("-").reverse().join("/")} a {p.period_end.split("-").reverse().join("/")}{p.method ? ` • ${p.method}` : ""}{p.note ? ` • ${p.note}` : ""}</p>)}
        </details>
      )}
    </div>
  );
}
