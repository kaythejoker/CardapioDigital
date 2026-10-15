// Divisão da conta por pessoa. Usado pelo cliente (comanda da mesa) e pelo garçom.
// Item próprio: conta inteira de quem pediu. Item "dividido com a mesa": valor
// repartido igualmente entre quem já estava na comanda quando o pedido foi
// enviado; os centavos que sobram ficam com quem pediu.

export type SplitGuest = {
  id: string;
  name: string;
  created_at: string;
  paid_cents: number | null;
};
export type SplitOrder = {
  id: string;
  guest_id: string | null;
  status: string;
  created_at: string;
  order_items: { unit_price_cents: number; quantity: number; shared?: boolean }[];
};
export type PersonShare = {
  /** null = pedidos feitos antes da divisão por pessoa (sem nome). */
  id: string | null;
  name: string;
  own_cents: number;
  shared_cents: number;
  due_cents: number;
  paid_cents: number | null;
  balance_cents: number;
  settled: boolean;
};

export function splitTab(guests: SplitGuest[], orders: SplitOrder[]) {
  const people = guests.toSorted(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  const own = new Map<string | null, number>();
  const shared = new Map<string | null, number>();
  const add = (map: Map<string | null, number>, id: string | null, cents: number) =>
    map.set(id, (map.get(id) ?? 0) + cents);
  let total = 0;
  for (const order of orders) {
    if (order.status === "cancelado") continue;
    const owner = people.some((p) => p.id === order.guest_id)
      ? order.guest_id
      : null;
    for (const item of order.order_items) {
      const cents = item.unit_price_cents * item.quantity;
      total += cents;
      if (!item.shared || owner === null) {
        add(own, owner, cents);
        continue;
      }
      const present = people.filter(
        (p) => Date.parse(p.created_at) <= Date.parse(order.created_at),
      );
      const among = present.some((p) => p.id === owner)
        ? present
        : [...present, people.find((p) => p.id === owner)!];
      const part = Math.floor(cents / among.length);
      for (const p of among) add(shared, p.id, part);
      add(shared, owner, cents - part * among.length);
    }
  }
  const share = (id: string | null, name: string, paid: number | null): PersonShare => {
    const due = (own.get(id) ?? 0) + (shared.get(id) ?? 0);
    const balance = due - (paid ?? 0);
    return {
      id,
      name,
      own_cents: own.get(id) ?? 0,
      shared_cents: shared.get(id) ?? 0,
      due_cents: due,
      paid_cents: paid,
      balance_cents: balance,
      settled: paid !== null && balance <= 0,
    };
  };
  const result = people.map((p) => share(p.id, p.name, p.paid_cents));
  if (own.has(null)) result.push(share(null, "Sem nome", null));
  return { people: result, total_cents: total };
}
