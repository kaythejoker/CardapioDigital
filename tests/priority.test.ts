import assert from "node:assert/strict";
import { test } from "node:test";
import { sortQueue, isLate, type QueueSettings } from "../lib/priority";

const now = Date.parse("2026-10-09T15:00:00Z");
const order = (id: string, wait: number, prep: number, pinned = false) => ({
  id,
  created_at: new Date(now - wait * 60_000).toISOString(),
  prep_minutes: prep,
  pinned,
});
const settings: QueueSettings = {
  mode: "balanced",
  weight_wait: 1,
  weight_complexity: 1,
  max_wait_minutes: 20,
};
const ids = (mode: QueueSettings["mode"]) =>
  sortQueue(
    [order("old", 10, 2), order("complex", 1, 15)],
    { ...settings, mode },
    now,
  ).map((x) => x.id);

test("three rules produce the expected order", () => {
  assert.deepEqual(ids("fifo"), ["old", "complex"]);
  assert.deepEqual(ids("complexity"), ["complex", "old"]);
  assert.deepEqual(ids("balanced"), ["complex", "old"]);
});
test("pin and maximum wait override all rules without mutating input", () => {
  for (const mode of ["fifo", "complexity", "balanced"] as const) {
    const input = [
      order("complex", 1, 200),
      order("overdue", 21, 1),
      order("pin", 0, 1, true),
    ];
    assert.deepEqual(
      sortQueue(input, { ...settings, mode }, now).map((x) => x.id),
      ["pin", "overdue", "complex"],
    );
    assert.equal(input[0].id, "complex");
  }
});
test("strict late boundary and deterministic tie", () => {
  assert.equal(isLate(order("a", 15, 10), now), false);
  assert.equal(isLate(order("a", 15.01, 10), now), true);
  assert.deepEqual(
    sortQueue([order("b", 1, 10), order("a", 1, 10)], settings, now).map(
      (x) => x.id,
    ),
    ["a", "b"],
  );
});
test("balanced weights can favor wait and overdue uses strict limit", () => {
  const input = [order("wait", 20, 1), order("prep", 1, 40)];
  assert.equal(sortQueue(input, settings, now)[0].id, "prep");
  assert.equal(
    sortQueue(input, { ...settings, weight_wait: 3 }, now)[0].id,
    "wait",
  );
  assert.equal(
    sortQueue([order("wait", 20.01, 1), input[1]], settings, now)[0].id,
    "wait",
  );
});
