"use client";

import { MenuPhoto } from "@/components/menu-photo";
import { BrandMark } from "@/components/brand-mark";
import { restaurantBrand } from "@/lib/restaurant-brand";
import { z } from "zod";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ChefHat,
  Bell,
  Clock,
  Check,
  ChevronRight,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  brandForeground,
  money,
  type CartLine,
  type CustomerOrder,
  type MenuData,
  type MenuItem,
} from "@/lib/menu-types";
import { splitTab, type SplitGuest } from "@/lib/split";

const NAME_STORAGE = "comanda:name";

export function Menu({
  slug,
  qrToken,
  initialMenu,
}: {
  slug: string;
  qrToken: string;
  initialMenu?: MenuData;
}) {
  const base = `/api/customer/${slug}/${qrToken}`;
  const storage = `cart:${slug}:${qrToken}`;
  const [menu, setMenu] = useState<MenuData | null>(initialMenu ?? null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("featured");
  const [screen, setScreen] = useState<
    "menu" | "cart" | "pin" | "tab" | "sent"
  >("menu");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [guests, setGuests] = useState<SplitGuest[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(0);
  const pendingRequest = useRef<string | null>(null);
  const cartReady = useRef(false);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [selected]);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/menu/${slug}/${qrToken}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMenu(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar");
    }
  }, [slug, qrToken]);
  useEffect(() => {
    const initial = setTimeout(() => {
      setHydrated(true);
      if (!initialMenu) void refresh();
      try {
        const schema = z
          .array(
            z.object({
              key: z.uuid(),
              item_id: z.uuid(),
              quantity: z.number().int().min(1).max(99),
              note: z.string().max(200),
              modifier_ids: z.array(z.uuid()).max(50),
              shared: z.boolean().default(false),
            }),
          )
          .max(50);
        const saved = schema.safeParse(
          JSON.parse(localStorage.getItem(storage) || "[]"),
        );
        if (saved.success) setCart(saved.data);
        setName(localStorage.getItem(NAME_STORAGE)?.slice(0, 40) ?? "");
      } catch {
        /* discard corrupt local cart */
      }
      cartReady.current = true;
    }, 0);
    const timer = setInterval(refresh, 8_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh, storage, initialMenu]);
  useEffect(() => {
    if (cartReady.current) localStorage.setItem(storage, JSON.stringify(cart));
  }, [cart, storage]);
  useEffect(() => {
    if (screen !== "tab") return;
    const update = async () => {
      try {
        const response = await fetch(base);
        const data = await response.json();
        if (!response.ok) {
          setError(data.error);
          if (response.status === 401) setScreen("pin");
          return;
        }
        setOrders(data.orders);
        setGuests(data.guests);
        setMe(data.me);
      } catch {
        setError("Sem conexão. Tentando atualizar sua comanda…");
      }
    };
    void update();
    const timer = setInterval(update, 10_000);
    return () => clearInterval(timer);
  }, [screen, base]);
  const post = async (body: unknown) => {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && screen !== "pin") setScreen("pin");
      throw new Error(data.error);
    }
    return data;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente");
    } finally {
      setBusy(false);
    }
  };
  const itemFor = (line: CartLine) =>
    menu?.items.find((i) => i.id === line.item_id);
  const unitPrice = (item: MenuItem, ids: string[]) =>
    item.price_cents +
    item.modifier_groups
      .flatMap((g) => g.modifiers)
      .filter((m) => ids.includes(m.id))
      .reduce((sum, m) => sum + m.price_cents, 0);
  const total = cart.reduce((sum, line) => {
    const item = itemFor(line);
    return (
      sum + (item ? unitPrice(item, line.modifier_ids) * line.quantity : 0)
    );
  }, 0);
  const openItem = (item: MenuItem, line?: CartLine) => {
    setSelected(item);
    setEditing(line?.key ?? null);
    setModifiers(line?.modifier_ids ?? []);
    setQuantity(line?.quantity ?? 1);
    setNote(line?.note ?? "");
    setError("");
  };
  const add = () => {
    if (!selected) return;
    for (const g of selected.modifier_groups) {
      const count = g.modifiers.filter((m) => modifiers.includes(m.id)).length;
      if (count < g.min_select || count > g.max_select) {
        setError(
          `Escolha de ${g.min_select} a ${g.max_select} opções em ${g.name}`,
        );
        return;
      }
    }
    const line = {
      key: editing ?? crypto.randomUUID(),
      item_id: selected.id,
      quantity,
      note,
      modifier_ids: modifiers,
      shared: cart.find((l) => l.key === editing)?.shared ?? false,
    };
    setCart((previous) =>
      editing
        ? previous.map((l) => (l.key === editing ? line : l))
        : [...previous, line],
    );
    pendingRequest.current = null;
    setSelected(null);
    if (!menu?.authorized) setScreen("pin");
  };
  if (!menu)
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <UtensilsCrossed className="mx-auto mb-5" />
        <h1 className="font-heading text-3xl">Seu cardápio</h1>
        <p role="status" className="mt-5">
          {error || "Preparando uma boa experiência…"}
        </p>
        {error && (
          <button className="mt-5 underline" onClick={refresh}>
            Tentar novamente
          </button>
        )}
      </main>
    );
  const brand = restaurantBrand(menu.restaurant);
  const style = {
    "--brand": brand.primary_color,
    "--menu-background": menu.restaurant.background_color || "#faf7f2",
    "--brand-foreground": brandForeground(brand.primary_color),
  } as CSSProperties;
  const back = () => {
    setScreen("menu");
    setError("");
  };
  const split = splitTab(guests, orders);
  const people = split.people.toSorted(
    (a, b) => Number(b.id === me) - Number(a.id === me),
  );
  const ordersOf = (id: string | null) =>
    orders.filter(
      (o) => (guests.some((g) => g.id === o.guest_id) ? o.guest_id : null) === id,
    );
  const primary =
    "rounded-[14px] bg-primary px-5 py-4 font-semibold text-primary-foreground disabled:opacity-50";
  return (
    <main
      style={style}
      className={`brand-scope customer-screen screen-${screen} mx-auto min-h-screen w-full max-w-xl pb-28`}
    >
      {error && (
        <div
          role="alert"
          className="sticky top-0 z-50 flex items-center justify-between bg-destructive p-4 text-white"
        >
          {error}
          <button aria-label="Fechar aviso" onClick={() => setError("")}>
            <X />
          </button>
        </div>
      )}
      {screen === "menu" && (
        <>
          <header className="menu-hero relative flex items-end overflow-hidden bg-stone-800 text-white">
            {menu.restaurant.cover_url && (
              <MenuPhoto slug={slug}
                src={menu.restaurant.cover_url}
                alt="Salão do restaurante"
                fill
                priority
                sizes="(max-width: 576px) 100vw, 576px"
                className="object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
            <div className="relative">
              {menu.restaurant.logo_url && (
                <MenuPhoto slug={slug}
                  src={menu.restaurant.logo_url}
                  alt={`Logo ${menu.restaurant.name}`}
                  width={56}
                  height={56}
                  className="mb-3 rounded-xl object-contain"
                />
              )}
              <h1 className="font-heading text-4xl font-semibold">
                {menu.restaurant.name}
              </h1>
              <span className="mt-3 inline-block rounded-full bg-background px-4 py-2 text-sm text-foreground">
                Mesa {menu.table.label}
              </span>
            </div>
          </header>
          <div className="menu-search sticky top-0 z-10 bg-background/95 backdrop-blur">
            <label className="flex items-center gap-3 rounded-3xl border bg-card p-4">
              <Search size={20} />
              <input
                disabled={!hydrated}
                aria-label="Buscar no cardápio"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar no cardápio"
                className="w-full bg-transparent outline-none"
              />
            </label>
            <nav
              aria-label="Categorias"
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {[{ id: "featured", name: "Destaques" }, ...menu.categories].map(
                (c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`shrink-0 rounded-full border px-5 py-3 text-sm ${category === c.id ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    {c.name}
                  </button>
                ),
              )}
            </nav>
          </div>
          {!menu.open && (
            <p className="closed-table-notice">
              Chame o garçom para abrir a mesa
            </p>
          )}
          <div className="menu-sections">
            {!search && category === "featured" && (
              <section>
                <h2 className="my-4 font-heading text-3xl">
                  Destaques da casa
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {menu.items
                    .filter((i) => i.featured)
                    .map((i) => (
                      <button
                        key={i.id}
                        onClick={() => openItem(i)}
                        className="featured-item overflow-hidden bg-card text-left"
                      >
                        {i.photo_url && (
                          <div className="relative aspect-[1.4]">
                            <MenuPhoto slug={slug}
                              src={i.photo_url}
                              alt={i.name}
                              fill
                              sizes="(max-width: 576px) 45vw, 260px"
                              className="object-cover"
                            />
                          </div>
                        )}
                        <div className="p-4">
                          <h3 className="font-heading text-xl">{i.name}</h3>
                          <p className="mt-2 font-bold text-primary">
                            {money(i.price_cents)}
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              </section>
            )}
            {menu.categories
              .filter(
                (c) => search || category === "featured" || c.id === category,
              )
              .map((c) => {
                const items = menu.items.filter(
                  (i) =>
                    i.category_id === c.id &&
                    `${i.name} ${i.description}`
                      .toLocaleLowerCase("pt-BR")
                      .includes(search.toLocaleLowerCase("pt-BR")),
                );
                return items.length ? (
                  <section key={c.id}>
                    <h2 className="mb-4 mt-7 font-heading text-3xl">
                      {c.name}
                    </h2>
                    <div className="space-y-3">
                      {items.map((i) => (
                        <button
                          key={i.id}
                          onClick={() => openItem(i)}
                          className="menu-list-item flex w-full overflow-hidden bg-card text-left"
                        >
                          <div className="flex-1 p-4">
                            <h3 className="font-heading text-xl">{i.name}</h3>
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {i.description}
                            </p>
                            <div className="mt-4 flex items-center justify-between">
                              <b className="text-primary">
                                {money(i.price_cents)}
                              </b>
                              {menu.open && (
                                <span className="rounded-full bg-primary p-2 text-primary-foreground">
                                  <Plus size={18} />
                                </span>
                              )}
                            </div>
                          </div>
                          {i.photo_url && (
                            <div className="relative w-32 shrink-0">
                              <MenuPhoto slug={slug}
                                src={i.photo_url}
                                alt={i.name}
                                fill
                                sizes="128px"
                                className="object-cover"
                              />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
            {search &&
              !menu.items.some((i) =>
                `${i.name} ${i.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && <p className="py-10 text-center">Nenhum item encontrado.</p>}
            <footer className="py-8 text-center text-sm text-muted-foreground">
              {brand.logo_url && (
                <MenuPhoto slug={slug}
                  src={brand.logo_url}
                  alt={brand.brand_name}
                  width={80}
                  height={40}
                  className="mx-auto mb-2 object-contain"
                />
              )}
              Por {brand.brand_name}
            </footer>
          </div>
          {menu.authorized && (
            <button
              className="mx-5 my-3 flex items-center gap-2 underline"
              onClick={() => setScreen("tab")}
            >
              <UtensilsCrossed size={18} /> Minha comanda
            </button>
          )}
          {cart.length > 0 && menu.open && (
            <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl p-4">
              <button
                className={`${primary} flex w-full items-center justify-between shadow-lg`}
                onClick={() => setScreen(menu.authorized ? "cart" : "pin")}
              >
                <span className="flex items-center gap-2">
                  <ShoppingBag size={20} /> Ver pedido •{" "}
                  {cart.reduce((n, l) => n + l.quantity, 0)} itens
                </span>
                <span>
                  {money(total)} <ChevronRight className="inline" size={18} />
                </span>
              </button>
            </div>
          )}
        </>
      )}
      {screen !== "menu" && (
        <header className="customer-subheader flex items-center gap-4 p-5">
          <button aria-label="Voltar ao cardápio" onClick={back}>
            <ArrowLeft />
          </button>
          <span>
            Mesa {menu.table.label} • {menu.restaurant.name}
          </span>
        </header>
      )}
      {screen === "pin" && (
        <section className="pin-screen text-center">
          <BrandMark className="pin-brand text-primary" />
          <h1 className="font-heading text-3xl">Digite o código da mesa</h1>
          <p className="my-4 text-muted-foreground">
            Peça o código de 4 dígitos ao garçom. Com o seu nome, cada pessoa
            da mesa vê a sua parte da conta.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await post({ action: "pin", pin, name: name.trim() });
                try {
                  localStorage.setItem(NAME_STORAGE, name.trim());
                } catch {
                  /* name is only a convenience */
                }
                setPin("");
                await refresh();
                setScreen(cart.length ? "cart" : "menu");
              });
            }}
          >
            <label className="pin-name">
              <span>Seu nome</span>
              <input
                autoFocus={!name}
                required
                maxLength={40}
                autoComplete="given-name"
                placeholder="Como te chamam na mesa?"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="pin-input-wrap"><div className="pin-boxes" aria-hidden="true">{Array.from({length:4}, (_,i) => <span className={pin.length === i ? "active" : ""} key={i}>{pin[i] || ""}</span>)}</div><input
              aria-label="Código de 4 dígitos"
              autoFocus={!!name}
              inputMode="none"
              autoComplete="one-time-code"
              maxLength={4}
              pattern="[0-9]{4}"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="pin-native-input"
            /></div>
            <div className="pin-keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(
                (digit, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={
                      digit === "⌫" ? "Apagar dígito" : digit || "Espaço"
                    }
                    disabled={!digit || busy}
                    onClick={() =>
                      setPin((p) =>
                        digit === "⌫"
                          ? p.slice(0, -1)
                          : (p + digit).slice(0, 4),
                      )
                    }
                    className="rounded-2xl bg-card py-4 text-2xl"
                  >
                    {digit}
                  </button>
                ),
              )}
            </div>
            <button
              disabled={busy || pin.length !== 4 || !name.trim()}
              className={`${primary} pin-submit mt-6 w-full ${pin.length < 4 ? "invisible" : ""}`}
            >
              {busy ? "Conferindo…" : "Confirmar código"}
            </button>
          </form>
        </section>
      )}
      {screen === "cart" && (
        <section className="p-5">
          <h1 className="mb-6 font-heading text-3xl">Seu pedido</h1>
          {cart.length === 0 && <p>Seu carrinho está vazio.</p>}
          <div className="space-y-3">
            {cart.map((line) => {
              const item = itemFor(line);
              return (
                <article key={line.key} className="rounded-[20px] bg-card p-5">
                  <h2 className="font-heading text-xl">
                    {line.quantity}× {item?.name || "Item indisponível"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {item?.modifier_groups
                      .flatMap((g) => g.modifiers)
                      .filter((m) => line.modifier_ids.includes(m.id))
                      .map((m) => m.name)
                      .join(" • ")}
                  </p>
                  {line.note && <p className="my-2 text-sm">{line.note}</p>}
                  <label className="cart-shared">
                    <input
                      type="checkbox"
                      checked={line.shared}
                      onChange={(e) => {
                        const shared = e.target.checked;
                        setCart((c) =>
                          c.map((l) => (l.key === line.key ? { ...l, shared } : l)),
                        );
                        pendingRequest.current = null;
                      }}
                      className="h-5 w-5 accent-primary"
                    />
                    <span>
                      Dividir com a mesa
                      <small>
                        O valor é dividido entre todos que já estão na comanda.
                      </small>
                    </span>
                  </label>
                  <div className="mt-4 flex items-center justify-between">
                    <b>
                      {item
                        ? money(
                            unitPrice(item, line.modifier_ids) * line.quantity,
                          )
                        : "Esgotado"}
                    </b>
                    <div className="flex gap-4">
                      {item && (
                        <button
                          className="underline"
                          onClick={() => openItem(item, line)}
                        >
                          Editar
                        </button>
                      )}
                      <button
                        className="text-destructive underline"
                        onClick={() => {
                          setCart((c) => c.filter((l) => l.key !== line.key));
                          pendingRequest.current = null;
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="my-6 flex justify-between text-xl">
            <span>Total</span>
            <b>{money(total)}</b>
          </div>
          <button
            className={`${primary} w-full`}
            disabled={
              busy ||
              !cart.length ||
              cart.some((l) => !itemFor(l)) ||
              !menu.open
            }
            onClick={() =>
              void run(async () => {
                pendingRequest.current ??= crypto.randomUUID();
                const data = await post({
                  action: "order",
                  request_id: pendingRequest.current,
                  items: cart.map(
                    ({ item_id, quantity, note, modifier_ids, shared }) => ({
                      item_id,
                      quantity,
                      note,
                      modifier_ids,
                      shared,
                    }),
                  ),
                });
                setEstimate(data.prep_minutes || 10);
                setCart([]);
                pendingRequest.current = null;
                setScreen("sent");
              })
            }
          >
            {busy ? "Enviando…" : "Enviar pedido"}
          </button>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Confira os itens e as observações antes de enviar.
          </p>
        </section>
      )}
      {screen === "sent" && (
        <section className="p-8 text-center">
          <div className="mx-auto my-12 flex h-24 w-24 animate-in zoom-in items-center justify-center rounded-full bg-success text-white">
            <Check size={48} />
          </div>
          <h1 className="font-heading text-4xl">Pedido enviado!</h1>
          <p className="my-5 text-muted-foreground">
            A cozinha já recebeu seu pedido.
            <br />
            Previsão: cerca de {estimate} minutos.
          </p>
          <button
            className={`${primary} w-full`}
            onClick={() => setScreen("tab")}
          >
            Acompanhar minha comanda
          </button>
          <button className="mt-6 underline" onClick={back}>
            Pedir mais
          </button>
        </section>
      )}
      {screen === "tab" && (
        <section className="customer-tab p-5">
          <h1 className="font-heading text-3xl">Comanda da mesa</h1><p className="tab-subtitle">Cada pessoa vê o que pediu e a sua parte da conta.</p>
          <div className="space-y-8">
            {people.map((person) => (
            <div key={person.id ?? "sem-nome"} className="tab-person">
              <header className="tab-person-header">
                <div>
                  <h2>{person.id === me ? `Você • ${person.name}` : person.name}</h2>
                  {person.shared_cents > 0 && (
                    <small>Inclui {money(person.shared_cents)} de itens divididos</small>
                  )}
                </div>
                <div>
                  <b>{money(person.due_cents)}</b>
                  {person.settled ? (
                    <span className="tab-person-status paid">Pago</span>
                  ) : person.paid_cents !== null ? (
                    <span className="tab-person-status due">Falta {money(person.balance_cents)}</span>
                  ) : null}
                </div>
              </header>
              {!ordersOf(person.id).length && (
                <p className="text-sm text-muted-foreground">Ainda não pediu nada.</p>
              )}
              <div className="space-y-4">
            {ordersOf(person.id).map((order) => (
              <article key={order.id} className="customer-order rounded-[20px] bg-card p-5"><header><h2>{order.status === "entregue" ? "Pedido anterior" : "Pedido em andamento"}</h2><small>#{order.id.slice(0,5).toUpperCase()}</small></header>
                <div className="mb-4 flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Sao_Paulo",
                    })}
                  </span>
                  <b>{money(order.total_cents)}</b>
                </div>
                {order.status === "cancelado" ? (
                  <p className="text-destructive">Cancelado</p>
                ) : (
                  <ol className="order-timeline">
                    {["recebido", "em_preparo", "pronto", "entregue"].map(
                      (status, index, all) => (
                        <li
                          key={status}
                          className={
                            all.indexOf(order.status) >= index
                              ? "text-primary"
                              : "text-muted-foreground"
                          }
                        >
                          <span className={`timeline-icon ${all.indexOf(order.status) >= index ? "complete" : ""}`}>{index === 0 ? <Check/> : index === 1 ? <ChefHat/> : index === 2 ? <Bell/> : <ShoppingBag/>}</span>
                          {
                            ["Recebido", "Em preparo", "Pronto", "Entregue"][
                              index
                            ]
                          }
                        </li>
                      ),
                    )}
                  </ol>
                )}
                {order.order_items.map((i) => (
                  <div key={i.id} className="tab-order-item">{menu.items.find(item => item.name === i.name_snapshot)?.photo_url && <div className="tab-item-photo"><MenuPhoto slug={slug} src={menu.items.find(item => item.name === i.name_snapshot)!.photo_url!} alt={i.name_snapshot} width={85} height={75}/></div>}<div><p className="tab-item-title">
                      {i.quantity}× {i.name_snapshot}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {i.modifiers_snapshot.map((m) => m.name).join(" • ")}
                      {i.note && ` • ${i.note}`}
                      {i.shared && " • Dividido com a mesa"}
                    </p></div><b>{money(i.unit_price_cents * i.quantity)}</b>
                  </div>
                ))}
                {["recebido", "em_preparo"].includes(order.status) && (
                  <p className="tab-estimate"><Clock size={19}/>
                    Previsão: cerca de {order.prep_minutes} min
                  </p>
                )}
                {order.status === "recebido" && order.guest_id === me && (
                  <button
                    disabled={busy}
                    className="mt-4 text-sm text-destructive underline"
                    onClick={() =>
                      void run(async () => {
                        await post({ action: "cancel", order_id: order.id });
                        setOrders((o) =>
                          o.map((x) =>
                            x.id === order.id
                              ? { ...x, status: "cancelado" }
                              : x,
                          ),
                        );
                      })
                    }
                  >
                    Cancelar pedido
                  </button>
                )}
              </article>
            ))}
              </div>
            </div>
            ))}
          </div>
          <div className="tab-total-bar"><div><span>Sua parte</span><b>{money(people.find((p) => p.id === me)?.due_cents ?? 0)}</b><small>Total da mesa: {money(split.total_cents)}</small></div><button onClick={back}><Plus size={17}/> Pedir mais</button></div>
        </section>
      )}
      {selected && (
        <div
          className="item-detail fixed inset-0 z-40 overflow-y-auto bg-background"
          role="dialog"
          aria-modal="true"
          aria-label={selected.name}
        >
          <div className="mx-auto max-w-xl pb-28">
            <div className="relative h-72 bg-secondary">
              {selected.photo_url && (
                <MenuPhoto slug={slug} detail
                  src={selected.photo_url}
                  alt={selected.name}
                  fill
                  sizes="(max-width: 576px) 100vw, 576px"
                  className="object-cover"
                />
              )}
              <button
                aria-label="Fechar detalhe"
                className="absolute left-5 top-5 rounded-full bg-card p-3"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft />
              </button>
            </div>
            <section className="item-detail-content relative -mt-6 rounded-t-[28px] p-6">
              <h2 className="font-heading text-3xl">{selected.name}</h2>
              <p className="my-3 text-muted-foreground">
                {selected.description}
              </p>
              <b className="text-xl text-primary">
                {money(selected.price_cents)}
              </b>
              {selected.modifier_groups
                .toSorted((a, b) => a.position - b.position)
                .map((g) => (
                  <fieldset key={g.id} className="mt-7">
                    <legend className="mb-3 w-full font-semibold">
                      {g.name}{" "}
                      <span className="float-right rounded-full bg-secondary px-3 py-1 text-xs">
                        {g.required ? "Obrigatório" : `Até ${g.max_select}`}
                      </span>
                    </legend>
                    {g.modifiers
                      .toSorted((a, b) => a.position - b.position)
                      .map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center justify-between border-b py-4"
                        >
                          <span>
                            {m.name}
                            {m.price_cents > 0 && (
                              <small className="ml-2 text-muted-foreground">
                                + {money(m.price_cents)}
                              </small>
                            )}
                          </span>
                          <input
                            type={g.max_select === 1 ? "radio" : "checkbox"}
                            name={g.id}
                            checked={modifiers.includes(m.id)}
                            onChange={() =>
                              setModifiers((ids) =>
                                ids.includes(m.id)
                                  ? ids.filter((id) => id !== m.id)
                                  : g.max_select === 1
                                    ? [
                                        ...ids.filter(
                                          (id) =>
                                            !g.modifiers.some(
                                              (x) => x.id === id,
                                            ),
                                        ),
                                        m.id,
                                      ]
                                    : [...ids, m.id],
                              )
                            }
                            className="h-5 w-5 accent-primary"
                          />
                        </label>
                      ))}
                  </fieldset>
                ))}
              <label className="mt-7 block font-semibold">
                Alguma observação?
                <textarea
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex.: sem cebola"
                  className="mt-3 w-full rounded-2xl border bg-background p-4 font-normal"
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </section>
            <div className="item-detail-actions fixed inset-x-0 bottom-0 mx-auto flex max-w-xl gap-4 border-t bg-card p-4">
              <div className="flex items-center gap-4">
                <button
                  aria-label="Diminuir quantidade"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => q - 1)}
                >
                  <Minus />
                </button>
                <b>{quantity}</b>
                <button
                  aria-label="Aumentar quantidade"
                  disabled={quantity >= 99}
                  onClick={() => setQuantity((q) => q + 1)}
                >
                  <Plus />
                </button>
              </div>
              <button
                className={`${primary} flex-1`}
                disabled={!menu.open}
                onClick={add}
              >
                {menu.open
                  ? `${editing ? "Salvar" : "Adicionar"} • ${money(unitPrice(selected, modifiers) * quantity)}`
                  : "Chame o garçom"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
