"use client";
import { publicMenuUrl, restaurantBrand } from "@/lib/restaurant-brand";
import { MenuPhoto } from "@/components/menu-photo";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Ban, Clock3, GripVertical, PauseCircle, Settings2, Package, Plus, QrCode, ClipboardList, Banknote, Users, Clock, Bell, ChevronRight, ChefHat, Palette, UtensilsCrossed, Wine } from "lucide-react";
import {
  AdminShell,
  actionClass,
  fieldClass,
  ImageUpload,
  jsonRequest,
  panelClass,
  TeamForm,
} from "@/components/admin-ui";
import { AvailabilityFields, hhmm, ItemEditor, TranslationFields } from "@/components/item-editor";
import { type OperationData } from "@/components/operation";
import { money, PAYMENT_LABELS, type PaymentMethod, type TabTotals } from "@/lib/menu-types";
import { sortQueue, isLate, type QueueSettings } from "@/lib/priority";
import {
  ROLE_LABELS,
  type EffectivePermissions,
  type MemberRole,
  type Permissions,
} from "@/lib/permissions";
import { PermissionPicker, RolePicker } from "@/components/admin-ui";
import { HistoryView, ReportsView, SurveyView } from "@/components/reports";
import { AccessBanner } from "@/components/support";
import { DomainPanel } from "@/components/domains";
import { type Access, type Features } from "@/lib/features";
import { LOCALE_TAGS, msg, type Translations } from "@/lib/i18n";
import { shortTime } from "@/lib/availability";
import { useI18n } from "@/components/i18n";

