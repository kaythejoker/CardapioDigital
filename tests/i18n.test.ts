import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLocale, localized, translate } from "../lib/i18n";
import { EN, ES } from "../lib/i18n-dict";
import { collectKeys } from "./i18n-keys";

test("toda frase das telas tem inglês e espanhol", () => {
  const missing = [...collectKeys()]
    .filter(([key]) => !EN[key] || !ES[key])
    .map(([key, where]) => `${where}: ${key}`);
  assert.deepEqual(missing, []);
});

test("as traduções mantêm as mesmas {variáveis}", () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const key of Object.keys(EN)) {
    assert.equal(vars(EN[key]), vars(key), `EN: ${key}`);
    assert.equal(vars(ES[key]), vars(key), `ES: ${key}`);
  }
});

test("translate preenche variáveis e cai no português sem tradução", () => {
  assert.equal(translate("en", "Mesa {label}", { label: 7 }), "Table 7");
  assert.equal(translate("es", "Mesa {label}", { label: 7 }), "Mesa 7");
  assert.equal(translate("pt", "Mesa {label}", { label: 7 }), "Mesa 7");
  assert.equal(translate("en", "Frase que não existe"), "Frase que não existe");
});

test("mensagens do banco com trechos variáveis", () => {
  assert.equal(translate("en", "Picanha não está disponível agora"), "Picanha isn't available right now");
  assert.equal(translate("es", "Pedidos pausados: cozinha lotada"), "Pedidos en pausa: cozinha lotada");
  assert.equal(translate("en", "Restam 2 unidades de Pudim"), "Only 2 left of Pudim");
});

test("idioma do navegador e campos do cardápio", () => {
  assert.equal(detectLocale(["es-AR", "en"]), "es");
  assert.equal(detectLocale(["fr-FR"]), "pt");
  const tr = { en: { name: "Cheese bread", description: " " } };
  assert.equal(localized("en", "Pão de queijo", tr), "Cheese bread");
  assert.equal(localized("en", "Quentinho", tr, "description"), "Quentinho");
  assert.equal(localized("es", "Pão de queijo", tr), "Pão de queijo");
});
