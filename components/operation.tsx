"use client";
import { restaurantBrand } from "@/lib/restaurant-brand";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Bell,
  BellRing,
  Flame,
  Check,
  MessageSquare,
  ChefHat,
  Clock,
  Link2,
  LogOut,
  Pin,
  RefreshCw,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  Wine,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isLate, sortQueue, type QueueSettings } from "@/lib/priority";
import {
  brandForeground,
  CANCEL_REASONS,
  money,
  type CustomerOrder,
  type MenuItem,
  type PaymentMethod,
  type ServiceCallKind,
  type Station,
  type TabTotals,
  PAYMENT_LABELS,
  STATION_LABELS,
} from "@/lib/menu-types";
import { splitTab, type SplitGuest } from "@/lib/split";
import { type EffectivePermissions } from "@/lib/permissions";
import { useAlerts, useTabBadge } from "@/lib/alerts";
import { jsonRequest } from "@/components/admin-ui";
import { TabDetail, when, type TabDetailData } from "@/components/reports";
import { AccessBanner, HelpButton } from "@/components/support";
import { type Access } from "@/lib/features";

export type StaffOrder = CustomerOrder & {
  tab_id: string;
  pinned: boolean;
  cancel_reason?: string | null;
  started_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
};
export type OperationData = {
  staff_name?: string;
  roles: string[];
  can: EffectivePermissions;
  access?: Access | null;
  restaurant_id: string;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    primary_color?: string | null;
    service_fee_percent?: number | string;
    service_fee_optional?: boolean;
    resellers: {
      brand_name: string;
      primary_color: string;
      logo_url: string | null;
      support_whatsapp?: string | null;
      support_email?: string | null;
      support_hours?: string | null;
    };
  };
  memberships: { restaurant_id: string; restaurants: { name: string } }[];
  tables: { id: string; label: string; qr_token: string; active: boolean }[];
  tabs: {
    id: string;
    table_id: string;
    pin: string;
    opened_at: string;
    status: string;
    service_fee_percent?: number | string;
    service_fee_waived?: boolean;
    discount_cents?: number;
    discount_reason?: string | null;
  }[];
  payments: { id: string; tab_id: string; guest_id: string | null; method: PaymentMethod; amount_cents: number; created_at: string }[];
  guests: (SplitGuest & { tab_id: string })[];
  /** Mesas unidas a uma comanda (a principal fica em tabs.table_id). */
  tab_tables: { tab_id: string; table_id: string }[];
  orders: StaffOrder[];
  items: (MenuItem & {
    sold_out: boolean;
    sold_out_auto?: boolean;
    active: boolean;
    position: number;
    stock_enabled?: boolean;
    stock_quantity?: number | null;
    low_stock_threshold?: number;
    station?: Station | null;
  })[];
  categories: { id: string; name: string; position: number; active: boolean; station?: Station }[];
  settings: QueueSettings;
  calls: StaffCall[];
};
export type StaffCall = {
  id: string;
  table_id: string;
  tab_id: string | null;
  guest_id: string | null;
  kind: ServiceCallKind;
  note: string | null;
  created_at: string;
};
const CALL_BADGES: Record<ServiceCallKind, string> = {
  garcom: "Chamando",
  conta: "Pede a conta",
  ajuda: "Precisa de ajuda",
};

