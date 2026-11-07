/**
 * Gera app/panel-theme.generated.css: a identidade MesaClick dos painéis da
 * equipe (gestor, revenda, salão, cozinha, bar, login e hub).
 *
 * product.css e panels.css são compartilhados com o cardápio do cliente e
 * usam centenas de cores fixas em tons quentes. Em vez de editá-los, este
 * script copia cada regra que define cor, troca os tons quentes pelos da
 * MesaClick e prefixa o seletor com `body:has(.panel-theme)`. Só as páginas
 * dos painéis têm essa classe, então a visão do cliente continua igual.
 *
 * Mapeamento (HSL, só cores em hexadecimal: os CSS não usam rgb/hsl):
 *  - vermelhos, verdes, azuis, roxos e cinzas puros: mantidos (são estados:
 *    atraso, pronto, bar etc.);
 *  - âmbar saturado: mantido (chamadas e avisos);
 *  - laranja da marca antiga: vira o azul MesaClick, na mesma luminosidade;
 *  - neutros quentes (bege, marrom, oliva): viram neutros azulados.
 *  - Fraunces (serifa) vira Plus Jakarta, mais próxima da logo.
 *
 * Rode `npm run theme:panels` sempre que mudar product.css ou panels.css;
 * tests/panel-theme.test.ts falha se o arquivo gerado estiver desatualizado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postcss, { type Declaration, type Rule } from "postcss";

export const SOURCES = ["app/product.css", "app/panels.css"];
export const OUTPUT = "app/panel-theme.generated.css";
const SCOPE = "body:has(.panel-theme)";
const BLUE_HUE = 216;
const STATE_SELECTOR = /late|danger|destructive|cancel|error|alert|blocked|call-row|calling|call-badge/;

const COLOR_PROP =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(-color)?|font-family|--.+)$/;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

function toRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** Troca um tom quente pelo equivalente MesaClick; devolve null se não muda. */
export function mapColor(r: number, g: number, b: number): [number, number, number] | null {
  const [h, s, l] = toHsl(r, g, b);
  if (s < 6) return null; // branco, preto e cinzas puros
  if (h < 13 || h >= 90) return null; // vermelhos (atraso), verdes, azuis, roxos
  if (h >= 32 && h < 52 && s >= 65 && l < 88) return null; // âmbar: chamadas e avisos
  if (h < 32 && s >= 40) return toRgb(BLUE_HUE, Math.min(s, 92), l); // laranja da marca
  const ns = l < 35 ? clamp(s, 28, 45) : l < 70 ? clamp(s * 0.6, 10, 22) : clamp(s * 0.45, 14, 32);
  return toRgb(BLUE_HUE, ns, l);
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export function mapValue(value: string): string {
  return value
    .replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g, (whole, raw: string) => {
      const full = raw.length <= 4 ? [...raw].map((c) => c + c).join("") : raw;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      const mapped = mapColor(r, g, b);
      if (!mapped) return whole;
      return "#" + mapped.map(hex2).join("") + full.slice(6);
    })
    .replace(/var\(--font-fraunces\)(,\s*serif)?/g, "var(--font-jakarta), sans-serif");
}

function scopeSelector(selector: string): string | null {
  if (/(^|[\s,>+~(])(:root|html|body)\b/.test(selector)) return null;
  const pseudo = selector.match(/(::?(before|after|placeholder|selection|marker|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?)+$/);
  const base = pseudo ? selector.slice(0, -pseudo[0].length) : selector;
  return `${SCOPE} :is(${base.trim()})${pseudo ? pseudo[0] : ""}`;
}

export function buildPanelTheme(sources: { file: string; css: string }[]): string {
  const out = postcss.root();
  for (const { file, css } of sources) {
    const root = postcss.parse(css, { from: file });
    out.append(postcss.comment({ text: ` ${file} ` }));
    root.walkRules((rule: Rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as postcss.AtRule).name)) return;
      const decls = (rule.nodes ?? []).filter(
        (n): n is Declaration => n.type === "decl" && COLOR_PROP.test(n.prop) && (n.prop !== "font-family" || n.value.includes("fraunces")),
      );
      if (!decls.length) return;
      // Copia as declarações de cor mesmo sem tom quente, para manter a ordem
      // da cascata entre as regras copiadas (todas ganham o mesmo prefixo).
      const selectors = rule.selectors.map(scopeSelector).filter((s): s is string => !!s);
      if (!selectors.length) return;
      const copy = postcss.rule({ selectors });
      // Estados de alerta usam salmão/coral, perto do laranja antigo da marca:
      // nessas regras as cores ficam como estão.
      const keep = STATE_SELECTOR.test(rule.selector);
      for (const d of decls) copy.append(d.clone({ value: keep ? d.value.replace(/var\(--font-fraunces\)(,\s*serif)?/g, "var(--font-jakarta), sans-serif") : mapValue(d.value) }));
      // Reconstrói as @media/@supports em volta da regra.
      let node: postcss.Container = copy;
      let parent = rule.parent;
      while (parent && parent.type === "atrule") {
        const at = parent as postcss.AtRule;
        node = postcss.atRule({ name: at.name, params: at.params }).append(node);
        parent = at.parent;
      }
      out.append(node);
    });
  }
  const header =
    "/* Arquivo gerado por scripts/panel-theme.ts (npm run theme:panels). Não editar à mão. */\n";
  return header + out.toResult().css.replace(/\n{3,}/g, "\n\n") + "\n";
}

export function readSources(cwd: string) {
  return SOURCES.map((file) => ({ file, css: readFileSync(join(cwd, file), "utf8") }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
  const css = buildPanelTheme(readSources(cwd));
  writeFileSync(join(cwd, OUTPUT), css);
  console.log(`${OUTPUT}: ${css.length} bytes`);
}
