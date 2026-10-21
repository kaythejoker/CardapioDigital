"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Store, X } from "lucide-react";
import {
  AdminShell,
  actionClass,
  fieldClass,
  ImageUpload,
  jsonRequest,
  panelClass,
  TeamForm,
} from "@/components/admin-ui";
import { PlansView, SubscriptionPanel, type Plan, type Subscription, type SubscriptionPayment } from "@/components/subscriptions";
import { STATUS_LABELS, type Access } from "@/lib/features";
import { DomainPanel } from "@/components/domains";
import { money } from "@/lib/menu-types";

type ResellerData = {
  reseller: {
    id: string;
    name: string;
    brand_name: string;
    logo_url: string | null;
    primary_color: string;
    domain: string | null;
    support_whatsapp?: string | null;
    support_email?: string | null;
    support_hours?: string | null;
    domain_status?: string | null;
    domain_error?: string | null;
  };
  domains_configured?: boolean;
  restaurants: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
    created_at: string;
  }[];
  /** Média de satisfação dos últimos 30 dias por restaurante. */
  ratings?: Record<string, { avg: number | null; responses: number }>;
  plans: Plan[];
  subscriptions: Subscription[];
  subscription_payments: SubscriptionPayment[];
  access: Record<string, Access | null>;
};
export function Reseller() {
  const [data, setData] = useState<ResellerData | null>(null);
  const [view, setView] = useState("restaurants");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await jsonRequest("/api/revenda"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    return () => clearTimeout(initial);
  }, [refresh]);
  const save = async (body: unknown) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await jsonRequest("/api/revenda", body);
      await refresh();
      setMessage("Alterações salvas");
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente");
      return null;
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <main className="p-8">
        <p>{error || "Carregando sua revenda…"}</p>
        <Link href="/app/login" className="mt-5 inline-block underline">
          Entrar
        </Link>
      </main>
    );
  const active = data.restaurants.filter((r) => r.status === "active").length;
  const statusOf = (id: string) => data.access?.[id]?.status ?? "ativa";
  const billing = data.restaurants.filter((r) => ["ativa", "teste", "atrasada"].includes(statusOf(r.id)));
  // Receita recorrente mensal: planos ativos (anual dividido por 12).
  const mrr = billing.reduce((sum, r) => {
    const plan = data.plans.find((p) => p.id === data.subscriptions.find((s) => s.restaurant_id === r.id)?.plan_id);
    return sum + (plan ? (plan.billing_period === "anual" ? Math.round(plan.price_cents / 12) : plan.price_cents) : 0);
  }, 0);
  const shown = data.restaurants.filter((r) => !statusFilter || statusOf(r.id) === statusFilter);
  return (
    <AdminShell
      brand={data.reseller}
      title={
        view === "brand"
          ? "Sua marca, em cada restaurante"
          : view === "plans"
            ? "Planos e módulos"
            : "Seus restaurantes"
      }
      active={view}
      onNavigate={(v) => {
        setView(v);
        setInvite(null);
      }}
      revenda
      support={data.reseller}
    >
      {error && (
        <p
          role="alert"
          className="mb-6 rounded-xl bg-destructive p-4 text-white"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mb-6 rounded-xl bg-[#2F7D5B]/10 p-4 text-[#2F7D5B]"
        >
          {message}
        </p>
      )}
      {view === "plans" && (
        <PlansView plans={data.plans} subscriptions={data.subscriptions} busy={busy} onSave={save} />
      )}
      {view === "restaurants" ? (
        <>
          <div className="reseller-stats mb-6 grid gap-4 sm:grid-cols-3">
            <section className={panelClass}>
              <p className="text-muted-foreground">Restaurantes ativos</p>
              <b className="mt-3 block font-heading text-4xl">{active}</b>
              <p className="mt-2 text-sm text-muted-foreground">
                {data.restaurants.filter((r) => statusOf(r.id) === "teste").length} em teste • {data.restaurants.filter((r) => ["atrasada", "suspensa"].includes(statusOf(r.id))).length} com pendência
              </p>
            </section>
            <section className={panelClass}>
              <p className="text-muted-foreground">Receita recorrente do mês</p>
              <b className="mt-3 block font-heading text-4xl">{money(mrr)}</b>
              <p className="mt-2 text-sm text-muted-foreground">Soma dos planos ativos e em teste</p>
            </section>
            <section className={panelClass}>
              <p className="text-muted-foreground">Total de restaurantes</p>
              <b className="mt-3 block font-heading text-4xl">
                {data.restaurants.length}
              </b>
              <select aria-label="Filtrar por status da assinatura" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="">Todos os status</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </section>
          </div>
          <form
            className={`${panelClass} mb-7`}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = new FormData(form);
              const result = await save({
                action: "create",
                name: values.get("name"),
                slug: values.get("slug"),
              });
              if (result) {
                form.reset();
                setInvite(result.data.id);
              }
            }}
          >
            <h3 className="mb-5 font-heading text-2xl">Novo restaurante</h3>
            <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
              <label>
                Nome
                <input
                  name="name"
                  required
                  maxLength={100}
                  className={fieldClass}
                />
              </label>
              <label>
                Endereço do cardápio
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  minLength={2}
                  maxLength={80}
                  placeholder="brasa-bistro"
                  className={fieldClass}
                />
              </label>
              <button disabled={busy} className={actionClass}>
                Criar restaurante
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Use letras minúsculas, números e hífens no endereço.
            </p>
          </form>
          {invite && (
            <section className="mb-7">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-heading text-xl">
                  Gestor de{" "}
                  {data.restaurants.find((r) => r.id === invite)?.name}
                </h3>
                <button
                  aria-label="Fechar convite"
                  onClick={() => setInvite(null)}
                >
                  <X />
                </button>
              </div>
              <TeamForm
                key={invite}
                restaurantId={invite}
                manager
                onSaved={() => void refresh()}
              />
            </section>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((r) => (
              <article key={r.id} className={`${panelClass} restaurant-card`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Store className="text-primary" />
                    <h3 className="font-heading text-2xl">{r.name}</h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${r.status === "active" ? "bg-[#2F7D5B]/10 text-[#2F7D5B]" : "bg-secondary text-muted-foreground"}`}
                  >
                    {r.status === "active" ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="my-4 text-sm text-muted-foreground">
                  /{r.slug}
                  {data.ratings?.[r.id]?.avg != null && (
                    <span className="ml-3" aria-label={`Satisfação ${data.ratings[r.id].avg} em 30 dias`}>
                      ★ {Number(data.ratings[r.id].avg).toFixed(1)} <small>({data.ratings[r.id].responses} em 30 dias)</small>
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <Link
                    href={`/app/gestor?restaurant_id=${r.id}`}
                    className="text-primary underline"
                  >
                    Gerenciar restaurante
                  </Link>
                  <button
                    onClick={() => setInvite(r.id)}
                    className="text-primary underline"
                  >
                    Convidar gestor
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void save({
                        action: "status",
                        id: r.id,
                        status: r.status === "active" ? "inactive" : "active",
                      })
                    }
                    className={
                      r.status === "active"
                        ? "text-destructive underline"
                        : "text-[#2F7D5B] underline"
                    }
                  >
                    {r.status === "active" ? "Desativar" : "Ativar"}
                  </button>
                </div>
                <SubscriptionPanel
                  restaurantId={r.id}
                  access={data.access?.[r.id] ?? undefined}
                  subscription={data.subscriptions.find((s) => s.restaurant_id === r.id)}
                  plans={data.plans}
                  payments={data.subscription_payments.filter((p) => p.subscription_id === data.subscriptions.find((s) => s.restaurant_id === r.id)?.id)}
                  busy={busy}
                  onSave={save}
                />
              </article>
            ))}
          </div>
        </>
      ) : view === "brand" ? (
        <div className="space-y-6">
          <BrandForm reseller={data.reseller} busy={busy} onSave={save} />
          <div className="max-w-2xl">
            <DomainPanel
              kind="reseller"
              domain={data.reseller.domain}
              status={data.reseller.domain_status ?? null}
              error={data.reseller.domain_error ?? null}
              configured={data.domains_configured ?? false}
              placeholder="cardapio.suamarca.com.br"
              onChanged={() => void refresh()}
            />
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
function BrandForm({
  reseller,
  busy,
  onSave,
}: {
  reseller: ResellerData["reseller"];
  busy: boolean;
  onSave: (body: unknown) => Promise<unknown>;
}) {
  const [logo, setLogo] = useState(reseller.logo_url);
  const [color, setColor] = useState(reseller.primary_color);
  return (
    <form
      className={`${panelClass} max-w-2xl space-y-5`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void onSave({
          action: "brand",
          name: form.get("name"),
          brand_name: form.get("brand_name"),
          domain: reseller.domain ?? "",
          primary_color: color,
          logo_url: logo,
          support_whatsapp: String(form.get("support_whatsapp") || "").replace(/[^\d+]/g, ""),
          support_email: form.get("support_email"),
          support_hours: form.get("support_hours"),
        });
      }}
    >
      <label className="block">
        Nome da revenda
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={reseller.name}
          className={fieldClass}
        />
      </label>
      <label className="block">
        Nome do produto
        <input
          name="brand_name"
          required
          maxLength={100}
          defaultValue={reseller.brand_name}
          className={fieldClass}
        />
      </label>
      <ImageUpload
        kind="reseller"
        id={reseller.id}
        value={logo}
        onChange={setLogo}
        label="Logo da marca"
      />
      <label className="block">
        Cor principal
        <div className="mt-3 flex items-center gap-4">
          <input
            type="color"
            aria-label="Cor principal"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-12 w-16"
          />
          <span>{color.toUpperCase()}</span>
        </div>
      </label>
      <fieldset className="space-y-4 rounded-2xl border p-4">
        <legend className="px-2 font-semibold">Suporte aos restaurantes</legend>
        <p className="text-sm text-muted-foreground">Aparece no botão Ajuda de todos os painéis dos seus restaurantes.</p>
        <label className="block">
          WhatsApp (com DDI e DDD, só números)
          <input name="support_whatsapp" inputMode="tel" placeholder="5511999999999" defaultValue={reseller.support_whatsapp ?? ""} className={fieldClass} aria-label="WhatsApp de suporte" />
        </label>
        <label className="block">
          E-mail de suporte
          <input name="support_email" type="email" defaultValue={reseller.support_email ?? ""} className={fieldClass} aria-label="E-mail de suporte" />
        </label>
        <label className="block">
          Horário de atendimento
          <input name="support_hours" maxLength={120} placeholder="Seg a sex, 9h às 18h" defaultValue={reseller.support_hours ?? ""} className={fieldClass} aria-label="Horário de atendimento" />
        </label>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        O nome, o logo e a cor aparecem em todos os restaurantes da revenda. O
        domínio é cadastrado abaixo, em &ldquo;Domínio da revenda&rdquo;.
      </p>
      <button disabled={busy} className={actionClass}>
        Salvar marca
      </button>
    </form>
  );
}
