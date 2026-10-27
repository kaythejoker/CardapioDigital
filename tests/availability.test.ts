import assert from "node:assert/strict";
import { test } from "node:test";
import { unavailable, withinHours } from "../lib/availability";

// 12:30 e 23:30 em São Paulo (UTC-3).
const noon = new Date("2026-10-26T15:30:00Z");
const night = new Date("2026-10-27T02:30:00Z");

test("janela no mesmo dia, com fim exclusivo", () => {
  assert.equal(withinHours("11:00", "15:00", noon), true);
  assert.equal(withinHours("11:00:00", "12:30:00", noon), false);
  assert.equal(withinHours("18:00", "23:00", noon), false);
  assert.equal(withinHours(null, "15:00", noon), true);
});

test("janela que vira a meia-noite", () => {
  assert.equal(withinHours("22:00", "02:00", night), true);
  assert.equal(withinHours("22:00", "02:00", noon), false);
  assert.equal(withinHours("22:00", "02:00", new Date("2026-10-27T04:59:00Z")), true);
  assert.equal(withinHours("22:00", "02:00", new Date("2026-10-27T05:00:00Z")), false);
});

test("bloqueio vem antes do horário, e a categoria antes do item", () => {
  assert.equal(unavailable({}, undefined, noon), null);
  assert.deepEqual(unavailable({ blocked: true, blocked_reason: "acabou" }, undefined, noon), { kind: "blocked", reason: "acabou" });
  assert.deepEqual(
    unavailable({ blocked: true, blocked_reason: "item" }, { blocked: true, blocked_reason: "categoria" }, noon),
    { kind: "blocked", reason: "categoria" },
  );
  assert.deepEqual(
    unavailable({ available_from: "18:00:00", available_until: "23:00:00" }, undefined, noon),
    { kind: "hours", from: "18:00", until: "23:00" },
  );
  assert.deepEqual(
    unavailable({ blocked: true }, { available_from: "18:00", available_until: "23:00" }, noon),
    { kind: "blocked", reason: null },
  );
});
