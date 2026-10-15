"use client";
import { restaurantBrand } from "@/lib/restaurant-brand";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Bell,
  Flame,
  Check,
  MessageSquare,
  ChefHat,
  Clock,
  LogOut,
  Pin,
  RefreshCw,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isLate, sortQueue, type QueueSettings } from "@/lib/priority";
import {
  brandForeground,
  money,
  type CustomerOrder,
  type MenuItem,
} from "@/lib/menu-types";
import { splitTab, type SplitGuest } from "@/lib/split";

export type StaffOrder = CustomerOrder & {
  tab_id: string;
  pinned: boolean;
  started_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
};
export type OperationData = {
  staff_name?: string;
  restaurant_id: string;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    primary_color?: string | null;
    resellers: {
      brand_name: string;
      primary_color: string;
      logo_url: string | null;
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
  }[];
  guests: (SplitGuest & { tab_id: string })[];
  orders: StaffOrder[];
  items: (MenuItem & {
    sold_out: boolean;
    active: boolean;
    position: number;
  })[];
  categories: { id: string; name: string; position: number; active: boolean }[];
  settings: QueueSettings;
};

export function Operation({ role }: { role: "cozinha" | "garcom" }) {
  const router = useRouter();
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
  const [connection, setConnection] = useState("Conectando…");
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
        .subscribe((status) =>
          setConnection(status === "SUBSCRIBED" ? "Ao vivo" : "Reconectando…"),
        );
    })();
    return () => {
      disposed = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [id, role, refresh]);
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
  const activeOrders = data.orders.filter((o) =>
    ["recebido", "em_preparo", "pronto"].includes(o.status),
  );
  const ready = activeOrders.filter((o) => o.status === "pronto");
  // Sorting only changes every 30s or with newly fetched orders.
  const queueNow = Math.floor(now / 30_000) * 30_000;
  const queue = sortQueue(
    activeOrders.filter((o) => o.status !== "pronto"),
    data.settings,
    queueNow,
  );
  const tableForOrder = (order: StaffOrder) =>
    data.tables.find(
      (t) =>
        t.id === data.tabs.find((tab) => tab.id === order.tab_id)?.table_id,
    )?.label || "—";
  const elapsed = (created: string) => {
    const seconds = Math.max(0, Math.floor((now - Date.parse(created)) / 1000));
    return `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  };
  const selected = data.tables.find((t) => t.id === selectedTable);
  const tab = data.tabs.find((t) => t.table_id === selectedTable);
  const tableOrders = data.orders.filter((o) => o.tab_id === tab?.id);
  const tableGuests = data.guests.filter((g) => g.tab_id === tab?.id);
  const split = splitTab(tableGuests, tableOrders);
  const unpaid = split.people.filter((p) => !p.settled && p.balance_cents > 0);
  const actionStyle =
    "rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50";
  return (
    <main
      style={style}
      className={`${role === "cozinha" ? "dark kitchen-screen" : "waiter-screen"} brand-scope min-h-screen bg-background text-foreground`}
    >
      <header className="operation-header">
        <div className="flex items-center gap-3">
          {role === "cozinha" ? <Flame className="kitchen-flame" /> : <UtensilsCrossed />}
          <div>
            <h1 className="font-heading text-2xl">
              {role === "cozinha" ? `Cozinha • ${data.restaurant.name}` : `Olá, ${data.staff_name?.split(" ")[0] || "equipe"}`}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {role === "cozinha" ? "Sabor no tempo certo." : data.restaurant.name}
            </p>
          </div>
        </div>
        <div className="operation-tools">
          {role === "cozinha" && <><span className="kitchen-mode"><Clock size={20}/>{{fifo:"Ordem de chegada",complexity:"Complexidade",balanced:"Equilibrado"}[data.settings.mode]}</span><span className="kitchen-count"><ChefHat size={27}/><span><b>{queue.length} na fila</b><small>Pedidos pendentes</small></span></span></>}
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
          <button onClick={refresh} aria-label="Atualizar">
            <RefreshCw size={20} />
          </button>
          <Link href="/app" className="text-sm underline">
            Painéis
          </Link>
          <button aria-label="Sair" onClick={logout}>
            <LogOut size={20} />
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="bg-destructive p-4 text-white">
          {error}
        </p>
      )}
      {role === "cozinha" ? (
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
                .filter((i) => i.active)
                .map((i) => (
                  <label
                    key={i.id}
                    className="flex items-center justify-between rounded-2xl border bg-card p-5 text-xl"
                  >
                    <span>{i.name}</span>
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
                  return <article key={order.id} className={"kitchen-ticket " + (late ? "ticket-late" : order.status === "em_preparo" ? "ticket-cooking" : "")}>
                    <div className="ticket-heading"><h2 aria-label={"Mesa " + label}><span>Mesa</span><strong className={label.length > 4 ? "long-table-label" : ""}>{label}</strong></h2><div className="ticket-meta"><div className="ticket-status"><span className={"order-badge " + (late ? "late" : order.status === "em_preparo" ? "cooking" : "waiting")}>{late ? "Atrasado" : order.status === "em_preparo" ? "Em preparo" : "Aguardando"}</span><button aria-label={order.pinned ? "Desafixar pedido" : "Fixar pedido"} disabled={busy} onClick={() => void command({action:"pin",order_id:order.id,pinned:!order.pinned})}><Pin size={18} className={order.pinned ? "fill-primary text-primary" : "text-muted-foreground"}/></button></div><div className="ticket-timer"><Clock/>{elapsed(order.created_at)}</div><p>Tempo de preparo: {order.prep_minutes} min</p></div></div>
                    <div className="ticket-items">{order.order_items.map(item => <div key={item.id} className="ticket-item"><div><h3>{item.quantity}× {item.name_snapshot}</h3>{item.modifiers_snapshot.length > 0 && <p>{item.modifiers_snapshot.map(m => m.name).join(" • ")}</p>}</div>{item.note && <span className="ticket-note"><MessageSquare size={17}/>{item.note}</span>}</div>)}</div>
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
          <div className="my-4 flex items-center justify-between">
            <h2 className="font-heading text-3xl">Suas mesas</h2>
            <span
              role="status"
              className="flex items-center gap-2 rounded-full bg-[#2F7D5B] px-4 py-2 text-sm text-white"
            >
              <Bell size={16} />
              {ready.length} pedidos prontos
            </span>
          </div>
          <nav className="my-6 flex flex-wrap gap-2">
            {[
              ["all", "Todas"],
              ["occupied", "Ocupadas"],
              ["free", "Livres"],
              ["ready", "Prontos"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setView(value)}
                className={`rounded-full border px-5 py-3 ${view === value ? "bg-primary text-primary-foreground" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="waiter-tables">
            {data.tables
              .filter((t) => t.active)
              .toSorted((a, b) =>
                a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
              )
              .filter((t) => {
                const tab = data.tabs.find((b) => b.table_id === t.id);
                const hasReady = ready.some((o) => o.tab_id === tab?.id);
                return (
                  view === "all" ||
                  (view === "occupied" && tab) ||
                  (view === "free" && !tab) ||
                  (view === "ready" && hasReady)
                );
              })
              .map((t) => {
                const tab = data.tabs.find((b) => b.table_id === t.id);
                const orders = data.orders.filter(
                  (o) => o.tab_id === tab?.id && o.status !== "cancelado",
                );
                const hasReady = orders.some((o) => o.status === "pronto");
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTable(t.id);
                      setClosing(false);
                      setShowOrders(false);
                    }}
                    className={`waiter-table ${hasReady ? "ready" : tab ? "occupied" : "free"}`}
                  >
                    <span className="text-sm text-muted-foreground">Mesa</span>
                    <h3 className="my-2 font-heading text-4xl">{t.label}</h3>
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
                        <b className="mt-2 block">
                          {money(
                            orders.reduce((sum, o) => sum + o.total_cents, 0),
                          )}
                        </b>
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
              <h2 className="font-heading text-3xl">Mesa {selected.label}</h2>
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
                        </b>
                        <b>{money(o.total_cents)}</b>
                      </div>
                      {o.order_items.map((i) => (
                        <p key={i.id} className="mt-2 text-sm">
                          {i.quantity}× {i.name_snapshot}
                          {i.note && ` • ${i.note}`}
                          {i.shared && " • dividido com a mesa"}
                        </p>
                      ))}
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
                      {["recebido", "em_preparo", "pronto"].includes(
                        o.status,
                      ) && (
                        <button
                          disabled={busy}
                          className="mt-3 text-sm text-destructive underline"
                          onClick={() =>
                            void command({
                              action: "status",
                              order_id: o.id,
                              status: "cancelado",
                            })
                          }
                        >
                          Cancelar pedido
                        </button>
                      )}
                    </article>
                  ))}
                </div>
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
                          {guestId &&
                            (person.settled ? (
                              <span className="table-split-done">
                                <span className="table-split-badge">
                                  <Check size={14} /> Pago
                                </span>
                                <button
                                  disabled={busy}
                                  aria-label={`Desfazer pagamento de ${person.name}`}
                                  onClick={() =>
                                    void command({ action: "paid", guest_id: guestId, paid_cents: null })
                                  }
                                >
                                  desfazer
                                </button>
                              </span>
                            ) : (
                              <button
                                disabled={busy || person.due_cents === 0}
                                className="table-split-pay"
                                aria-label={`Marcar ${person.name} como pago`}
                                onClick={() =>
                                  void command({
                                    action: "paid",
                                    guest_id: guestId,
                                    paid_cents: person.due_cents,
                                  })
                                }
                              >
                                Marcar pago
                              </button>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="my-6 flex justify-between text-lg">
                  <span>Total consumido</span>
                  <b>
                    {money(
                      tableOrders
                        .filter((o) => o.status !== "cancelado")
                        .reduce((sum, o) => sum + o.total_cents, 0),
                    )}
                  </b>
                </div>
                {closing ? (
                  <div className="rounded-2xl bg-secondary p-4">
                    {unpaid.length > 0 && (
                      <p className="mb-3 font-semibold text-destructive">
                        Ainda falta pagar:{" "}
                        {unpaid
                          .map((p) => `${p.name} (${money(p.balance_cents)})`)
                          .join(", ")}
                        .
                      </p>
                    )}
                    <p>
                      Confirmar fechamento? O código e as sessões dos clientes
                      serão invalidados.
                    </p>
                    <div className="mt-4 flex gap-3">
                      <button
                        disabled={busy}
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
                ) : (
                  <button
                    disabled={busy}
                    className="w-full rounded-xl border border-destructive p-4 text-destructive"
                    onClick={() => setClosing(true)}
                  >
                    Fechar comanda
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