type TeamMember = {
  user_id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Permissions;
  active: boolean;
};
type ManagementData = Omit<OperationData, "memberships" | "restaurant" | "can" | "roles"> & {
  restaurant: OperationData["restaurant"] & {
    logo_url: string | null;
    cover_url: string | null;
    resellers: OperationData["restaurant"]["resellers"] & { support_whatsapp?: string | null; support_email?: string | null; support_hours?: string | null };
    primary_color?: string | null;
    background_color?: string | null;
    service_fee_percent?: number | string;
    service_fee_optional?: boolean;
    survey_enabled?: boolean;
    google_review_url?: string | null;
    pin_required?: boolean;
    custom_domain?: string | null;
    custom_domain_status?: string | null;
    custom_domain_error?: string | null;
  };
  me: {
    user_id: string;
    is_manager: boolean;
    is_reseller: boolean;
    can: EffectivePermissions;
  };
  access: Access;
  menu_origin: { origin: string; short: boolean; kind: string };
  domains_configured: boolean;
  team: TeamMember[];
  stock_movements: StockMovement[];
  finance: FinanceData | null;
};
type FinanceData = {
  day_start: string;
  closed_tabs: {
    id: string;
    label: string;
    closed_at: string;
    discount_cents: number;
    discount_reason: string | null;
    totals: TabTotals | null;
  }[];
  payments: { id: string; tab_id: string; method: PaymentMethod; amount_cents: number; created_at: string; voided_at: string | null }[];
  closures: { id: string; day: string; closed_at: string; totals: Record<string, number | Record<string, number>>; note: string | null }[];
  open_tabs: number;
};
type StockMovement = {
  id: number;
  menu_item_id: string;
  kind: "entrada" | "venda" | "cancelamento" | "ajuste";
  quantity: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

/** Telas do painel que esta pessoa pode abrir, dentro dos módulos do plano. */
function allowedViews(me: ManagementData["me"], access?: Access) {
  const f = access?.features;
  const on = (view: string) => {
    const key = { stock: "stock", finance: "finance", reports: "reports", survey: "surveys" }[view] as keyof Features | undefined;
    return !key || !f || f[key] !== false;
  };
  const all = me.is_manager || me.is_reseller
    ? ["home", "menu", "stock", "finance", "reports", "history", "survey", "tables", "team", "settings"]
    : [
        ...(me.can.edit_menu ? ["menu"] : []),
        ...(me.can.manage_stock ? ["stock"] : []),
        ...(me.can.view_finance ? ["finance"] : []),
        ...(me.can.view_reports ? ["reports", "history", "survey"] : []),
      ];
  return all.filter(on);
}

export function Manager({ initialRestaurant }: { initialRestaurant?: string }) {
  const { t } = useI18n(); const tr = t;
  const [id, setId] = useState(initialRestaurant || "");
  const [memberships, setMemberships] = useState<
    { restaurant_id: string; restaurants: { name: string } }[]
  >([]);
  const [data, setData] = useState<ManagementData | null>(null);
  const [view, setView] = useState("home");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<string | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      let selected = id;
      if (!selected) {
        const auth = await jsonRequest("/api/auth");
        const members = auth.members.filter(
          (m: { manager_panel: boolean }) => m.manager_panel,
        );
        setMemberships(members);
        selected = members[0]?.restaurant_id;
        if (!selected)
          throw new Error(msg("Nenhum restaurante vinculado como gestor"));
        setId(selected);
      }
      const next: ManagementData = await jsonRequest(`/api/manage/${selected}`);
      setData(next);
      const views = allowedViews(next.me, next.access);
      setView((current) => (views.includes(current) ? current : views[0] ?? "menu"));
    } catch (e) {
      setError(e instanceof Error ? e.message : msg("Não foi possível carregar"));
    }
  }, [id]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const save = async (body: unknown) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await jsonRequest(`/api/manage/${id}`, body);
      await refresh();
      setMessage(msg("Alterações salvas"));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : msg("Tente novamente"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const reorder = async (
    kind: "categories" | "menu_items",
    from: string,
    to: string,
  ) => {
    if (!data || from === to) return;
    const rows = kind === "categories" ? data.categories : data.items;
    const ids = rows.map((r) => r.id);
    const index = ids.indexOf(from);
    const target = ids.indexOf(to);
    if (index < 0 || target < 0) return;
    ids.splice(index, 1);
    ids.splice(target, 0, from);
    await save({ action: "reorder", kind, ids });
  };
  if (!data)
    return (
      <main className="p-8">
        <p role="status">{error ? t(error) : t("Carregando seu restaurante…")}</p>
        <Link href="/app/login" className="mt-5 inline-block underline">{t("Entrar")}</Link>
      </main>
    );
  const previewTable = data.tables.find(t => t.active && data.tabs.some(tab => tab.table_id === t.id)) || data.tables.find(t => t.active);
  const views = allowedViews(data.me, data.access);
  const support = data.restaurant.resellers;
  const languagesOn = data.access?.features?.languages !== false;
  const blocksOn = data.access?.features?.order_blocks !== false;
  const canBlock = blocksOn && !!data.me.can.block_orders;
  const paused = blocksOn && !!data.restaurant.orders_paused;
  const titles: Record<string, string> = {
    home: msg("Visão geral"),
    menu: msg("Seu cardápio"),
    stock: msg("Estoque"),
    finance: msg("Financeiro"),
    reports: msg("Relatórios"),
    history: msg("Histórico"),
    survey: msg("Satisfação"),
    tables: msg("Mesas e QR"),
    team: msg("Sua equipe"),
    settings: msg("Configurações"),
  };
  return (
    <AdminShell
      brand={restaurantBrand(data.restaurant)}
      title={t(titles[view])}
      restaurant={{...data.restaurant, menuUrl: previewTable ? publicMenuUrl(data.restaurant.slug, previewTable.qr_token, data.menu_origin) : undefined}}
      views={views}
      support={support}
      features={data.access?.features}
      active={view}
      onNavigate={(next) => {
        setView(next);
        setEditor(null);
        setError("");
        setMessage("");
      }}
    >
      {memberships.length > 1 && (
        <select
          aria-label={t("Restaurante")}
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setData(null);
            setEditor(null);
          }}
          className={`${fieldClass} mb-6 max-w-sm`}
        >
          {memberships.map((m) => (
            <option key={m.restaurant_id} value={m.restaurant_id}>
              {m.restaurants.name}
            </option>
          ))}
        </select>
      )}
      <AccessBanner access={data.access} support={support} />
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-destructive p-4 text-white"
        >
          {t(error)}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-[#2F7D5B]/10 p-4 text-[#2F7D5B]"
        >
          {t(message)}
        </p>
      )}
      {paused && (
        <p role="status" className="paused-banner mb-5 rounded-xl">
          <PauseCircle size={18} />
          <span>
            <b>{t("Pedidos pelo cardápio pausados.")}</b>
            {data.restaurant.orders_paused_reason && ` ${data.restaurant.orders_paused_reason}`}
          </span>
          {canBlock && (
            <button disabled={busy} onClick={() => void save({ action: "pause_orders", paused: false })}>
              {t("Retomar")}
            </button>
          )}
        </p>
      )}
      {view === "home" && (
        <Dashboard data={data} busy={busy} onNavigate={setView} onMode={(mode) => void save({ action: "settings", data: { ...data.settings, mode } })} />
      )}
      {view === "menu" &&
        (editor !== null ? (
          <ItemEditor
            key={editor}
            restaurantId={id}
            categories={data.categories}
            item={data.items.find((i) => i.id === editor) ?? null}
            categoryStation={(categoryId) => data.categories.find((c) => c.id === categoryId)?.station ?? "cozinha"}
            languages={languagesOn}
            blocks={blocksOn}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              void refresh();
              setMessage(msg("Item salvo"));
            }}
          />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <p className="text-muted-foreground">{t("Arraste para ordenar ou use as setas.")}</p>
              {canBlock && !paused && (
                <PauseButton busy={busy} onPause={(reason) => save({ action: "pause_orders", paused: true, reason })} />
              )}
              <button
                className={actionClass}
                disabled={!data.categories.length}
                onClick={() => setEditor("new")}
              >
                <Plus className="mr-2 inline" size={18} />{t("Novo item")}</button>
            </div>
            <form
              className={`${panelClass} mb-6 flex flex-wrap items-end gap-4`}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const values = new FormData(form);
                void save({
                  action: "category",
                  name: values.get("name"),
                  active: true,
                  position: data.categories.length,
                  station: values.get("station") || "cozinha",
                }).then((ok) => {
                  if (ok) form.reset();
                });
              }}
            >
              <label className="flex-1">{t("Nova categoria")}<input
                  name="name"
                  required
                  maxLength={100}
                  className={fieldClass}
                />
              </label>
              <label>{t("Setor")}<select name="station" defaultValue="cozinha" className={fieldClass}>
                  <option value="cozinha">{t("Cozinha")}</option>
                  <option value="bar">{t("Bar")}</option>
                </select>
              </label>
              <button className={actionClass} disabled={busy}>{t("Adicionar categoria")}</button>
            </form>
            <div className="space-y-6">
              {data.categories.map((c, index) => (
                <section key={c.id} className={`${panelClass} catalog-category`}>
                  <CategoryForm
                    category={c}
                    first={index === 0}
                    last={index === data.categories.length - 1}
                    busy={busy}
                    languages={languagesOn}
                    blocks={blocksOn}
                    onSave={save}
                    onMove={(to) => void reorder("categories", c.id, data.categories[index + to].id)}
                    onDropCategory={(from) => void reorder("categories", from, c.id)}
                  />
                  <div className="space-y-2">
                    {data.items
                      .filter((i) => i.category_id === c.id)
                      .map((item, index, items) => (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData("item", item.id)
                          }
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            void reorder(
                              "menu_items",
                              e.dataTransfer.getData("item"),
                              item.id,
                            );
                          }}
                          className="catalog-item flex flex-wrap items-center gap-3 rounded-xl border p-3"
                        >
                          <GripVertical
                            size={16}
                            className="text-muted-foreground"
                          />
                          {item.photo_url && (
                            <MenuPhoto slug={data.restaurant.slug}
                              src={item.photo_url}
                              alt={item.name}
                              width={56}
                              height={56}
                              className="h-14 rounded-xl object-cover"
                            />
                          )}
                          <div className="flex-1">
                            <h3 className="font-semibold">{item.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {money(item.price_cents)} • {t("{n} min", { n: item.prep_minutes })}{item.sold_out && ` • ${t("Esgotado")}`}
                            </p>
                            {blocksOn && (item.blocked || item.available_from) && (
                              <p className="catalog-flags">
                                {item.blocked && <span className="blocked"><Ban size={12} /> {t("Bloqueado")}{item.blocked_reason ? `: ${item.blocked_reason}` : ""}</span>}
                                {item.available_from && item.available_until && <span><Clock3 size={12} /> {shortTime(item.available_from)}–{shortTime(item.available_until)}</span>}
                              </p>
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              aria-label={t("Ativo: {name}", { name: item.name })}
                              checked={item.active}
                              disabled={busy}
                              onChange={(e) =>
                                void save({
                                  action: "toggle_item",
                                  id: item.id,
                                  active: e.target.checked,
                                })
                              }
                            />{t("Ativo")}</label>
                          <button
                            className="rounded-xl border px-3 py-2 text-sm"
                            onClick={() => setEditor(item.id)}
                          >{t("Editar")}</button>
                          <button
                            aria-label={t("Subir item {name}", { name: item.name })}
                            disabled={index === 0 || busy}
                            onClick={() =>
                              void reorder(
                                "menu_items",
                                item.id,
                                items[index - 1].id,
                              )
                            }
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            aria-label={t("Descer item {name}", { name: item.name })}
                            disabled={index === items.length - 1 || busy}
                            onClick={() =>
                              void reorder(
                                "menu_items",
                                item.id,
                                items[index + 1].id,
                              )
                            }
                          >
                            <ArrowDown size={16} />
                          </button>
                        </div>
                      ))}
                  </div>
                  {!data.items.some((i) => i.category_id === c.id) && (
                    <p className="py-4 text-sm text-muted-foreground">{t("Ainda não há itens nesta categoria.")}</p>
                  )}
                </section>
              ))}
            </div>
          </>
        ))}
      {view === "stock" && (
        <StockView data={data} busy={busy} onSave={save} onEdit={(itemId) => { setView("menu"); setEditor(itemId); }} />
      )}
      {view === "finance" && data.finance && (
        <FinanceView data={data} finance={data.finance} busy={busy} onSave={save} />
      )}
      {view === "reports" && <ReportsView restaurantId={id} />}
      {view === "history" && <HistoryView restaurantId={id} canViewReports={data.me.can.view_reports} />}
      {view === "survey" && <SurveyView restaurantId={id} />}
      {view === "tables" && (
        <>
          <div className="mb-6 flex flex-wrap justify-between gap-4">
            <p className="text-muted-foreground">{t("O QR é fixo e pode ser impresso uma vez.")}</p>
            <a href={`/api/qr/${id}`} className={actionClass}>
              <QrCode size={18} className="mr-2 inline" />{t("Baixar todos em PDF")}</a>
          </div>
          <form
            className={`${panelClass} mb-6 flex items-end gap-4`}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void save({
                action: "table",
                label: new FormData(form).get("label"),
                active: true,
              }).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <label className="flex-1">{t("Nova mesa")}<input
                name="label"
                required
                maxLength={40}
                className={fieldClass}
              />
            </label>
            <button className={actionClass} disabled={busy}>{t("Adicionar mesa")}</button>
          </form>
          <div className="table-settings-grid grid gap-4 md:grid-cols-2">
            {data.tables
              .toSorted((a, b) =>
                a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
              )
              .map((t) => (
                <form
                  key={t.id}
                  className={`${panelClass} table-settings-card`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    void save({
                      action: "table",
                      id: t.id,
                      label: values.get("label"),
                      active: values.get("active") === "on",
                    });
                  }}
                >
                  <div className="table-settings-heading"><span><QrCode size={20} /></span><strong>{tr("Mesa {label}", { label: t.label })}</strong><small>{t.active ? tr("QR disponível") : tr("Mesa inativa")}</small></div>
                  <label>{tr("Nome da mesa")}<input
                      name="label"
                      defaultValue={t.label}
                      required
                      maxLength={40}
                      className={fieldClass}
                    />
                  </label>
                  <div className="my-4 flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={t.active}
                        key={String(t.active)}
                      />{tr("Ativa")}</label>
                    <button
                      disabled={busy}
                      className="rounded-xl border px-4 py-2"
                    >{tr("Salvar mesa")}</button>
                  </div>
                  {t.active && (
                    <div className="flex gap-4 text-sm text-primary">
                      <a href={`/api/qr/${id}?table_id=${t.id}`}>{tr("Baixar QR em PDF")}</a>
                      <Link
                        href={publicMenuUrl(data.restaurant.slug, t.qr_token, data.menu_origin)}
                        target="_blank"
                      >{tr("Abrir cardápio")}</Link>
                    </div>
                  )}
                </form>
              ))}
          </div>
        </>
      )}
      {view === "team" && (
        <div className="grid items-start gap-6 xl:grid-cols-[1fr_360px]">
          <section className={panelClass}>
            <h3 className="mb-6 font-heading text-2xl">{t("Pessoas com acesso")}</h3>
            <div className="space-y-5">
              {data.team.map((person) => {
                const isManager = person.roles.includes("manager");
                const editable =
                  person.user_id !== data.me.user_id &&
                  (data.me.is_reseller || !isManager);
                return (
                  <article
                    key={person.user_id}
                    className={`team-member border-b pb-4 ${person.active ? "" : "opacity-60"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <b>{person.name || person.email}</b>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {person.email} •{" "}
                          {person.roles
                            .map((r) => (ROLE_LABELS[r as MemberRole] ? t(ROLE_LABELS[r as MemberRole]) : r))
                            .join(", ")}
                          {!person.active && ` • ${t("Desligado")}`}
                        </p>
                      </div>
                      {editable && (
                        <div className="flex flex-wrap gap-3">
                          <button
                            className="rounded-xl border px-3 py-2 text-sm"
                            aria-label={t("Editar acesso de {name}", { name: person.name || person.email })}
                            onClick={() => {
                              setEditingMember(
                                editingMember === person.user_id ? null : person.user_id,
                              );
                              setRemove(null);
                            }}
                          >
                            {editingMember === person.user_id ? t("Fechar") : t("Editar")}
                          </button>
                          {remove === person.user_id ? (
                            <>
                              <button
                                disabled={busy}
                                className="text-sm text-destructive"
                                onClick={() =>
                                  void save({
                                    action: "remove_member",
                                    user_id: person.user_id,
                                  }).then((ok) => {
                                    if (ok) setRemove(null);
                                  })
                                }
                              >{t("Confirmar remoção")}</button>
                              <button className="text-sm" onClick={() => setRemove(null)}>{t("Voltar")}</button>
                            </>
                          ) : (
                            <button
                              className="text-sm text-destructive underline"
                              onClick={() => {
                                setRemove(person.user_id);
                                setEditingMember(null);
                              }}
                            >{t("Remover acesso")}</button>
                          )}
                        </div>
                      )}
                    </div>
                    {editingMember === person.user_id && (
                      <MemberEditor
                        key={person.user_id}
                        person={person}
                        canSetManager={data.me.is_reseller}
                        busy={busy}
                        onSave={(member) =>
                          save({ action: "member", data: member }).then((ok) => {
                            if (ok) setEditingMember(null);
                            return ok;
                          })
                        }
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          <TeamForm restaurantId={id} onSaved={() => void refresh()} />
        </div>
      )}
      {view === "settings" && (
        <>
          <SettingsForm
            key={id}
            restaurantId={id}
            restaurant={data.restaurant}
            settings={data.settings}
            onSave={save}
            busy={busy}
          />
          {(data.access?.features?.custom_domain !== false || data.me.is_reseller) && (
            <div className="mt-6">
              <DomainPanel
                kind="restaurant"
                restaurantId={id}
                domain={data.restaurant.custom_domain ?? null}
                status={data.restaurant.custom_domain_status ?? null}
                error={data.restaurant.custom_domain_error ?? null}
                configured={data.domains_configured}
                placeholder="cardapio.seurestaurante.com.br"
                onChanged={() => void refresh()}
              />
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}


function Dashboard({ data, busy, onNavigate, onMode }: {
  data: ManagementData; busy: boolean; onNavigate: (view: string) => void;
  onMode: (mode: QueueSettings["mode"]) => void;
}) {
  const { t } = useI18n();
  const tr = t;
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now()); const initial = setTimeout(tick, 0); const timer = setInterval(tick, 30000); return () => { clearTimeout(initial); clearInterval(timer); }; }, []);
  const orders = data.orders.filter(o => o.status !== "cancelado");
  const total = orders.reduce((sum, o) => sum + o.total_cents, 0);
  const finished = orders.filter(o => o.ready_at && o.started_at);
  const prep = finished.length ? Math.round(finished.reduce((sum, o) => sum + (Date.parse(o.ready_at!) - Date.parse(o.started_at!)) / 60000, 0) / finished.length) : 0;
  const tables = data.tables.filter(t => t.active).toSorted((a,b) => a.label.localeCompare(b.label,"pt-BR",{numeric:true}));
  const occupiedBy = (tableId: string) => data.tabs.find(tab => tab.table_id === tableId) ?? data.tabs.find(tab => (data.tab_tables ?? []).some(tt => tt.tab_id === tab.id && tt.table_id === tableId));
  const occupied = tables.filter(t => occupiedBy(t.id)).length;
  const hourFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" });
  const orderHours = orders.map(o => Number(hourFormat.format(new Date(o.created_at))));
  const first = Math.min(10, ...orderHours), last = Math.max(22, ...orderHours);
  const hours = Array.from({length: last - first + 1}, (_, i) => ({hour: i + first, count: orderHours.filter(h => h === i + first).length}));
  const maximum = Math.max(4, Math.ceil(Math.max(...hours.map(h => h.count)) / 4) * 4);
  const most = new Map<string, {name: string; quantity: number; photo: string | null; price: number}>();
  for (const order of orders) for (const item of order.order_items) {
    const current = most.get(item.name_snapshot) || {name: item.name_snapshot, quantity: 0, photo: data.items.find(i => i.name === item.name_snapshot)?.photo_url ?? null, price: item.unit_price_cents};
    current.quantity += item.quantity; most.set(current.name, current);
  }
  const units = [...most.values()].reduce((sum, i) => sum + i.quantity, 0);
  const queue = sortQueue(orders.filter(o => ["recebido", "em_preparo"].includes(o.status) && (o.station ?? "cozinha") === "cozinha"), data.settings, now);
  const hasBar = data.categories.some(c => c.station === "bar") || data.items.some(i => i.station === "bar");
  const barQueue = sortQueue(orders.filter(o => ["recebido", "em_preparo"].includes(o.status) && o.station === "bar"), data.settings, now);
  const stats = [
    {label: t("Pedidos hoje"), value: String(orders.length), icon: ClipboardList, detail: t("Pedidos recebidos hoje")},
    {label: t("Ticket médio"), value: money(orders.length ? Math.round(total / orders.length) : 0), icon: Banknote, detail: t("Valor médio por pedido")},
    {label: t("Mesas ocupadas"), value: String(occupied), suffix: t("de {n}", { n: tables.length }), icon: Users, detail: t("Ocupação do salão")},
    {label: t("Tempo médio de preparo"), value: finished.length ? t("{n} min", { n: prep }) : "—", icon: Clock, detail: finished.length ? t("Do início até ficar pronto") : t("Aguardando pedidos preparados")},
  ];
  return <div className="manager-dashboard">
    <div className="dashboard-quicklinks"><button onClick={() => onNavigate("settings")}><Palette size={21}/><span><strong>{t("Personalizar cardápio")}</strong><small>{t("Nome, banner, logo e cores")}</small></span><ChevronRight size={18}/></button><button onClick={() => onNavigate("menu")}><UtensilsCrossed size={21}/><span><strong>{t("Editar cardápio")}</strong><small>{t("Pratos, preços e categorias")}</small></span><ChevronRight size={18}/></button><button onClick={() => onNavigate("tables")}><QrCode size={21}/><span><strong>{t("QR codes das mesas")}</strong><small>{t("Gerencie e imprima seus códigos")}</small></span><ChevronRight size={18}/></button></div>
    <div className="dashboard-stats">{stats.map((stat, index) => <article className="stat-card" key={stat.label}><span className={"stat-icon " + (index === 1 ? "green" : "")}><stat.icon size={25}/></span><div><p>{stat.label}</p><strong>{stat.value} {stat.suffix && <small>{stat.suffix}</small>}</strong><span className="stat-detail">{stat.detail}</span>{index === 2 && <span className="occupancy-track"><span style={{width: (tables.length ? occupied / tables.length * 100 : 0) + "%"}}/></span>}</div></article>)}</div>
    <div className="dashboard-columns">
      <section className="dashboard-panel hourly-panel"><header><h3>{t("Pedidos por hora")}</h3><span className="today-label">{t("Hoje")}</span></header><div className="hourly-chart" role="img" aria-label={hours.map(h => t("{hour}h: {n} pedidos", { hour: h.hour, n: h.count })).join(", ")}><div className="chart-scale">{[4,3,2,1,0].map(n => <span key={n}>{maximum * n / 4}</span>)}</div><div className="chart-plot"><div className="chart-grid">{[0,1,2,3,4].map(n => <i key={n}/>)}</div><div className="chart-bars">{hours.map(h => <div className="chart-column" key={h.hour}><span className="chart-bar" title={t("{n} pedidos", { n: h.count })} style={{height: (h.count / maximum * 100) + "%", minHeight: h.count ? 4 : 0}}/><small>{h.hour}h</small></div>)}</div></div></div>{!orders.length && <p className="chart-empty">{t("Os pedidos de hoje aparecerão no gráfico.")}</p>}</section>
      <section className="dashboard-panel best-panel"><header><h3>{t("Mais pedidos hoje")}</h3></header><div className="best-items">{[...most.values()].toSorted((a,b) => b.quantity-a.quantity).slice(0,3).map(item => <div className="best-item" key={item.name}>{item.photo ? <MenuPhoto slug={data.restaurant.slug} src={item.photo} alt={item.name} width={52} height={52}/> : <span className="food-placeholder"><ChefHat/></span>}<div><strong>{item.name}</strong><small>{t("{n} unidades", { n: item.quantity })} <span>• {t("{pct}% do total", { pct: Math.round(item.quantity / units * 100) })}</span></small></div><b>{money(item.price)}</b></div>)}{!most.size && <div className="dashboard-empty"><ChefHat size={32}/><p>{t("Os favoritos da casa aparecem aqui após os primeiros pedidos.")}</p></div>}</div><button className="panel-link" onClick={() => onNavigate("menu")}>{t("Ver cardápio")}{" "}<ChevronRight size={15}/></button></section>
      <section className="dashboard-panel queue-panel"><header><h3><ChefHat size={23}/>{" "}{t("Fila da cozinha")}</h3><Link href="/app/cozinha">{t("Ver cozinha")}{" "}<ChevronRight size={15}/></Link></header><div className="queue-controls"><span>{t("Ordem de exibição")}</span><div className="queue-segments">{([ ["fifo", "FIFO"], ["complexity", msg("Complexidade")], ["balanced", msg("Equilibrado")] ] as const).map(([mode,label]) => <button key={mode} disabled={busy} aria-pressed={data.settings.mode === mode} onClick={() => onMode(mode)}>{t(label)}</button>)}</div></div><div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>#</th><th>{t("Mesa")}</th><th>{t("Itens")}</th><th>{t("Tempo")}</th><th>{t("Status")}</th></tr></thead><tbody>{queue.slice(0,4).map((o,index) => {const late = now > 0 && isLate(o, now); return <tr key={o.id}><td>{index + 1}</td><td>{tables.find(t => t.id === data.tabs.find(tab => tab.id === o.tab_id)?.table_id)?.label || "—"}</td><td>{o.order_items.reduce((sum,i) => sum+i.quantity,0)}</td><td>{t("{n} min", { n: now ? Math.max(0,Math.floor((now-Date.parse(o.created_at))/60000)) : 0 })}</td><td><span className={"order-badge " + (late ? "late" : o.status === "em_preparo" ? "cooking" : "waiting")}>{late ? t("Atrasado") : o.status === "em_preparo" ? t("Em preparo") : t("Aguardando")}</span></td></tr>})}</tbody></table>{!queue.length && <div className="dashboard-empty compact"><ChefHat size={28}/><p>{t("Tudo em dia na cozinha.")}<br/>{t("Os novos pedidos aparecem aqui.")}</p></div>}</div></section>
      {hasBar && <section className="dashboard-panel queue-panel"><header><h3><Wine size={23}/>{" "}{t("Fila do bar")}</h3><Link href="/app/bar">{t("Ver bar")}{" "}<ChevronRight size={15}/></Link></header><div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>#</th><th>{t("Mesa")}</th><th>{t("Itens")}</th><th>{t("Tempo")}</th><th>{t("Status")}</th></tr></thead><tbody>{barQueue.slice(0,4).map((o,index) => {const late = now > 0 && isLate(o, now); return <tr key={o.id}><td>{index + 1}</td><td>{tables.find(t => t.id === data.tabs.find(tab => tab.id === o.tab_id)?.table_id)?.label || "—"}</td><td>{o.order_items.reduce((sum,i) => sum+i.quantity,0)}</td><td>{t("{n} min", { n: now ? Math.max(0,Math.floor((now-Date.parse(o.created_at))/60000)) : 0 })}</td><td><span className={"order-badge " + (late ? "late" : o.status === "em_preparo" ? "cooking" : "waiting")}>{late ? t("Atrasado") : o.status === "em_preparo" ? t("Em preparo") : t("Aguardando")}</span></td></tr>})}</tbody></table>{!barQueue.length && <div className="dashboard-empty compact"><Wine size={28}/><p>{t("Tudo em dia no bar.")}<br/>{t("Os novos pedidos aparecem aqui.")}</p></div>}</div></section>}
      <section className="dashboard-panel tables-panel"><header><h3>{t("Status das mesas")}</h3></header><div className="table-legend"><span><i/>{t("Livres")}</span><span><i/>{t("Ocupadas")}</span><span><i/>{t("Com pedido pronto")}</span></div><div className="dashboard-tables">{tables.map(t => { const tab = occupiedBy(t.id); const ready = orders.some(o => o.tab_id === tab?.id && o.status === "pronto"); return <button key={t.id} onClick={() => onNavigate("tables")} aria-label={ready ? tr("Mesa {label}, pedido pronto", { label: t.label }) : tab ? tr("Mesa {label}, ocupada", { label: t.label }) : tr("Mesa {label}, livre", { label: t.label })} className={ready ? "ready" : tab ? "occupied" : "free"}>{t.label}{ready && <Bell size={14}/>}</button>; })}</div><button className="panel-link" onClick={() => onNavigate("tables")}>{t("Ver todas as mesas")}{" "}<ChevronRight size={15}/></button></section>
    </div>
  </div>;
}

function FinanceView({
  data,
  finance,
  busy,
  onSave,
}: {
  data: ManagementData;
  finance: FinanceData;
  busy: boolean;
  onSave: (body: unknown) => Promise<boolean>;
}) {
  const { locale, t } = useI18n();
  const [closingDay, setClosingDay] = useState(false);
  const activePayments = finance.payments.filter((p) => !p.voided_at);
  const received = activePayments.reduce((sum, p) => sum + p.amount_cents, 0);
  const byMethod = (Object.keys(PAYMENT_LABELS) as PaymentMethod[])
    .map((m) => ({ method: m, cents: activePayments.filter((p) => p.method === m).reduce((s, p) => s + p.amount_cents, 0) }))
    .filter((m) => m.cents > 0);
  const sold = data.orders.filter((o) => o.status !== "cancelado").reduce((sum, o) => sum + o.total_cents, 0);
  const cancelled = data.orders.flatMap((o) => o.order_items).filter((i) => i.cancelled_at).reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
  const fees = finance.closed_tabs.reduce((sum, t) => sum + (t.totals?.fee_cents ?? 0), 0);
  const discounts = finance.closed_tabs.reduce((sum, t) => sum + t.discount_cents, 0);
  const today = finance.day_start.slice(0, 10);
  const closedToday = finance.closures.some((c) => c.day === today);
  const when = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE_TAGS[locale], { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const dayLabel = (day: string) => new Date(day + "T12:00:00-03:00").toLocaleDateString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
  const methods = (list: { method: string; cents: number }[], sep: string) =>
    list.map((m) => `${PAYMENT_LABELS[m.method as PaymentMethod] ? t(PAYMENT_LABELS[m.method as PaymentMethod]) : m.method} ${money(m.cents)}`).join(sep);
  const stats = [
    { label: t("Vendido hoje"), value: money(sold), detail: t("{n} pedidos", { n: data.orders.filter((o) => o.status !== "cancelado").length }), icon: ClipboardList },
    { label: t("Recebido hoje"), value: money(received), detail: methods(byMethod, " • ") || t("Nenhum pagamento"), icon: Banknote, green: true },
    { label: t("Taxa de serviço"), value: money(fees), detail: t("Nas comandas fechadas hoje"), icon: Users },
    { label: t("Descontos e cancelados"), value: money(discounts + cancelled), detail: t("{discount} de desconto • {cancelled} cancelados", { discount: money(discounts), cancelled: money(cancelled) }), icon: Bell },
  ];
  return (
    <div className="finance-view space-y-6">
      <div className="dashboard-stats">{stats.map((stat) => <article className="stat-card" key={stat.label}><span className={"stat-icon " + (stat.green ? "green" : "")}><stat.icon size={25} /></span><div><p>{stat.label}</p><strong>{stat.value}</strong><span className="stat-detail">{stat.detail}</span></div></article>)}</div>
      <section className={panelClass}>
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-heading text-2xl">{t("Comandas fechadas hoje")}</h3>
          <span className="text-sm text-muted-foreground">{finance.open_tabs === 1 ? t("1 comanda aberta agora") : t("{n} comandas abertas agora", { n: finance.open_tabs })}</span>
        </header>
        <div className="queue-table-wrap">
          <table className="queue-table">
            <thead><tr><th>{t("Mesa")}</th><th>{t("Fechada")}</th><th>{t("Itens")}</th><th>{t("Taxa")}</th><th>{t("Desconto")}</th><th>{t("Total")}</th><th>{t("Pago")}</th></tr></thead>
            <tbody>
              {finance.closed_tabs.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>{when(t.closed_at)}</td>
                  <td>{money(t.totals?.items_cents ?? 0)}</td>
                  <td>{money(t.totals?.fee_cents ?? 0)}</td>
                  <td>{t.discount_cents ? `${money(t.discount_cents)}${t.discount_reason ? ` (${t.discount_reason})` : ""}` : "—"}</td>
                  <td>{money(t.totals?.due_cents ?? 0)}</td>
                  <td>{money(t.totals?.paid_cents ?? 0)}</td>
                </tr>
              ))}
              {!finance.closed_tabs.length && <tr><td colSpan={7}>{t("Nenhuma comanda fechada hoje.")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className={panelClass}>
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-heading text-2xl">{t("Fechamento do dia")}</h3>
          {closedToday ? (
            <span className="rounded-full bg-[#2F7D5B]/10 px-3 py-1 text-sm text-[#2F7D5B]">{t("Hoje já fechado")}</span>
          ) : (
            <button className={actionClass} disabled={busy} onClick={() => setClosingDay(true)}>{t("Fechar o dia")}</button>
          )}
        </header>
        {closingDay && !closedToday && (
          <form
            className="mb-5 space-y-3 rounded-2xl bg-secondary/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const note = String(new FormData(e.currentTarget).get("note") || "");
              void onSave({ action: "close_day", note: note || undefined }).then((ok) => { if (ok) setClosingDay(false); });
            }}
          >
            <p className="text-sm">{t("Confere o resumo: {sold} vendidos, {received} recebidos{methods}, {fees} de taxa e {discounts} de descontos.", { sold: money(sold), received: money(received), methods: byMethod.length ? ` (${methods(byMethod, ", ")})` : "", fees: money(fees), discounts: money(discounts) })}{finance.open_tabs > 0 && ` ${t("{n} comanda(s) ainda aberta(s) ficam como pendência.", { n: finance.open_tabs })}`}
            </p>
            <label className="block text-sm">{t("Observação")}<input name="note" maxLength={500} className={fieldClass} placeholder={t("Ex.: caixa conferido pelo gerente")} /></label>
            <div className="flex gap-3"><button className={actionClass} disabled={busy}>{t("Confirmar fechamento do dia")}</button><button type="button" onClick={() => setClosingDay(false)}>{t("Voltar")}</button></div>
          </form>
        )}
        <div className="queue-table-wrap">
          <table className="queue-table">
            <thead><tr><th>{t("Dia")}</th><th>{t("Comandas")}</th><th>{t("Vendido")}</th><th>{t("Recebido")}</th><th>{t("Por forma")}</th><th>{t("Observação")}</th></tr></thead>
            <tbody>
              {finance.closures.map((c) => {
                const t = c.totals as { tabs_closed?: number; items_cents?: number; payments_cents?: number; by_method?: Record<string, number> };
                return (
                  <tr key={c.id}>
                    <td>{dayLabel(c.day)}</td>
                    <td>{t.tabs_closed ?? 0}</td>
                    <td>{money(t.items_cents ?? 0)}</td>
                    <td>{money(t.payments_cents ?? 0)}</td>
                    <td>{methods(Object.entries(t.by_method ?? {}).map(([method, cents]) => ({ method, cents })), " • ") || "—"}</td>
                    <td>{c.note ?? ""}</td>
                  </tr>
                );
              })}
              {!finance.closures.length && <tr><td colSpan={6}>{t("Nenhum dia fechado ainda.")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const MOVEMENT_LABELS: Record<StockMovement["kind"], string> = {
  entrada: msg("Entrada"),
  venda: msg("Venda"),
  cancelamento: msg("Cancelamento"),
  ajuste: msg("Ajuste"),
};

function StockView({
  data,
  busy,
  onSave,
  onEdit,
}: {
  data: ManagementData;
  busy: boolean;
  onSave: (body: unknown) => Promise<boolean>;
  onEdit: (itemId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState<{ id: string; kind: "entrada" | "ajuste" } | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const items = data.items
    .filter((i) => i.stock_enabled)
    .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const low = items.filter((i) => (i.stock_quantity ?? 0) <= (i.low_stock_threshold ?? 0));
  const when = (iso: string) =>
    new Date(iso).toLocaleString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="stock-view space-y-6">
      <div className="dashboard-stats">
        <article className="stat-card"><span className="stat-icon"><Package size={25} /></span><div><p>{t("Itens com estoque")}</p><strong>{items.length}</strong><span className="stat-detail">{t("Controlados por quantidade")}</span></div></article>
        <article className="stat-card"><span className={"stat-icon " + (low.length ? "warn" : "green")}><Bell size={25} /></span><div><p>{t("Estoque baixo")}</p><strong>{low.length}</strong><span className="stat-detail">{low.length ? low.map((i) => i.name).slice(0, 3).join(", ") : t("Nenhum alerta")}</span></div></article>
        <article className="stat-card"><span className="stat-icon"><ClipboardList size={25} /></span><div><p>{t("Esgotados")}</p><strong>{items.filter((i) => i.sold_out).length}</strong><span className="stat-detail">{t("Fora do cardápio até repor")}</span></div></article>
      </div>
      {!items.length && (
        <section className={panelClass}>
          <p className="text-muted-foreground">{t("Nenhum item controla estoque ainda. Ligue “Controlar estoque” ao editar um item do cardápio.")}</p>
        </section>
      )}
      {items.map((item) => {
        const movements = data.stock_movements.filter((m) => m.menu_item_id === item.id);
        const isLow = (item.stock_quantity ?? 0) <= (item.low_stock_threshold ?? 0);
        return (
          <section key={item.id} className={`${panelClass} stock-item`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {item.photo_url ? (
                  <MenuPhoto slug={data.restaurant.slug} src={item.photo_url} alt={item.name} width={52} height={52} className="rounded-xl object-cover" />
                ) : (
                  <span className="food-placeholder"><ChefHat /></span>
                )}
                <div>
                  <h3 className="font-heading text-xl">{item.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {item.sold_out ? t("Esgotado") : t("Disponível")} • {t("avisa com {n} ou menos", { n: item.low_stock_threshold ?? 0 })}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`stock-balance ${item.stock_quantity === 0 ? "empty" : isLow ? "low" : ""}`} aria-label={t("Saldo de {name}", { name: item.name })}>
                  <strong>{item.stock_quantity}</strong>
                  <small>{item.stock_quantity === 0 ? t("esgotado") : isLow ? t("estoque baixo") : t("unidades")}</small>
                </span>
                <button className={actionClass} disabled={busy} onClick={() => setOpen({ id: item.id, kind: "entrada" })}>{t("Repor")}</button>
                <button className="rounded-xl border px-4 py-3" disabled={busy} onClick={() => setOpen({ id: item.id, kind: "ajuste" })}>{t("Ajustar")}</button>
                <button className="text-sm underline" onClick={() => setHistory(history === item.id ? null : item.id)}>
                  {history === item.id ? t("Ocultar histórico") : t("Histórico")}
                </button>
                <button className="text-sm underline" onClick={() => onEdit(item.id)}>{t("Editar item")}</button>
              </div>
            </div>
            {open?.id === item.id && (
              <form
                className="mt-4 flex flex-wrap items-end gap-4 rounded-2xl bg-secondary/60 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void onSave({
                    action: "stock",
                    data: { item_id: item.id, kind: open.kind, quantity: Number(f.get("quantity")), note: f.get("note") || undefined },
                  }).then((ok) => { if (ok) setOpen(null); });
                }}
              >
                <label className="w-40">
                  {open.kind === "entrada" ? t("Quantidade recebida") : t("Saldo correto")}
                  <input name="quantity" type="number" min={open.kind === "entrada" ? 1 : 0} max={100000} required defaultValue={open.kind === "entrada" ? 1 : item.stock_quantity ?? 0} className={fieldClass} aria-label={open.kind === "entrada" ? t("Quantidade recebida") : t("Saldo correto")} />
                </label>
                <label className="min-w-60 flex-1">
                  {open.kind === "entrada" ? t("Observação") : t("Motivo")}
                  <input name="note" maxLength={200} required={open.kind === "ajuste"} className={fieldClass} placeholder={open.kind === "entrada" ? t("Ex.: fornecedor da manhã") : t("Ex.: contagem do fechamento")} />
                </label>
                <button className={actionClass} disabled={busy}>{open.kind === "entrada" ? t("Confirmar reposição") : t("Confirmar ajuste")}</button>
                <button type="button" onClick={() => setOpen(null)}>{t("Cancelar")}</button>
              </form>
            )}
            {history === item.id && (
              <table className="queue-table mt-4">
                <thead><tr><th>{t("Quando")}</th><th>{t("Movimento")}</th><th>{t("Qtd.")}</th><th>{t("Saldo")}</th><th>{t("Observação")}</th></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}><td>{when(m.created_at)}</td><td>{t(MOVEMENT_LABELS[m.kind])}</td><td>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td><td>{m.balance_after}</td><td>{m.note ?? ""}</td></tr>
                  ))}
                  {!movements.length && <tr><td colSpan={5}>{t("Sem movimentos recentes.")}</td></tr>}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MemberEditor({
  person,
  canSetManager,
  busy,
  onSave,
}: {
  person: TeamMember;
  canSetManager: boolean;
  busy: boolean;
  onSave: (member: {
    user_id: string;
    roles: string[];
    permissions: Permissions;
    active: boolean;
  }) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [roles, setRoles] = useState<string[]>(person.roles);
  const [permissions, setPermissions] = useState<Permissions>(person.permissions ?? {});
  const [active, setActive] = useState(person.active);
  const [localError, setLocalError] = useState("");
  const isManager = roles.includes("manager");
  return (
    <form
      className="member-editor mt-4 space-y-4 rounded-2xl bg-secondary/60 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!roles.length) {
          setLocalError(msg("Escolha pelo menos um papel"));
          return;
        }
        setLocalError("");
        void onSave({ user_id: person.user_id, roles, permissions, active });
      }}
    >
      {canSetManager && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isManager}
            onChange={(e) =>
              setRoles(
                e.target.checked
                  ? [...roles, "manager"]
                  : roles.filter((r) => r !== "manager"),
              )
            }
          />{t("Gestor do restaurante")}</label>
      )}
      <RolePicker
        value={roles}
        onChange={(next) => {
          setRoles(isManager ? [...new Set(["manager", ...next])] : next);
          setPermissions({});
        }}
      />
      <PermissionPicker roles={roles} value={permissions} onChange={setPermissions} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Acesso ativo")}<span className="text-xs text-muted-foreground">{t("(desligar mantém o histórico do que a pessoa fez)")}</span>
      </label>
      {localError && (
        <p role="alert" className="text-sm text-destructive">
          {t(localError)}
        </p>
      )}
      <button disabled={busy} className={actionClass}>{t("Salvar acesso")}</button>
    </form>
  );
}

function SettingsForm({
  restaurantId,
  restaurant,
  settings,
  onSave,
  busy,
}: {
  restaurantId: string;
  restaurant: ManagementData["restaurant"];
  settings: QueueSettings;
  onSave: (body: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [logo, setLogo] = useState(restaurant.logo_url);
  const [cover, setCover] = useState(restaurant.cover_url);
  const [color, setColor] = useState(restaurant.primary_color || restaurant.resellers.primary_color);
  const [background, setBackground] = useState(restaurant.background_color || "#faf7f2");
  return (
    <div className="restaurant-settings grid items-start gap-6 xl:grid-cols-2">
      <form
        className={`${panelClass} queue-settings space-y-5`}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave({
            action: "settings",
            data: {
              mode: f.get("mode"),
              weight_wait: Number(f.get("wait")),
              weight_complexity: Number(f.get("complexity")),
              max_wait_minutes: Number(f.get("max")),
            },
          });
        }}
      >
        <h3 className="font-heading text-2xl">{t("Fila da cozinha")}</h3>
        <p className="settings-intro">{t("Defina como a equipe organiza os pedidos recebidos.")}</p>
        <label className="block">{t("Regra de prioridade")}<select
            name="mode"
            defaultValue={settings.mode}
            className={fieldClass}
          >
            <option value="fifo">{t("Ordem de chegada")}</option>
            <option value="complexity">{t("Complexidade")}</option>
            <option value="balanced">{t("Equilibrado")}</option>
          </select>
        </label>
        <label className="block">{t("Peso da espera")}<input
            name="wait"
            type="number"
            min={0}
            max={999.99}
            step="0.01"
            defaultValue={settings.weight_wait}
            className={fieldClass}
          />
        </label>
        <label className="block">{t("Peso da complexidade")}<input
            name="complexity"
            type="number"
            min={0}
            max={999.99}
            step="0.01"
            defaultValue={settings.weight_complexity}
            className={fieldClass}
          />
        </label>
        <label className="block">{t("Limite de espera (minutos)")}<input
            name="max"
            type="number"
            min={1}
            max={240}
            defaultValue={settings.max_wait_minutes}
            className={fieldClass}
          />
        </label>
        <p className="text-sm text-muted-foreground">{t("Acima do limite, o pedido sobe na fila. Fixações manuais têm prioridade.")}</p>
        <button disabled={busy} className={actionClass}>{t("Salvar regra da fila")}</button>
      </form>
      <form
        className={`${panelClass} space-y-5`}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave({
            action: "finance_settings",
            data: {
              service_fee_percent: Number(f.get("fee")),
              service_fee_optional: f.get("optional") === "on",
            },
          });
        }}
      >
        <h3 className="font-heading text-2xl">{t("Taxa de serviço")}</h3>
        <p className="settings-intro">{t("Aparece como linha separada na comanda. Zero desliga.")}</p>
        <label className="block">{t("Percentual (%)")}<input name="fee" type="number" min={0} max={20} step="0.5" defaultValue={Number(restaurant.service_fee_percent ?? 0)} className={fieldClass} aria-label={t("Taxa de serviço (%)")} />
        </label>
        <label className="flex items-center gap-2">
          <input name="optional" type="checkbox" defaultChecked={restaurant.service_fee_optional ?? true} />{t("Opcional: o garçom pode retirar ao fechar")}</label>
        <button disabled={busy} className={actionClass}>{t("Salvar taxa de serviço")}</button>
      </form>
      <form
        className={`${panelClass} space-y-5`}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave({
            action: "survey_settings",
            data: {
              survey_enabled: f.get("enabled") === "on",
              google_review_url: String(f.get("google") || ""),
            },
          });
        }}
      >
        <h3 className="font-heading text-2xl">{t("Pesquisa de satisfação")}</h3>
        <p className="settings-intro">{t("Quando a comanda fecha, cada pessoa avalia a visita no celular. Nota 4 ou 5 recebe o convite para avaliar no Google.")}</p>
        <label className="flex items-center gap-2">
          <input name="enabled" type="checkbox" defaultChecked={restaurant.survey_enabled ?? true} />{t("Pedir avaliação ao fechar a comanda")}</label>
        <label className="block">{t("Link para avaliar no Google")}<input name="google" type="url" placeholder="https://g.page/r/…" defaultValue={restaurant.google_review_url ?? ""} className={fieldClass} aria-label={t("Link do Google")} />
          <span className="field-help">{t("Opcional. No Google Business, use “Pedir avaliações” para copiar o link.")}</span>
        </label>
        <button disabled={busy} className={actionClass}>{t("Salvar pesquisa")}</button>
      </form>
      <form
        className={`${panelClass} space-y-5`}
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ action: "pin_settings", data: { pin_required: new FormData(e.currentTarget).get("pin") === "on" } });
        }}
      >
        <h3 className="font-heading text-2xl">{t("PIN da mesa")}</h3>
        <p className="settings-intro">{t("Com o PIN, só quem está na mesa consegue pedir. Sem ele, o cliente informa só o nome; a mesa continua precisando ser aberta pelo garçom.")}</p>
        <label className="flex items-center gap-2">
          <input name="pin" type="checkbox" defaultChecked={restaurant.pin_required ?? true} />{t("Exigir PIN da mesa")}</label>
        <button disabled={busy} className={actionClass}>{t("Salvar PIN da mesa")}</button>
      </form>
      <form
        className={`${panelClass} brand-settings space-y-5`}
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            action: "restaurant",
            data: {
              name: new FormData(e.currentTarget).get("name"),
              logo_url: logo,
              cover_url: cover,
              primary_color: color,
              background_color: background,
            },
          });
        }}
      >
        <header className="settings-section-heading"><span><Palette size={22}/></span><div><h3 className="font-heading text-2xl">{t("Personalize seu cardápio")}</h3><p>{t("É assim que seu restaurante aparece para o cliente.")}</p></div></header>
        <label className="block">{t("Nome do restaurante")}<input
            name="name"
            required
            maxLength={100}
            defaultValue={restaurant.name}
            className={fieldClass}
          />
          <span className="field-help">{t("Este é o nome que aparece em destaque no topo do cardápio.")}</span>
        </label>
        <div className="restaurant-logo-upload"><ImageUpload
          kind="restaurant"
          id={restaurantId}
          label={t("Logo do restaurante")}
          value={logo}
          onChange={setLogo}
        /></div>
        <div className="restaurant-banner-upload"><ImageUpload
          kind="restaurant"
          id={restaurantId}
          label={t("Banner principal do cardápio")}
          value={cover}
          onChange={setCover}
          preview={cover ? <MenuPhoto slug={restaurant.slug} src={cover} alt={t("Salão do restaurante")} width={640} height={240} className="my-3 rounded-xl object-cover" style={{width:"100%",height:190}}/> : undefined}
        /><p className="field-help">{t("A imagem grande no topo do cardápio. Prefira uma foto horizontal do restaurante ou de um prato da casa.")}</p></div>
        <div className="grid grid-cols-2 gap-4"><label>{t("Cor principal")}<input aria-label={t("Cor principal")} type="color" value={color} onChange={e => setColor(e.target.value)} className="mt-2 block h-12 w-full cursor-pointer rounded-xl border bg-card p-1"/></label><label>{t("Fundo do cardápio")}<input aria-label={t("Fundo do cardápio")} type="color" value={background} onChange={e => setBackground(e.target.value)} className="mt-2 block h-12 w-full cursor-pointer rounded-xl border bg-card p-1"/></label></div><p className="text-sm text-muted-foreground">{t("A identidade deste restaurante aparece no cardápio do cliente. Fotos, nomes, preços e adicionais são editados em Cardápio.")}</p>
        <button disabled={busy} className={actionClass}>{t("Salvar restaurante")}</button>
      </form>
    </div>
  );
}

/** Pausa os pedidos do cardápio com motivo opcional (spec-fase3.md, seção 2). */
function PauseButton({ busy, onPause }: { busy: boolean; onPause: (reason: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="pause-toggle" disabled={busy} onClick={() => setOpen(true)}>
        <PauseCircle size={18} /> {t("Pausar pedidos")}
      </button>
    );
  return (
    <form
      className="pause-inline"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get("reason") || "").trim();
        void onPause(reason).then((ok) => ok && setOpen(false));
      }}
    >
      <input name="reason" maxLength={120} placeholder={t("Motivo (opcional, o cliente vê)")} aria-label={t("Motivo da pausa")} className={fieldClass} autoFocus />
      <button disabled={busy} className="block-form-confirm">{t("Pausar pedidos")}</button>
      <button type="button" onClick={() => setOpen(false)}>{t("Voltar")}</button>
    </form>
  );
}

type CategoryRow = OperationData["categories"][number] & {
  translations?: Translations;
  blocked?: boolean;
  blocked_reason?: string | null;
  available_from?: string | null;
  available_until?: string | null;
};

/** Linha da categoria: nome, setor, ativa e, em "Mais opções", bloqueio, horário e traduções. */
function CategoryForm({
  category: c,
  first,
  last,
  busy,
  languages,
  blocks,
  onSave,
  onMove,
  onDropCategory,
}: {
  category: CategoryRow;
  first: boolean;
  last: boolean;
  busy: boolean;
  languages: boolean;
  blocks: boolean;
  onSave: (body: unknown) => Promise<boolean>;
  onMove: (delta: -1 | 1) => void;
  onDropCategory: (from: string) => void;
}) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const [translations, setTranslations] = useState<Translations>(c.translations ?? {});
  const [availability, setAvailability] = useState({
    blocked: c.blocked ?? false,
    blocked_reason: c.blocked_reason ?? null,
    available_from: hhmm(c.available_from),
    available_until: hhmm(c.available_until),
  });
  const extras = languages || blocks;
  return (
    <form
      className="mb-5"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("category", c.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropCategory(e.dataTransfer.getData("category"));
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const values = new FormData(e.currentTarget);
        void onSave({
          action: "category",
          id: c.id,
          name: values.get("name"),
          active: values.get("active") === "on",
          position: c.position,
          station: values.get("station") || "cozinha",
          ...(languages ? { translations } : { translations: c.translations ?? {} }),
          ...(blocks
            ? availability
            : { blocked: c.blocked ?? false, blocked_reason: c.blocked_reason ?? null, available_from: hhmm(c.available_from), available_until: hhmm(c.available_until) }),
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <GripVertical className="text-muted-foreground" size={18} />
        <input
          aria-label={t("Nome da categoria {name}", { name: c.name })}
          name="name"
          defaultValue={c.name}
          key={c.name}
          required
          className="min-w-0 flex-1 rounded-xl border p-3 font-heading text-xl"
        />
        <select
          aria-label={t("Setor da categoria {name}", { name: c.name })}
          name="station"
          defaultValue={c.station ?? "cozinha"}
          key={`station-${c.station}`}
          className="rounded-xl border p-3 text-sm"
        >
          <option value="cozinha">{t("Cozinha")}</option>
          <option value="bar">{t("Bar")}</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={c.active} key={String(c.active)} />
          {t("Ativa")}
        </label>
        {extras && (
          <button type="button" className="flex items-center gap-1 text-sm underline" aria-expanded={more} onClick={() => setMore((v) => !v)}>
            <Settings2 size={15} /> {more ? t("Menos opções") : t("Mais opções")}
          </button>
        )}
        <button disabled={busy} className="rounded-xl border px-3 py-2 text-sm">
          {t("Salvar categoria")}
        </button>
        <button type="button" aria-label={t("Subir categoria {name}", { name: c.name })} disabled={first || busy} onClick={() => onMove(-1)}>
          <ArrowUp size={18} />
        </button>
        <button type="button" aria-label={t("Descer categoria {name}", { name: c.name })} disabled={last || busy} onClick={() => onMove(1)}>
          <ArrowDown size={18} />
        </button>
      </div>
      {blocks && !more && (c.blocked || c.available_from) && (
        <p className="catalog-flags mt-2">
          {c.blocked && <span className="blocked"><Ban size={12} /> {t("Categoria bloqueada")}{c.blocked_reason ? `: ${c.blocked_reason}` : ""}</span>}
          {c.available_from && c.available_until && <span><Clock3 size={12} /> {shortTime(c.available_from)}–{shortTime(c.available_until)}</span>}
        </p>
      )}
      {more && (
        <div className="category-extras">
          {blocks && (
            <fieldset>
              <legend>{t("Disponibilidade")}</legend>
              <AvailabilityFields subject="categoria" value={availability} onChange={(patch) => setAvailability((v) => ({ ...v, ...patch }))} />
            </fieldset>
          )}
          {languages && (
            <fieldset>
              <legend>{t("Nome em outros idiomas")}</legend>
              <TranslationFields compact value={translations} fields={["name"]} onChange={setTranslations} />
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">{t("Salve a categoria para aplicar.")}</p>
        </div>
      )}
    </form>
  );
}
