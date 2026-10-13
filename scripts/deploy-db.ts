/** Apply pending checked-in SQL through Management API without storing an access token. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const project = "yekmailbymutimhmddzx";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token)
  throw new Error(
    "Defina SUPABASE_ACCESS_TOKEN somente no ambiente do processo",
  );
async function query(sql: string) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new Error(`Management API: HTTP ${response.status}`);
  return response.json();
}
const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
async function main() {
  await query(
    "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text)",
  );
  const history = await query(
    "select version from supabase_migrations.schema_migrations",
  );
  const applied = new Set(
    history.map((row: { version: string }) => row.version),
  );
  const directory = join(import.meta.dirname, "..", "supabase", "migrations");
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const [version, ...parts] = file.replace(/\.sql$/, "").split("_");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(directory, file), "utf8");
    await query(
      `begin;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(parts.join("_"))},array[${quote(sql)}]);\ncommit;`,
    );
    console.log(`Aplicada: ${file}`);
  }
  console.log("Migrations sincronizadas");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Erro na implantação");
  process.exitCode = 1;
});