export function Operation({ role }: { role: "cozinha" | "garcom" | "bar" }) {
  const router = useRouter();
  // Cozinha e bar são o mesmo painel (KDS) filtrado pelo setor.
  const kitchenLike = role !== "garcom";
  const station: Station = role === "bar" ? "bar" : "cozinha";
  const [data, setData] = useState<OperationData | null>(null);
  const [restaurant, setRestaurant] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [view, setView] = useState("all");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [cancelling, setCancelling] = useState<{ kind: "item" | "order"; id: string; label: string } | null>(null);
  const [merging, setMerging] = useState(false);
  const [payForm, setPayForm] = useState<{ guestId: string | null; amount: number } | null>(null);
  const [closedToday, setClosedToday] = useState<{ tabs: { id: string; table: string; tables: string[]; closed_at: string; guests: number; orders: number; totals: TabTotals | null }[] } | null>(null);
  const [closedDetail, setClosedDetail] = useState<TabDetailData | null>(null);
  const [discountForm, setDiscountForm] = useState(false);
  const [connection, setConnection] = useState("Conectando…");
  const alerts = useAlerts();
  // Pedidos recém-chegados ficam destacados por 10 s na cozinha.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<{ orders: Set<string>; ready: Set<string>; late: Set<string>; calls: Set<string>; primed: boolean }>({
    orders: new Set(),
    ready: new Set(),
    late: new Set(),
    calls: new Set(),
    primed: false,
  });
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/staff/${role}${restaurant ? `?restaurant_id=${restaurant}` : ""}`,
      );
      const json = await response.json();
      if (!response.ok) {
        setUnauthorized(response.status === 401);
        throw new Error(json.error);
      }
      setData(json);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao atualizar");
    }
  }, [role, restaurant]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const fallback = setInterval(refresh, 15_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(fallback);
      clearInterval(clock);
    };
  }, [refresh]);
  const id = data?.restaurant_id;
  useEffect(() => {
    if (!id) return;
    const db = createClient();
    let channel: ReturnType<typeof db.channel> | undefined;
    let disposed = false;
    void (async () => {
      const {
        data: { session },
      } = await db.auth.getSession();
      if (!session || disposed) return;
      await db.realtime.setAuth(session.access_token);
      if (disposed) return;
      channel = db
        .channel(`operation:${id}:${role}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `restaurant_id=eq.${id}`,
          },
          () => {
            void refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tabs",
            filter: `restaurant_id=eq.${id}`,
          },
          () => {
            void refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tab_guests",
            filter: `restaurant_id=eq.${id}`,
          },
          () => {
            void refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "service_calls",
            filter: `restaurant_id=eq.${id}`,
          },
          () => {
            void refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tab_tables",
            filter: `restaurant_id=eq.${id}`,
          },
          () => {
            void refresh();
          },
        )
        .subscribe((status) =>
          setConnection(status === "SUBSCRIBED" ? "Ao vivo" : "Reconectando…"),
        );
    })();
    return () => {
      disposed = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [id, role, refresh]);
  // Detecta eventos comparando cada carga com o que já foi visto: pedido novo e
  // atraso (cozinha e bar), pedido pronto e chamada (garçom). A primeira carga
  // só registra, sem tocar.
  useEffect(() => {
    if (!data) return;
    const s = seen.current;
    const current = Date.now();
    const active = data.orders.filter(
      (o) => ["recebido", "em_preparo", "pronto"].includes(o.status) && (!kitchenLike || (o.station ?? "cozinha") === station),
    );
    const newOrders = active.filter((o) => o.status === "recebido" && !s.orders.has(o.id));
    const newReady = active.filter((o) => o.status === "pronto" && !s.ready.has(o.id));
    const newLate = active.filter((o) => o.status !== "pronto" && isLate(o, current) && !s.late.has(o.id));
    const newCalls = data.calls.filter((c) => !s.calls.has(c.id));
    for (const o of active) s.orders.add(o.id);
    for (const o of newReady) s.ready.add(o.id);
    for (const o of newLate) s.late.add(o.id);
    for (const c of data.calls) s.calls.add(c.id);
    if (!s.primed) {
      s.primed = true;
      return;
    }
    if (role === "garcom") {
      if (newCalls.length) alerts.play("call");
      else if (newReady.length) alerts.play("ready");
    } else {
      if (newOrders.length) {
        alerts.play("new");
        setFresh((f) => new Set([...f, ...newOrders.map((o) => o.id)]));
        const ids = newOrders.map((o) => o.id);
        setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !ids.includes(id)))), 10_000);
      } else if (newLate.length) alerts.play("late");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, role]);
  const pendingCount = data
    ? role === "garcom"
      ? data.orders.filter((o) => o.status === "pronto").length + data.calls.length
      : data.orders.filter((o) => ["recebido", "em_preparo"].includes(o.status) && (o.station ?? "cozinha") === station).length
    : 0;
  useTabBadge(pendingCount, role === "garcom" ? "Salão • Comanda" : role === "bar" ? "Fila do bar • Comanda" : "Fila da cozinha • Comanda");
  const command = async (body: Record<string, unknown>) => {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/staff/${role}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, restaurant_id: data.restaurant_id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refresh();
      setClosing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente");
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/app/login");
    router.refresh();
  };
  if (unauthorized)
    return (
      <main className="p-8 text-center">
        <p>{error}</p>
        <Link href="/app/login" className="mt-5 inline-block underline">
          Entrar com minha conta
        </Link>
      </main>
    );
  if (!data)
    return (
      <main className="p-8" role="status">
        {error || "Preparando a operação…"}
        <button onClick={refresh} className="ml-4 underline">
          Atualizar
        </button>
      </main>
    );
  const brand = restaurantBrand(data.restaurant);
  const style = {
    "--brand": brand.primary_color,
    "--brand-foreground": brandForeground(brand.primary_color),
  } as CSSProperties;
  const activeOrders = data.orders.filter(
    (o) =>
      ["recebido", "em_preparo", "pronto"].includes(o.status) &&
      (!kitchenLike || (o.station ?? "cozinha") === station),
  );
  const itemStation = (item: OperationData["items"][number]): Station =>
    item.station ?? data.categories.find((c) => c.id === item.category_id)?.station ?? "cozinha";
  const ready = activeOrders.filter((o) => o.status === "pronto");
  // Sorting only changes every 30s or with newly fetched orders.
  const queueNow = Math.floor(now / 30_000) * 30_000;
  const queue = sortQueue(
    activeOrders.filter((o) => o.status !== "pronto"),
    data.settings,
    queueNow,
  );
  // Comanda aberta de uma mesa: principal ou unida.
  const tabForTable = (tableId: string) =>
    data.tabs.find((b) => b.table_id === tableId) ??
    data.tabs.find((b) => data.tab_tables.some((tt) => tt.tab_id === b.id && tt.table_id === tableId));
  const mergedTables = (tabId: string) =>
    data.tab_tables
      .filter((tt) => tt.tab_id === tabId)
      .map((tt) => data.tables.find((t) => t.id === tt.table_id))
      .filter((t): t is OperationData["tables"][number] => !!t);
  // "12+13" quando a comanda tem mesas unidas.
  const tabLabel = (tabId: string | undefined) => {
    const tab = data.tabs.find((b) => b.id === tabId);
    if (!tab) return "—";
    const primary = data.tables.find((t) => t.id === tab.table_id)?.label || "—";
    const extra = mergedTables(tab.id).map((t) => t.label);
    return [primary, ...extra].join("+");
  };
  const tableForOrder = (order: StaffOrder) => tabLabel(order.tab_id);
  const elapsed = (created: string) => {
    const seconds = Math.max(0, Math.floor((now - Date.parse(created)) / 1000));
    return `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  };
  const selected = data.tables.find((t) => t.id === selectedTable);
  const tab = selectedTable ? tabForTable(selectedTable) : undefined;
  const selectedMerged = tab ? mergedTables(tab.id) : [];
  const freeTables = data.tables.filter((t) => t.active && t.id !== selected?.id && !tabForTable(t.id));
  const otherOpenTables = data.tables.filter((t) => t.active && t.id !== selected?.id && data.tabs.some((b) => b.table_id === t.id && b.id !== tab?.id));
  const tableOrders = data.orders.filter((o) => o.tab_id === tab?.id);
  const tableGuests = data.guests.filter((g) => g.tab_id === tab?.id);
  const split = splitTab(tableGuests, tableOrders);
  const unpaid = split.people.filter((p) => !p.settled && p.balance_cents > 0);
  const tabPayments = data.payments.filter((p) => p.tab_id === tab?.id);
  // Espelho de public.tab_totals: itens ativos + taxa (se não retirada) - desconto.
  const totals: TabTotals = (() => {
    const items = tableOrders.filter((o) => o.status !== "cancelado").reduce((sum, o) => sum + o.total_cents, 0);
    const pct = Number(tab?.service_fee_percent ?? 0);
    const waived = !!tab?.service_fee_waived;
    const fee = waived ? 0 : Math.round((items * pct) / 100);
    const discount = tab?.discount_cents ?? 0;
    const due = Math.max(0, items + fee - discount);
    const paid = tabPayments.reduce((sum, p) => sum + p.amount_cents, 0);
    return { items_cents: items, fee_cents: fee, fee_percent: pct, fee_waived: waived, discount_cents: discount, discount_reason: tab?.discount_reason ?? null, due_cents: due, paid_cents: paid, balance_cents: due - paid };
  })();
  const actionStyle =
    "rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50";
  return (
    <main
      style={style}
      className={`${kitchenLike ? "dark kitchen-screen" : "waiter-screen"} ${role === "bar" ? "bar-screen" : ""} brand-scope min-h-screen bg-background text-foreground`}
    >
      <header className="operation-header">
        <div className="flex items-center gap-3">
          {role === "cozinha" ? <Flame className="kitchen-flame" /> : role === "bar" ? <Wine className="kitchen-flame" /> : <UtensilsCrossed />}
          <div>
            <h1 className="font-heading text-2xl">
              {role === "cozinha" ? `Cozinha • ${data.restaurant.name}` : role === "bar" ? `Bar • ${data.restaurant.name}` : `Olá, ${data.staff_name?.split(" ")[0] || "equipe"}`}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {role === "cozinha" ? "Sabor no tempo certo." : role === "bar" ? "Bebidas na hora certa." : <>{data.restaurant.name} • <span className="live-indicator" /> {connection}</>}
            </p>
          </div>
        </div>
        <div className="operation-tools">
          {kitchenLike && <><span className="kitchen-mode"><Clock size={20}/>{{fifo:"Ordem de chegada",complexity:"Complexidade",balanced:"Equilibrado"}[data.settings.mode]}</span><span className="kitchen-count"><ChefHat size={27}/><span><b>{queue.length} na fila</b><small>Pedidos pendentes</small></span></span></>}
          {data.memberships.length > 1 && (
            <select
              aria-label="Restaurante"
              value={data.restaurant_id}
              onChange={(e) => {
                setRestaurant(e.target.value);
                setSelectedTable(null);
              }}
              className="rounded-xl border bg-card p-2"
            >
              {data.memberships.map((m) => (
                <option key={m.restaurant_id} value={m.restaurant_id}>
                  {m.restaurants.name}
                </option>
              ))}
            </select>
          )}
          <button
            className={`sound-toggle ${alerts.enabled ? "on" : ""}`}
            aria-pressed={alerts.enabled}
            aria-label={alerts.enabled ? "Desativar som" : "Ativar som"}
            title={alerts.enabled ? "Som ligado" : "Ativar som dos alertas"}
            onClick={() => (alerts.enabled ? alerts.disable() : alerts.enable())}
          >
            {alerts.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            {!alerts.enabled && <span>Ativar som</span>}
          </button>
          <button onClick={refresh} aria-label="Atualizar">
            <RefreshCw size={20} />
          </button>
          <HelpButton support={data.restaurant.resellers} context={role === "garcom" ? "salão" : role === "bar" ? "bar" : "cozinha"} className="flex items-center gap-1 text-sm" />
          <Link href="/app" className="text-sm underline">
            Painéis
          </Link>
          <button aria-label="Sair" onClick={logout}>
            <LogOut size={20} />
          </button>
        </div>
      </header>
      <AccessBanner access={data.access} support={data.restaurant.resellers} />
      {error && (
        <p role="alert" className="bg-destructive p-4 text-white">
          {error}
        </p>
      )}
      {kitchenLike ? (
        <section className="kitchen-content">
          <div className="kitchen-toolbar">
            <nav className="flex gap-3">
              <button
                className={
                  view !== "soldout" ? actionStyle : "rounded-xl border p-3"
                }
                onClick={() => setView("all")}
              >
                Fila • {queue.length}
              </button>
              <button
                className={
                  view === "soldout" ? actionStyle : "rounded-xl border p-3"
                }
                onClick={() => setView("soldout")}
              >
                Esgotados
              </button>
            </nav>
            <p className="text-muted-foreground"><span className="live-indicator"/> {connection} • Ordem:{" "}
              {
                {
                  fifo: "Ordem de chegada",
                  complexity: "Complexidade",
                  balanced: "Equilibrado",
                }[data.settings.mode]
              }
            </p>
          </div>
          {view === "soldout" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.items
                .filter((i) => i.active && itemStation(i) === station)
                .map((i) => (
                  <label
                    key={i.id}
                    className="flex items-center justify-between rounded-2xl border bg-card p-5 text-xl"
                  >
                    <span>
                      {i.name}
                      {i.stock_enabled && (
                        <small className={`stock-hint ${i.stock_quantity === 0 ? "empty" : (i.stock_quantity ?? 0) <= (i.low_stock_threshold ?? 0) ? "low" : ""}`}>
                          {i.stock_quantity === 0 ? "Estoque zerado" : `Estoque: ${i.stock_quantity}${(i.stock_quantity ?? 0) <= (i.low_stock_threshold ?? 0) ? " • baixo" : ""}`}
                        </small>
                      )}
                    </span>
                    <span className="flex items-center gap-3 text-sm">
                      {i.sold_out ? "Esgotado" : "Disponível"}
                      <input
                        type="checkbox"
                        aria-label={`Esgotado: ${i.name}`}
                        checked={i.sold_out}
                        disabled={busy}
                        onChange={(e) =>
                          void command({
                            action: "sold_out",
                            item_id: i.id,
                            sold_out: e.target.checked,
                          })
                        }
                        className="h-7 w-7 accent-primary"
                      />
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <>
              {!queue.length && (
                <div className="rounded-3xl border border-dashed p-16 text-center">
                  <ChefHat
                    className="mx-auto mb-5 text-muted-foreground"
                    size={48}
                  />
                  <h2 className="font-heading text-3xl">Tudo em dia</h2>
                  <p className="mt-3 text-muted-foreground">
                    Os novos pedidos aparecem aqui automaticamente.
                  </p>
                </div>
              )}
              <div className="kitchen-grid">
                {queue.map((order) => {
                  const late = isLate(order, now);
                  const label = tableForOrder(order);
                  return <article key={order.id} className={"kitchen-ticket " + (late ? "ticket-late" : order.status === "em_preparo" ? "ticket-cooking" : "") + (fresh.has(order.id) ? " ticket-new" : "")}>
                    <div className="ticket-heading"><h2 aria-label={"Mesa " + label}><span>Mesa</span><strong className={label.length > 4 ? "long-table-label" : ""}>{label}</strong></h2><div className="ticket-meta"><div className="ticket-status"><span className={"order-badge " + (late ? "late" : order.status === "em_preparo" ? "cooking" : "waiting")}>{late ? "Atrasado" : order.status === "em_preparo" ? "Em preparo" : "Aguardando"}</span><button aria-label={order.pinned ? "Desafixar pedido" : "Fixar pedido"} disabled={busy} onClick={() => void command({action:"pin",order_id:order.id,pinned:!order.pinned})}><Pin size={18} className={order.pinned ? "fill-primary text-primary" : "text-muted-foreground"}/></button></div><div className="ticket-timer"><Clock/>{elapsed(order.created_at)}</div><p>Tempo de preparo: {order.prep_minutes} min</p></div></div>
                    <div className="ticket-items">{order.order_items.map(item => <div key={item.id} className={"ticket-item " + (item.cancelled_at ? "ticket-item-cancelled" : "")}><div><h3>{item.quantity}× {item.name_snapshot}{item.cancelled_at && <span className="ticket-cancelled-badge">Cancelado</span>}</h3>{item.modifiers_snapshot.length > 0 && <p>{item.modifiers_snapshot.map(m => m.name).join(" • ")}</p>}</div>{item.note && !item.cancelled_at && <span className="ticket-note"><MessageSquare size={17}/>{item.note}</span>}</div>)}</div>
                    <button disabled={busy} className={"ticket-action " + (order.status === "em_preparo" ? "finish" : "")} onClick={() => void command({action:"status",order_id:order.id,status:order.status === "recebido" ? "em_preparo" : "pronto"})}><Check size={25}/>{order.status === "recebido" ? "Iniciar" : "Pronto"}</button>
                  </article>;
                })}
              </div>
              {ready.length > 0 && (
                <div className="mt-8 rounded-2xl border border-[#2F7D5B] p-5">
                  <h2 className="text-xl font-semibold">
                    Prontos para entrega • {ready.length}
                  </h2>
                  <p className="mt-3">
                    {ready.map((o) => `Mesa ${tableForOrder(o)}`).join(" • ")}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="mx-auto max-w-3xl p-5">
          <div className="my-4 flex items-center justify-between gap-3">
            <h2 className="font-heading text-3xl">Suas mesas</h2>
            <div className="flex flex-wrap justify-end gap-2">
              {data.calls.length > 0 && (
                <span role="status" className="call-counter">
                  <BellRing size={16} />
                  {data.calls.length} {data.calls.length === 1 ? "chamada" : "chamadas"}
                </span>
              )}
              <span
                role="status"
                className="flex items-center gap-2 rounded-full bg-[#2F7D5B] px-4 py-2 text-sm text-white"
              >
                <Bell size={16} />
                {ready.length} pedidos prontos
              </span>
            </div>
          </div>
          <nav className="my-6 flex flex-wrap gap-2">
            {[
              ["all", "Todas"],
              ["occupied", "Ocupadas"],
              ["free", "Livres"],
              ["ready", "Prontos"],
              ["calls", "Chamadas"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setView(value)}
                className={`rounded-full border px-5 py-3 ${view === value ? "bg-primary text-primary-foreground" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
            <button
              className={`rounded-full border px-5 py-3 ${closedToday ? "bg-primary text-primary-foreground" : "bg-card"}`}
              onClick={() =>
                closedToday
                  ? (setClosedToday(null), setClosedDetail(null))
                  : void jsonRequest(`/api/history/${data.restaurant_id}?period=today`)
                      .then((r: { tabs: NonNullable<typeof closedToday>["tabs"] }) => setClosedToday({ tabs: r.tabs }))
                      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar"))
              }
            >
              Comandas fechadas hoje
            </button>
          </nav>
          {closedToday && (
            <section className="closed-today">
              <header className="flex items-center justify-between gap-3">
                <h3 className="font-heading text-2xl">Comandas fechadas hoje</h3>
                <button className="text-sm underline" onClick={() => { setClosedToday(null); setClosedDetail(null); }}>Fechar</button>
              </header>
              {closedDetail && <TabDetail data={closedDetail} onClose={() => setClosedDetail(null)} />}
              {!closedDetail && (
                <div className="space-y-2">
                  {closedToday.tabs.map((t) => (
                    <button key={t.id} className="closed-row" aria-label={`Ver comanda fechada da mesa ${t.table}`} onClick={() => void jsonRequest(`/api/history/${data.restaurant_id}?tab_id=${t.id}`).then(setClosedDetail).catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar"))}>
                      <span><b>Mesa {t.table}{t.tables.length ? ` + ${t.tables.join(", ")}` : ""}</b><small>{when(t.closed_at)} • {t.guests} pessoas • {t.orders} pedidos</small></span>
                      <b>{money(t.totals?.due_cents ?? 0)}</b>
                    </button>
                  ))}
                  {!closedToday.tabs.length && <p className="text-sm text-muted-foreground">Nenhuma comanda fechada hoje.</p>}
                </div>
              )}
            </section>
          )}
          <div className="waiter-tables">
            {data.tables
              .filter((t) => t.active)
              .toSorted((a, b) =>
                a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
              )
              .filter((t) => {
                const tab = tabForTable(t.id);
                const hasReady = ready.some((o) => o.tab_id === tab?.id);
                const hasCall = data.calls.some((c) => c.table_id === t.id);
                return (
                  view === "all" ||
                  (view === "occupied" && tab) ||
                  (view === "free" && !tab) ||
                  (view === "ready" && hasReady) ||
                  (view === "calls" && hasCall)
                );
              })
              .map((t) => {
                const tab = tabForTable(t.id);
                const isMerged = !!tab && tab.table_id !== t.id;
                const orders = data.orders.filter(
                  (o) => o.tab_id === tab?.id && o.status !== "cancelado",
                );
                const hasReady = orders.some((o) => o.status === "pronto");
                const tableCalls = data.calls.filter((c) => c.table_id === t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTable(t.id);
                      setClosing(false);
                      setShowOrders(false);
                      setCancelling(null);
                      setMerging(false);
                    }}
                    className={`waiter-table ${hasReady ? "ready" : tab ? "occupied" : "free"} ${tableCalls.length ? "calling" : ""} ${isMerged ? "merged" : ""}`}
                  >
                    <span className="text-sm text-muted-foreground">Mesa</span>
                    <h3 className="my-2 font-heading text-4xl">{t.label}</h3>
                    {tab && (isMerged || mergedTables(tab.id).length > 0) && (
                      <span className="merged-badge">
                        <Link2 size={13} /> {isMerged ? `Unida à mesa ${tabLabel(tab.id).split("+")[0]}` : `Com ${mergedTables(tab.id).map((m) => m.label).join(", ")}`}
                      </span>
                    )}
                    {tableCalls.map((c) => (
                      <span key={c.id} className="call-badge">
                        <BellRing size={13} /> {CALL_BADGES[c.kind]}
                      </span>
                    ))}
                    {tab ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {Math.max(
                            0,
                            Math.floor(
                              (now - Date.parse(tab.opened_at)) / 60000,
                            ),
                          )}{" "}
                          min
                        </p>
                        {!isMerged && <b className="mt-2 block">
                          {money(
                            orders.reduce((sum, o) => sum + o.total_cents, 0),
                          )}
                        </b>}
                        {hasReady && (
                          <span className="mt-2 inline-flex items-center gap-1 text-sm text-[#2F7D5B]">
                            <Bell size={14} />
                            Pronto
                          </span>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Livre</p>
                    )}
                  </button>
                );
              })}
          </div>
        </section>
      )}
      {selected && (
        <div
          className="table-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Mesa ${selected.label}`}
        >
          <section className="table-sheet">
            <header className="flex justify-between">
              <h2 className="font-heading text-3xl">
                {tab && tab.table_id !== selected.id
                  ? `Mesa ${selected.label} • unida à ${tabLabel(tab.id)}`
                  : tab && selectedMerged.length
                    ? `Mesas ${tabLabel(tab.id).replaceAll("+", " + ")}`
                    : `Mesa ${selected.label}`}
              </h2>
              <button
                aria-label="Fechar detalhe da mesa"
                onClick={() => setSelectedTable(null)}
              >
                <X />
              </button>
            </header>
            {error && (
              <p role="alert" className="my-3 text-destructive">
                {error}
              </p>
            )}
            {data.calls.filter((c) => c.table_id === selected.id).map((c) => (
              <div key={c.id} className="call-row" role="status">
                <div>
                  <b><BellRing size={16} /> {CALL_BADGES[c.kind]}</b>
                  <small>
                    {c.guest_id && tableGuests.find((g) => g.id === c.guest_id)?.name
                      ? `${tableGuests.find((g) => g.id === c.guest_id)!.name} • `
                      : ""}
                    há {Math.max(0, Math.floor((now - Date.parse(c.created_at)) / 60000))} min
                    {c.note && ` • "${c.note}"`}
                  </small>
                </div>
                <button
                  disabled={busy}
                  className={actionStyle}
                  aria-label={`Atender chamada: ${CALL_BADGES[c.kind]}`}
                  onClick={() => void command({ action: "attend_call", call_id: c.id })}
                >
                  Atendida
                </button>
              </div>
            ))}
            {!tab ? (
              <>
                <p className="my-7 text-muted-foreground">
                  A mesa está livre. Abra a comanda para liberar pedidos.
                </p>
                <button
                  disabled={busy}
                  className={`${actionStyle} w-full`}
                  onClick={() =>
                    void command({ action: "open", table_id: selected.id })
                  }
                >
                  Abrir mesa
                </button>
              </>
            ) : (
              <>
                <p className="mt-7 text-center text-muted-foreground">
                  Código da mesa
                </p>
                <p className="table-pin-digits" aria-label={`PIN ${tab.pin}`}>{tab.pin.split("").map((digit,i) => <span key={i}>{digit}</span>)}</p>
                <button
                  disabled={busy}
                  className="mx-auto block underline"
                  onClick={() =>
                    void command({ action: "rotate", tab_id: tab.id })
                  }
                >
                  Gerar novo PIN
                </button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Os celulares já liberados continuam funcionando.
                </p>
                {(selectedMerged.length > 0 || data.can.merge_tables) && (
                  <div className="merge-box">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b><Link2 size={16} /> Mesas desta comanda</b>
                      {data.can.merge_tables && (
                        <button className="text-sm underline" onClick={() => setMerging((v) => !v)}>
                          {merging ? "Fechar" : "Unir mesa"}
                        </button>
                      )}
                    </div>
                    <p className="merge-list">
                      <span className="merge-chip">Mesa {data.tables.find((t) => t.id === tab.table_id)?.label} <small>principal</small></span>
                      {selectedMerged.map((m) => (
                        <span key={m.id} className="merge-chip">
                          Mesa {m.label}
                          {data.can.merge_tables && (
                            <button
                              disabled={busy}
                              aria-label={`Separar mesa ${m.label}`}
                              onClick={() => void command({ action: "split", tab_id: tab.id, table_id: m.id })}
                            >
                              Separar
                            </button>
                          )}
                        </span>
                      ))}
                    </p>
                    {merging && (
                      <div className="merge-options">
                        <p className="text-sm text-muted-foreground">O QR de qualquer mesa unida abre esta comanda, com o mesmo PIN.</p>
                        {freeTables.length > 0 && (
                          <div>
                            <small>Mesas livres</small>
                            <div className="flex flex-wrap gap-2">
                              {freeTables.map((t) => (
                                <button key={t.id} disabled={busy} className="rounded-xl border px-4 py-2" aria-label={`Unir mesa ${t.label}`}
                                  onClick={() => void command({ action: "merge", tab_id: tab.id, table_id: t.id }).then(() => setMerging(false))}>
                                  Mesa {t.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {otherOpenTables.length > 0 && (
                          <div>
                            <small>Mesas com comanda aberta: os pedidos e as pessoas passam para cá e os clientes digitam este PIN de novo.</small>
                            <div className="flex flex-wrap gap-2">
                              {otherOpenTables.map((t) => (
                                <button key={t.id} disabled={busy} className="rounded-xl border border-destructive/50 px-4 py-2" aria-label={`Unir comanda da mesa ${t.label}`}
                                  onClick={() => void command({ action: "merge", tab_id: tab.id, table_id: t.id }).then(() => setMerging(false))}>
                                  Mesa {t.label} <small>(aberta)</small>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {!freeTables.length && !otherOpenTables.length && (
                          <p className="text-sm text-muted-foreground">Não há outras mesas para unir.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="table-order-summary"><span>{tableOrders.filter(o => o.status !== "cancelado").length} pedidos na comanda</span><button onClick={() => setShowOrders(v => !v)}>{showOrders ? "Recolher pedidos" : "Ver pedidos"}</button></div>
                <div className="mt-5 space-y-4">
                  {tableOrders.filter(o => showOrders || o.status === "pronto").map((o) => (
                    <article key={o.id} className="rounded-2xl border p-4">
                      <div className="flex justify-between">
                        <b>
                          {
                            {
                              recebido: "Recebido",
                              em_preparo: "Em preparo",
                              pronto: "Pronto",
                              entregue: "Entregue",
                              cancelado: "Cancelado",
                            }[o.status]
                          }
                          {tableGuests.some((g) => g.id === o.guest_id) &&
                            ` • ${tableGuests.find((g) => g.id === o.guest_id)!.name}`}
                          {(o.station === "bar" || data.orders.some((x) => x.batch_id && x.batch_id === o.batch_id && x.id !== o.id)) && (
                            <span className={`station-tag ${o.station ?? "cozinha"}`}>{STATION_LABELS[o.station ?? "cozinha"]}</span>
                          )}
                        </b>
                        <b>{money(o.total_cents)}</b>
                      </div>
                      {o.order_items.map((i) => (
                        <div key={i.id} className={`mt-2 flex items-start justify-between gap-3 text-sm ${i.cancelled_at ? "line-through text-muted-foreground" : ""}`}>
                          <p>
                            {i.quantity}× {i.name_snapshot}
                            {i.note && ` • ${i.note}`}
                            {i.shared && " • dividido com a mesa"}
                            {i.cancelled_at && ` • cancelado${i.cancel_reason ? ` (${i.cancel_reason})` : ""}`}
                          </p>
                          {data.can.cancel_items && !i.cancelled_at && ["recebido", "em_preparo", "pronto"].includes(o.status) && (
                            <button
                              disabled={busy}
                              className="shrink-0 text-xs text-destructive underline"
                              aria-label={`Cancelar item ${i.name_snapshot}`}
                              onClick={() => setCancelling({ kind: "item", id: i.id, label: i.name_snapshot })}
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      ))}
                      {o.cancel_reason && o.status === "cancelado" && (
                        <p className="mt-2 text-xs text-muted-foreground">Motivo: {o.cancel_reason}</p>
                      )}
                      {o.status === "pronto" && (
                        <button
                          disabled={busy}
                          className={`${actionStyle} mt-4 w-full`}
                          onClick={() =>
                            void command({
                              action: "status",
                              order_id: o.id,
                              status: "entregue",
                            })
                          }
                        >
                          Marcar entregue
                        </button>
                      )}
                      {data.can.cancel_items && ["recebido", "em_preparo", "pronto"].includes(
                        o.status,
                      ) && (
                        <button
                          disabled={busy}
                          className="mt-3 text-sm text-destructive underline"
                          onClick={() => setCancelling({ kind: "order", id: o.id, label: `pedido de ${money(o.total_cents)}` })}
                        >
                          Cancelar pedido
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {cancelling && (
                  <form
                    className="cancel-sheet mt-4 space-y-3 rounded-2xl border border-destructive/40 bg-card p-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const chosen = String(f.get("reason") || "");
                      const detail = String(f.get("detail") || "").trim();
                      const reason = chosen === "Outro" ? detail || "Outro" : detail ? `${chosen}: ${detail}` : chosen;
                      void command(
                        cancelling.kind === "item"
                          ? { action: "cancel_item", item_id: cancelling.id, reason }
                          : { action: "status", order_id: cancelling.id, status: "cancelado", reason },
                      ).then(() => setCancelling(null));
                    }}
                  >
                    <p className="font-semibold">
                      Cancelar {cancelling.kind === "item" ? `o item ${cancelling.label}` : `o ${cancelling.label}`}?
                    </p>
                    <label className="block text-sm">
                      Motivo
                      <select name="reason" className="mt-1 w-full rounded-xl border bg-background p-3" defaultValue={CANCEL_REASONS[0]} aria-label="Motivo do cancelamento">
                        {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Detalhe (opcional)
                      <input name="detail" maxLength={150} className="mt-1 w-full rounded-xl border bg-background p-3" />
                    </label>
                    <div className="flex gap-3">
                      <button disabled={busy} className="rounded-xl bg-destructive px-4 py-3 font-semibold text-white">Confirmar cancelamento</button>
                      <button type="button" onClick={() => setCancelling(null)}>Voltar</button>
                    </div>
                  </form>
                )}
                {split.people.length > 0 && (
                  <div className="table-split">
                    <h3>Divisão da conta</h3>
                    {split.people.map((person) => {
                      const guestId = person.id;
                      return (
                        <div key={guestId ?? "sem-nome"} className="table-split-row">
                          <div>
                            <b>{person.name}</b>
                            <small>
                              {person.shared_cents > 0 &&
                                `Inclui ${money(person.shared_cents)} dividido. `}
                              {person.paid_cents !== null &&
                                !person.settled &&
                                `Já pagou ${money(person.paid_cents)}.`}
                            </small>
                          </div>
                          <span className="table-split-amount">
                            {money(person.settled ? person.due_cents : person.balance_cents)}
                          </span>
                          {guestId && data.can.register_payment &&
                            (person.settled ? (
                              <span className="table-split-done">
                                <span className="table-split-badge">
                                  <Check size={14} /> Pago
                                </span>
                              </span>
                            ) : (
                              <button
                                disabled={busy || person.balance_cents <= 0}
                                className="table-split-pay"
                                aria-label={`Registrar pagamento de ${person.name}`}
                                onClick={() => setPayForm({ guestId, amount: person.balance_cents })}
                              >
                                Registrar pagamento
                              </button>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="tab-totals">
                  <div><span>Itens</span><b>{money(totals.items_cents)}</b></div>
                  {(totals.fee_percent > 0 || totals.fee_waived) && (
                    <div>
                      <span>
                        Taxa de serviço {totals.fee_percent}%
                        {totals.fee_waived && <small> retirada</small>}
                        {(data.restaurant.service_fee_optional || data.can.apply_discount) && (
                          <button
                            disabled={busy}
                            className="ml-2 text-xs underline"
                            onClick={() => void command({ action: "fee", tab_id: tab.id, waived: !totals.fee_waived })}
                          >
                            {totals.fee_waived ? "Aplicar" : "Retirar"}
                          </button>
                        )}
                      </span>
                      <b>{money(totals.fee_cents)}</b>
                    </div>
                  )}
                  {(totals.discount_cents > 0 || data.can.apply_discount) && (
                    <div>
                      <span>
                        Desconto
                        {totals.discount_reason && <small> {totals.discount_reason}</small>}
                        {data.can.apply_discount && (
                          <button disabled={busy} className="ml-2 text-xs underline" onClick={() => setDiscountForm((v) => !v)}>
                            {totals.discount_cents > 0 ? "Alterar" : "Aplicar"}
                          </button>
                        )}
                      </span>
                      <b>{totals.discount_cents > 0 ? `− ${money(totals.discount_cents)}` : money(0)}</b>
                    </div>
                  )}
                  <div className="tab-totals-due"><span>Total</span><b>{money(totals.due_cents)}</b></div>
                  <div><span>Pago</span><b>{money(totals.paid_cents)}</b></div>
                  <div className={totals.balance_cents > 0 ? "tab-totals-balance" : "tab-totals-ok"}>
                    <span>{totals.balance_cents > 0 ? "Falta" : totals.balance_cents < 0 ? "Troco" : "Quitado"}</span>
                    <b>{money(Math.abs(totals.balance_cents))}</b>
                  </div>
                </div>
                {discountForm && data.can.apply_discount && (
                  <form
                    className="finance-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void command({
                        action: "discount",
                        tab_id: tab.id,
                        cents: Math.round(Number(f.get("value") || 0) * 100),
                        reason: String(f.get("reason") || ""),
                      }).then(() => setDiscountForm(false));
                    }}
                  >
                    <label>Desconto (R$)<input name="value" type="number" min={0} step="0.01" max={totals.items_cents / 100} defaultValue={totals.discount_cents / 100} aria-label="Valor do desconto" /></label>
                    <label>Motivo<input name="reason" maxLength={200} required defaultValue={totals.discount_reason ?? ""} aria-label="Motivo do desconto" /></label>
                    <div className="flex gap-3"><button disabled={busy} className={actionStyle}>Salvar desconto</button><button type="button" onClick={() => setDiscountForm(false)}>Voltar</button></div>
                  </form>
                )}
                {data.can.register_payment && (
                  <div className="payments-box">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b>Pagamentos</b>
                      <button
                        disabled={busy || totals.balance_cents <= 0}
                        className="text-sm underline"
                        onClick={() => setPayForm({ guestId: null, amount: Math.max(0, totals.balance_cents) })}
                      >
                        Registrar pagamento da mesa
                      </button>
                    </div>
                    {tabPayments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>}
                    {tabPayments.map((p) => (
                      <div key={p.id} className="payment-row">
                        <span>
                          {PAYMENT_LABELS[p.method]} • {p.guest_id ? tableGuests.find((g) => g.id === p.guest_id)?.name ?? "Pessoa" : "Mesa"}
                          <small>{new Date(p.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</small>
                        </span>
                        <b>{money(p.amount_cents)}</b>
                        <button
                          disabled={busy}
                          aria-label={`Desfazer pagamento de ${money(p.amount_cents)}`}
                          onClick={() => void command({ action: "void_payment", payment_id: p.id, reason: "Registrado errado" })}
                        >
                          Desfazer
                        </button>
                      </div>
                    ))}
                    {payForm && (
                      <form
                        className="finance-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void command({
                            action: "pay",
                            tab_id: tab.id,
                            guest_id: payForm.guestId,
                            method: String(f.get("method")),
                            amount_cents: Math.round(Number(f.get("amount") || 0) * 100),
                          }).then(() => setPayForm(null));
                        }}
                      >
                        <p className="text-sm">
                          {payForm.guestId ? `Pagamento de ${tableGuests.find((g) => g.id === payForm.guestId)?.name ?? "pessoa"}` : "Pagamento da mesa"}
                        </p>
                        <label>Forma<select name="method" defaultValue="pix" aria-label="Forma de pagamento">{(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
                        <label>Valor (R$)<input name="amount" type="number" min={0.01} step="0.01" required defaultValue={(payForm.amount / 100).toFixed(2)} aria-label="Valor recebido" /></label>
                        <div className="flex gap-3"><button disabled={busy} className={actionStyle}>Confirmar pagamento</button><button type="button" onClick={() => setPayForm(null)}>Voltar</button></div>
                      </form>
                    )}
                  </div>
                )}
                {closing ? (
                  <div className="rounded-2xl bg-secondary p-4">
                    {totals.balance_cents > 0 ? (
                      <p className="mb-3 font-semibold text-destructive">
                        Faltam {money(totals.balance_cents)}. Registre o pagamento antes de fechar.
                        {unpaid.length > 0 && ` Ainda falta pagar: ${unpaid.map((p) => `${p.name} (${money(p.balance_cents)})`).join(", ")}.`}
                      </p>
                    ) : (
                      <p>
                        Confirmar fechamento? O código e as sessões dos clientes
                        serão invalidados.
                      </p>
                    )}
                    <div className="mt-4 flex gap-3">
                      <button
                        disabled={busy || totals.balance_cents > 0}
                        className={actionStyle}
                        onClick={() =>
                          void command({ action: "close", tab_id: tab.id })
                        }
                      >
                        Confirmar fechamento
                      </button>
                      <button onClick={() => setClosing(false)}>Voltar</button>
                    </div>
                  </div>
                ) : data.can.close_tab ? (
                  <button
                    disabled={busy}
                    className="w-full rounded-xl border border-destructive p-4 text-destructive"
                    onClick={() => setClosing(true)}
                  >
                    Fechar comanda
                  </button>
                ) : (
                  <p className="text-center text-sm text-muted-foreground">
                    Peça a alguém com permissão para fechar a comanda.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
