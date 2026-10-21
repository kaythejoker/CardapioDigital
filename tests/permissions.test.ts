import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canOpenManagerPanel,
  defaultPermission,
  effectivePermissions,
  PERMISSIONS,
} from "../lib/permissions";

test("gestor tem tudo, mesmo com ajuste negativo", () => {
  const can = effectivePermissions(["manager", "waiter"], { close_tab: false });
  for (const { key } of PERMISSIONS) assert.equal(can[key], true, key);
});

test("garçom tem só o padrão do salão", () => {
  const can = effectivePermissions(["waiter"], null);
  assert.deepEqual(
    Object.entries(can)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .toSorted(),
    ["cancel_items", "close_tab", "merge_tables", "register_payment"],
  );
  assert.equal(defaultPermission(["waiter"], "apply_discount"), false);
});

test("cozinha e bar não têm nada por padrão; ajuste por pessoa liga e desliga", () => {
  assert.equal(effectivePermissions(["kitchen"], undefined).cancel_items, false);
  assert.equal(effectivePermissions(["bar"], { edit_menu: true }).edit_menu, true);
  assert.equal(effectivePermissions(["waiter"], { close_tab: false }).close_tab, false);
  assert.equal(effectivePermissions(["waiter", "kitchen"], {}).close_tab, true);
});

test("painel do gestor abre para gestor ou quem tem permissão de gestão", () => {
  assert.equal(canOpenManagerPanel(["manager"], {}), true);
  assert.equal(canOpenManagerPanel(["waiter"], {}), false);
  assert.equal(canOpenManagerPanel(["waiter"], { view_reports: true }), true);
  assert.equal(canOpenManagerPanel(["kitchen"], { close_tab: true }), false);
});
