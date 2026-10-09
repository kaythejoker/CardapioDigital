/**
 * Valida as migrations e o seed sem Docker: sobe um Postgres em memória
 * (PGlite), simula o mínimo do Supabase (roles, auth.uid(), publicação do
 * Realtime) e confere o RLS e as regras de integridade.
 *
 * Uso: npm run db:check
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");
const migrationsDir = join(root, "supabase", "migrations");

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create publication supabase_realtime;
`;

const BRASA = "20000000-0000-4000-8000-000000000001";
const CANTINA = "20000000-0000-4000-8000-000000000002";
const RESELLER = "10000000-0000-4000-8000-000000000001";

const users = {
  gestorBrasa: "a0000000-0000-4000-8000-000000000001",
  garcomBrasa: "a0000000-0000-4000-8000-000000000002",
  cozinhaBrasa: "a0000000-0000-4000-8000-000000000003",
  gestorCantina: "a0000000-0000-4000-8000-000000000004",
  revenda: "a0000000-0000-4000-8000-000000000005",
} as const;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

const db = new PGlite();

async function asUser(userId: string | null, fn: () => Promise<void>) {
  if (userId) {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  } else {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  }
  try {
    await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function count(sql: string, params: unknown[] = []) {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params);
  return res.rows[0].n;
}

async function fails(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main() {
  await db.exec(SUPABASE_SHIM);

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    console.log(`migration aplicada: ${file}`);
  }
  await db.exec(readFileSync(join(root, "supabase", "seed.sql"), "utf8"));
  console.log("seed aplicado\n");

  // Seed -------------------------------------------------------------------
  check("2 restaurantes", (await count("select 1 from restaurants")) === 2);
  check("8 mesas por restaurante", (await count("select 1 from tables group by restaurant_id having count(*) = 8")) === 2);
  check("20 itens no Brasa Bistrô", (await count("select 1 from menu_items where restaurant_id = $1", [BRASA])) === 20);
  check("kitchen_settings criado pelo trigger", (await count("select 1 from kitchen_settings where mode = 'balanced'")) === 2);
  check("QR tokens únicos e aleatórios", (await count("select distinct qr_token from tables where length(qr_token) = 32")) === 16);
  check("Ponto da carne com 3 opções em cada grupo",
    (await count(`select 1 from modifier_groups g join modifiers m on m.group_id = g.id
                  where g.name = 'Ponto da carne' group by g.id having count(*) = 3`)) === 3);

  // Equipe -----------------------------------------------------------------
  await db.exec(`insert into auth.users (id) values ${Object.values(users).map((u) => `('${u}')`).join(",")};`);
  await db.query(
    `insert into restaurant_members (user_id, restaurant_id, role) values
      ($1, $5, 'manager'), ($2, $5, 'waiter'), ($3, $5, 'kitchen'), ($4, $6, 'manager')`,
    [users.gestorBrasa, users.garcomBrasa, users.cozinhaBrasa, users.gestorCantina, BRASA, CANTINA],
  );
  await db.query(`insert into reseller_members (user_id, reseller_id) values ($1, $2)`, [users.revenda, RESELLER]);

  // Isolamento -------------------------------------------------------------
  await asUser(users.gestorBrasa, async () => {
    check("gestor do Brasa vê só o próprio restaurante", (await count("select 1 from restaurants")) === 1);
    check("gestor do Brasa vê só os 20 itens dele", (await count("select 1 from menu_items")) === 20);
    check("gestor do Brasa vê a marca da revenda", (await count("select 1 from resellers")) === 1);
    check("gestor do Brasa não vê mesas da Cantina",
      (await count("select 1 from tables where restaurant_id = $1", [CANTINA])) === 0);
    const err = await fails("update restaurants set status = 'inactive' where id = $1", [BRASA]);
    check("gestor não desativa o restaurante", err !== null, err ?? "");
  });

  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina vê só os 5 itens dela", (await count("select 1 from menu_items")) === 5);
    const res = await db.query("update menu_items set price_cents = 1 where restaurant_id = $1", [BRASA]);
    check("gestor da Cantina não altera itens do Brasa", res.affectedRows === 0);
    check("gestor da Cantina não vê adicionais do Brasa", (await count("select 1 from modifiers")) === 0);
  });

  await asUser(users.revenda, async () => {
    check("revendedor vê os 2 restaurantes", (await count("select 1 from restaurants")) === 2);
    const res = await db.query("update restaurants set status = 'inactive' where id = $1 returning id", [CANTINA]);
    check("revendedor desativa restaurante", res.rows.length === 1);
    await db.query("update restaurants set status = 'active' where id = $1", [CANTINA]);
  });

  await asUser(null, async () => {
    const err = await fails("select * from menu_items");
    check("cliente anônimo não lê o banco direto", err !== null, err ?? "");
  });

  // Cozinha: só "esgotado" ---------------------------------------------------
  await asUser(users.cozinhaBrasa, async () => {
    const res = await db.query("update menu_items set sold_out = true where name = 'Tiramisù' returning id");
    check("cozinha marca item como esgotado", res.rows.length === 1);
    const err = await fails("update menu_items set price_cents = 1 where name = 'Tiramisù'");
    check("cozinha não altera preço", err !== null, err ?? "");
  });

  // Comandas ---------------------------------------------------------------
  const mesa = async (label: string) =>
    (await db.query<{ id: string }>("select id from tables where restaurant_id = $1 and label = $2", [BRASA, label]))
      .rows[0].id;
  const mesa1 = await mesa("1");
  const mesa2 = await mesa("2");
  let tabId = "";

  await asUser(users.garcomBrasa, async () => {
    const res = await db.query<{ id: string }>(
      "insert into tabs (restaurant_id, table_id, pin, opened_by) values ($1, $2, '4821', $3) returning id",
      [BRASA, mesa1, users.garcomBrasa],
    );
    tabId = res.rows[0].id;
    check("garçom abre a mesa", Boolean(tabId));
    check("segunda comanda aberta na mesma mesa é recusada",
      (await fails("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '1111')", [BRASA, mesa1])) !== null);
    check("PIN repetido entre comandas abertas é recusado",
      (await fails("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '4821')", [BRASA, mesa2])) !== null);
  });

  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não abre mesa",
      (await fails("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '2222')", [BRASA, mesa2])) !== null);
  });

  // Pedido inserido pelo servidor (chave secreta).
  await db.query("insert into tab_sessions (tab_id, token_hash) values ($1, 'hash-celular-1')", [tabId]);
  const order = await db.query<{ id: string }>(
    "insert into orders (restaurant_id, tab_id, prep_minutes, total_cents) values ($1, $2, 25, 8990) returning id",
    [BRASA, tabId],
  );
  const orderId = order.rows[0].id;

  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê pedidos do Brasa", (await count("select 1 from orders")) === 0);
  });

  await asUser(users.cozinhaBrasa, async () => {
    const res = await db.query<{ started_at: string | null }>(
      "update orders set status = 'em_preparo' where id = $1 returning started_at",
      [orderId],
    );
    check("cozinha inicia o preparo e grava started_at", res.rows[0]?.started_at != null);
    check("status não pula etapas (em_preparo → entregue)",
      (await fails("update orders set status = 'entregue' where id = $1", [orderId])) !== null);
    check("equipe não altera o total do pedido",
      (await fails("update orders set total_cents = 1 where id = $1", [orderId])) !== null);
    const pinned = await db.query("update orders set pinned = true where id = $1 returning id", [orderId]);
    check("cozinha fixa pedido no topo", pinned.rows.length === 1);
  });

  await asUser(users.garcomBrasa, async () => {
    await db.query("update tabs set status = 'closed' where id = $1", [tabId]);
  });
  check("fechar a comanda apaga as sessões dos celulares",
    (await count("select 1 from tab_sessions where tab_id = $1", [tabId])) === 0);
  check("fechar a comanda grava closed_at",
    (await count("select 1 from tabs where id = $1 and closed_at is not null", [tabId])) === 1);
  check("comanda fechada não reabre",
    (await fails("update tabs set status = 'open', closed_at = null where id = $1", [tabId])) !== null);
  check("PIN volta a ficar livre depois de fechar",
    (await fails("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '4821')", [BRASA, mesa2])) === null);

  console.log(failures ? `\n${failures} verificação(ões) falharam` : "\nTudo certo.");
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
