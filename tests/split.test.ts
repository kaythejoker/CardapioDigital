import assert from "node:assert/strict";
import { test } from "node:test";
import { splitTab, type SplitGuest, type SplitOrder } from "../lib/split";

const at = (minute: number) =>
  new Date(Date.parse("2026-10-15T20:00:00Z") + minute * 60_000).toISOString();
const guest = (id: string, minute: number, paid: number | null = null): SplitGuest => ({
  id,
  name: id.toUpperCase(),
  created_at: at(minute),
  paid_cents: paid,
});
const order = (
  guestId: string | null,
  minute: number,
  items: [number, number, boolean?][],
  status = "recebido",
): SplitOrder => ({
  id: `${guestId}-${minute}`,
  guest_id: guestId,
  status,
  created_at: at(minute),
  order_items: items.map(([unit_price_cents, quantity, shared]) => ({
    unit_price_cents,
    quantity,
    shared,
  })),
});
const byId = (result: ReturnType<typeof splitTab>) =>
  Object.fromEntries(result.people.map((p) => [p.id ?? "sem", p]));

test("cada pessoa paga os próprios itens", () => {
  const result = byId(
    splitTab(
      [guest("ana", 0), guest("bia", 1)],
      [order("ana", 2, [[3290, 1]]), order("bia", 3, [[1500, 2]])],
    ),
  );
  assert.equal(result.ana.due_cents, 3290);
  assert.equal(result.bia.due_cents, 3000);
});

test("item da mesa é dividido entre quem estava, sobra fica com quem pediu", () => {
  const result = splitTab(
    [guest("ana", 0), guest("bia", 1), guest("caio", 2)],
    [order("bia", 5, [[10000, 1, true]])],
  );
  const people = byId(result);
  assert.equal(people.ana.shared_cents, 3333);
  assert.equal(people.bia.shared_cents, 3334);
  assert.equal(people.caio.shared_cents, 3333);
  assert.equal(
    result.people.reduce((sum, p) => sum + p.due_cents, 0),
    result.total_cents,
  );
});

test("quem chegou depois não divide itens anteriores", () => {
  const people = byId(
    splitTab(
      [guest("ana", 0), guest("bia", 1), guest("caio", 10)],
      [order("ana", 5, [[8000, 1, true]])],
    ),
  );
  assert.equal(people.ana.due_cents, 4000);
  assert.equal(people.bia.due_cents, 4000);
  assert.equal(people.caio.due_cents, 0);
});

test("pedidos cancelados não entram na conta", () => {
  const result = splitTab(
    [guest("ana", 0)],
    [order("ana", 1, [[5000, 1]], "cancelado"), order("ana", 2, [[1000, 1]])],
  );
  assert.equal(result.total_cents, 1000);
  assert.equal(result.people[0].due_cents, 1000);
});

test("pagamento registrado quita; pedido novo depois do pagamento reabre o saldo", () => {
  const paid = byId(splitTab([guest("ana", 0, 2000)], [order("ana", 1, [[2000, 1]])]));
  assert.equal(paid.ana.settled, true);
  const later = byId(
    splitTab(
      [guest("ana", 0, 2000)],
      [order("ana", 1, [[2000, 1]]), order("ana", 30, [[900, 1]])],
    ),
  );
  assert.equal(later.ana.settled, false);
  assert.equal(later.ana.balance_cents, 900);
});

test("item cancelado individualmente sai da conta de quem pediu e da divisão", () => {
  const result = splitTab(
    [guest("ana", 0), guest("bia", 1)],
    [
      {
        ...order("ana", 2, [[3000, 1]]),
        order_items: [
          { unit_price_cents: 3000, quantity: 1, cancelled_at: at(3) },
          { unit_price_cents: 1000, quantity: 2 },
          { unit_price_cents: 4000, quantity: 1, shared: true, cancelled_at: at(3) },
        ],
      },
    ],
  );
  const people = byId(result);
  assert.equal(result.total_cents, 2000);
  assert.equal(people.ana.due_cents, 2000);
  assert.equal(people.bia.due_cents, 0);
});

test("pedidos antigos sem nome aparecem separados", () => {
  const result = byId(
    splitTab([guest("ana", 0)], [order(null, 1, [[4500, 1, true]]), order("ana", 2, [[100, 1]])]),
  );
  assert.equal(result.sem.name, "Sem nome");
  assert.equal(result.sem.due_cents, 4500);
  assert.equal(result.ana.due_cents, 100);
});
