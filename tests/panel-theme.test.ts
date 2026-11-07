import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPanelTheme, mapColor, OUTPUT, readSources } from "../scripts/panel-theme";

test("app/panel-theme.generated.css está em dia com product.css e panels.css", () => {
  const expected = buildPanelTheme(readSources(process.cwd()));
  const current = readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(current, expected, "rode `npm run theme:panels`");
});

test("tons quentes viram MesaClick; estados ficam", () => {
  assert.ok(mapColor(0xe0, 0x55, 0x2b), "laranja da marca antiga muda");
  assert.ok(mapColor(0xf8, 0xed, 0xdd), "bege muda");
  assert.equal(mapColor(0xc2, 0x49, 0x2d), null, "vermelho de atraso fica");
  assert.equal(mapColor(0x2f, 0x7d, 0x5b), null, "verde de pronto fica");
  assert.equal(mapColor(0xd9, 0x9a, 0x17), null, "âmbar de chamada fica");
  assert.equal(mapColor(0xff, 0xff, 0xff), null, "branco fica");
});
