import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lastActivity, tableState } from "../lib/table-state";

const now = Date.parse("2026-11-12T20:30:00-03:00");
const ago = (m: number) => new Date(now - m * 60_000).toISOString();
const tab = { id: "t1", opened_at: ago(30) };

test("mesa sem comanda é verde", () => {
  assert.equal(tableState(undefined, [], now, false), "free");
});

test("pedido recente deixa a mesa vermelha", () => {
  assert.equal(tableState(tab, [{ tab_id: "t1", created_at: ago(3) }], now, false), "occupied");
});

test("10 minutos sem pedido deixa a mesa azul", () => {
  assert.equal(tableState(tab, [{ tab_id: "t1", created_at: ago(10) }], now, false), "idle");
  assert.equal(tableState({ ...tab, opened_at: ago(11) }, [], now, false), "idle");
  assert.equal(tableState({ ...tab, opened_at: ago(9) }, [], now, false), "occupied");
});

test("pediu a conta fica laranja, mesmo ociosa", () => {
  assert.equal(tableState(tab, [], now, true), "closing");
});

test("só pedidos da própria comanda contam", () => {
  assert.equal(lastActivity(tab, [{ tab_id: "t2", created_at: ago(1) }]), Date.parse(tab.opened_at));
});
