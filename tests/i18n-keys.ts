// Frases que a interface traduz (spec-fase3.md, seção 3): t("..."), tr("..."),
// msg("..."), <T>{"..."}</T>, os rótulos das constantes compartilhadas e as
// mensagens de erro das rotas, que o painel mostra com t(error).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, STATUS_LABELS } from "../lib/features";
import { PERMISSIONS, ROLE_LABELS } from "../lib/permissions";
import { PERIODS } from "../lib/periods";
import { SURVEY_TAGS } from "../lib/menu-types";
import { EN, ES } from "../lib/i18n-dict";

// Os testes rodam na raiz do projeto.
const root = process.cwd();

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });
}

const unquote = (s: string) => JSON.parse(`"${s}"`) as string;

export function collectKeys() {
  const keys = new Map<string, string>();
  const add = (key: string, where: string) => {
    if (key.trim() && !keys.has(key)) keys.set(key, where);
  };
  const sources = [...files(join(root, "components"), /\.tsx?$/), ...files(join(root, "app"), /\.tsx?$/), ...files(join(root, "lib"), /\.tsx?$/)];
  for (const file of sources) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(root.length + 1);
    for (const m of src.matchAll(/\b(?:t|tr|msg)\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unquote(m[1]), rel);
    for (const m of src.matchAll(/<T\b[^>]*>\{"((?:[^"\\]|\\.)*)"\}<\/T>/g)) add(unquote(m[1]), rel);
    // Erros das rotas e dos módulos do servidor que chegam ao painel.
    if (/[\\/](api)[\\/]|lib[\\/](manage-access|customer|menu-data|waitlist)\.ts$/.test(file))
      for (const m of src.matchAll(/error: "((?:[^"\\]|\\.)*)"/g)) add(unquote(m[1]), rel);
  }
  for (const f of FEATURES) {
    add(f.label, "lib/features.ts");
    add(f.hint, "lib/features.ts");
  }
  for (const v of Object.values(STATUS_LABELS)) add(v, "lib/features.ts");
  for (const p of PERMISSIONS) {
    add(p.label, "lib/permissions.ts");
    add(p.group, "lib/permissions.ts");
  }
  for (const v of Object.values(ROLE_LABELS)) add(v, "lib/permissions.ts");
  for (const p of PERIODS) add(p.label, "lib/periods.ts");
  for (const tag of SURVEY_TAGS) add(tag, "lib/menu-types.ts");
  // A marca não se traduz.
  keys.delete("Comanda");
  return keys;
}

if (process.argv[1]?.endsWith("i18n-keys.ts")) {
  // npx tsx tests/i18n-keys.ts: lista as frases sem inglês ou espanhol.
  const missing = [...collectKeys()].filter(([k]) => !(k in EN) || !(k in ES));
  console.log(JSON.stringify(missing.map(([k, where]) => ({ k, where })), null, 1));
  console.error(`${missing.length} frases sem tradução`);
}
