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
    const unpaid = await fails("update tabs set status = 'closed' where id = $1", [tabId]);
    check("comanda com saldo em aberto não fecha", unpaid !== null && unpaid.includes("Faltam R$ 89,90"), unpaid ?? "");
    const paid = (await db.query<{ r: { totals: { balance_cents: number; paid_cents: number } } }>(
      "select public.register_payment($1, null, 'dinheiro', 8990) as r", [tabId])).rows[0].r;
    check("garçom registra pagamento da mesa e o saldo zera", paid.totals.paid_cents === 8990 && paid.totals.balance_cents === 0);
    await db.query("update tabs set status = 'closed' where id = $1", [tabId]);
  });
  check("fechar registra quem fechou", (await count("select 1 from tabs where id=$1 and closed_by=$2", [tabId, users.garcomBrasa])) === 1);
  check("fechar a comanda apaga as sessões dos celulares",
    (await count("select 1 from tab_sessions where tab_id = $1", [tabId])) === 0);
  check("fechar a comanda grava closed_at",
    (await count("select 1 from tabs where id = $1 and closed_at is not null", [tabId])) === 1);
  check("comanda fechada não reabre",
    (await fails("update tabs set status = 'open', closed_at = null where id = $1", [tabId])) !== null);
  check("PIN volta a ficar livre depois de fechar",
    (await fails("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '4821')", [BRASA, mesa2])) === null);

  // Server RPC security, pricing, limits and atomicity.
  const qr = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa2])).rows[0].qr_token;
  const pinRpc = (pin: string, device = "device-1", hash = "session-test") => db.query<{ result: { status?: number; tab_id?: string } }>("select public.verify_table_pin('brasa-bistro',$1,$2,$3,$4) as result", [qr,pin,device,hash]);
  for (let i=1;i<=5;i++) {
    const res = await pinRpc("9999");
    check(`PIN errado ${i}: resposta correta`, res.rows[0].result.status === (i===5 ? 429 : 401));
  }
  check("PIN correto também bloqueado durante 5 minutos", (await pinRpc("4821")).rows[0].result.status === 429);
  await db.exec("update pin_attempts set locked_until=now()-interval '1 second' where device_id='device-1'");
  check("PIN libera após expirar bloqueio", Boolean((await pinRpc("4821")).rows[0].result.tab_id));
  const food = (await db.query<{id:string; price_cents:number}>("select id,price_cents from menu_items where restaurant_id=$1 and name='Caipirinha de limão'", [BRASA])).rows[0];
  const request = "b0000000-0000-4000-8000-000000000001";
  const chosen = (await db.query<{id:string;price_cents:number}>("select distinct on (g.id) m.id,m.price_cents from modifiers m join modifier_groups g on g.id=m.group_id where g.menu_item_id=$1 and g.required order by g.id,m.price_cents",[food.id])).rows;
  const lines = JSON.stringify([{item_id:food.id,quantity:2,note:"Pouco gelo",modifier_ids:chosen.map(m=>m.id),price_cents:1}]);
  const submit = (hash:string, body=lines) => db.query<{result:{id:string;total_cents:number}}>("select public.submit_table_order('brasa-bistro',$1,$2,$3,$4::jsonb) as result", [qr,hash,request,body]);
  check("pedido sem sessão é recusado", (await fails("select public.submit_table_order('brasa-bistro',$1,'invalid',$2,$3::jsonb)", [qr,request,lines])) !== null);
  const submitted = (await submit("session-test")).rows[0].result;
  check("preço vem do banco e ignora preço enviado", submitted.total_cents===(food.price_cents+chosen.reduce((sum,m)=>sum+m.price_cents,0))*2);
  check("retry usa o mesmo pedido", (await submit("session-test")).rows[0].result.id===submitted.id);
  check("snapshot preserva nome e observação", (await count("select 1 from order_items where order_id=$1 and name_snapshot='Caipirinha de limão' and note='Pouco gelo'", [submitted.id]))===1);
  await db.query("update menu_items set sold_out=true where id=$1",[food.id]);
  check("esgotado é recusado na transação", (await fails("select public.submit_table_order('brasa-bistro',$1,'session-test','b0000000-0000-4000-8000-000000000002',$2::jsonb)",[qr,lines]))!==null);
  await asUser(null,async()=>check("anon não pode executar RPC de PIN",(await fails("select public.verify_table_pin('brasa-bistro',$1,'4821','x','y')",[qr]))!==null));
  await asUser(users.garcomBrasa,async()=>check("garçom não inicia preparo",(await fails("update orders set status='em_preparo' where id=$1",[submitted.id]))!==null));
  await db.query("update tabs set status='closed' where table_id=$1 and status='open'",[mesa2]);
  check("fechamento impede replay de pedido", (await fails("select public.submit_table_order('brasa-bistro',$1,'session-test',$2,$3::jsonb)",[qr,request,lines]))!==null);
  await asUser(users.garcomBrasa,async()=> {
    const opened = await db.query<{id:string}>("select id from public.open_table($1)",[mesa1]);
    check("RPC de abertura funciona com RLS do garçom",Boolean(opened.rows[0]?.id));
    check("RPC não abre duas comandas na mesma mesa",(await fails("select public.open_table($1)",[mesa1]))!==null);
  });
  const newRestaurant="c0000000-0000-4000-8000-000000000001";
  await asUser(users.revenda,async()=>{
    const result=await db.query<{id:string}>("insert into restaurants(id,reseller_id,name,slug) values($1,$2,'Restaurante novo','restaurante-novo') returning id",[newRestaurant,RESELLER]);
    check("revenda cria restaurante com INSERT RETURNING",result.rows[0]?.id===newRestaurant);
  });
  const category=(await db.query<{id:string}>("select id from categories where restaurant_id=$1 limit 1",[BRASA])).rows[0].id;
  const itemInput={category_id:category,name:"Teste RPC",description:"Teste",price_cents:4290,photo_url:null,prep_minutes:12,active:true,featured:false,position:99,groups:[{name:"Ponto",required:true,min_select:1,max_select:1,position:0,modifiers:[{name:"Ao ponto",price_cents:100,position:0}]}]};
  let createdItem="";
  await asUser(users.gestorBrasa,async()=>{
    const result=await db.query<{id:string}>("select public.save_menu_item($1,null,$2::jsonb) as id",[BRASA,JSON.stringify(itemInput)]);createdItem=result.rows[0].id;
    check("gestor cria item com adicionais atomically",Boolean(createdItem)&&(await count("select 1 from modifier_groups where menu_item_id=$1",[createdItem]))===1);
    check("gestor não salva item de outro restaurante",(await fails("select public.save_menu_item($1,null,$2::jsonb)",[CANTINA,JSON.stringify(itemInput)]))!==null);
    const ids=(await db.query<{id:string}>("select id from categories where restaurant_id=$1 order by position",[BRASA])).rows.map(c=>c.id).reverse();
    await db.query("select public.reorder_menu($1,'categories',$2::uuid[])",[BRASA,ids]);
    check("gestor reordena categorias",(await db.query<{id:string}>("select id from categories where restaurant_id=$1 order by position limit 1",[BRASA])).rows[0].id===ids[0]);
  });
  await asUser(users.garcomBrasa,async()=>check("garçom não executa gestão do cardápio",(await fails("select public.save_menu_item($1,null,$2::jsonb)",[BRASA,JSON.stringify(itemInput)]))!==null));

  // Divisão da conta por pessoa ----------------------------------------------
  const mesa3 = await mesa("3");
  const qr3 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa3])).rows[0].qr_token;
  const tab3 = (await db.query<{ id: string }>("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '7310') returning id", [BRASA, mesa3])).rows[0].id;
  await db.query("update menu_items set sold_out=false where id=$1", [food.id]);
  const enter = (name: string | null, hash: string) =>
    db.query<{ result: { tab_id?: string; guest_id?: string | null } }>(
      "select public.verify_table_pin('brasa-bistro',$1,'7310',$2,$3,$4) as result", [qr3, `device-${hash}`, hash, name]);
  const ana = (await enter("  Ana   Paula ", "ana-1")).rows[0].result.guest_id;
  const bia = (await enter("Bia", "bia-1")).rows[0].result.guest_id;
  const anaAgain = (await enter("ana paula", "ana-2")).rows[0].result.guest_id;
  check("PIN com nome cria a pessoa na comanda", Boolean(ana) && Boolean(bia) && ana !== bia);
  check("mesmo nome em outro celular é a mesma pessoa", anaAgain === ana);
  check("nome é gravado sem espaços extras", (await count("select 1 from tab_guests where id=$1 and name='Ana Paula'", [ana])) === 1);
  check("PIN sem nome continua aceito (versão anterior do app)", (await enter(null, "old-1")).rows[0].result.guest_id === null);
  const sharedLines = JSON.stringify([{ item_id: food.id, quantity: 1, note: "", modifier_ids: chosen.map((m) => m.id), shared: true }]);
  const anaOrder = (await db.query<{ result: { id: string } }>(
    "select public.submit_table_order('brasa-bistro',$1,'ana-1','b0000000-0000-4000-8000-000000000010',$2::jsonb) as result", [qr3, sharedLines])).rows[0].result.id;
  check("pedido fica no nome de quem pediu", (await count("select 1 from orders where id=$1 and guest_id=$2", [anaOrder, ana])) === 1);
  check("item dividido com a mesa é gravado", (await count("select 1 from order_items where order_id=$1 and shared", [anaOrder])) === 1);
  check("pedido com 'shared' inválido é recusado", (await fails(
    "select public.submit_table_order('brasa-bistro',$1,'ana-1','b0000000-0000-4000-8000-000000000011',$2::jsonb)",
    [qr3, JSON.stringify([{ item_id: food.id, quantity: 1, note: "", modifier_ids: chosen.map((m) => m.id), shared: "sim" }])])) !== null);
  const cancel = (hash: string) =>
    db.query<{ ok: boolean }>("select public.cancel_table_order('brasa-bistro',$1,$2,$3) as ok", [qr3, hash, anaOrder]);
  check("outra pessoa não cancela o pedido da Ana", (await cancel("bia-1")).rows[0].ok === false);
  check("Ana cancela o próprio pedido de outro celular", (await cancel("ana-2")).rows[0].ok === true);
  let biaPayment = "";
  await asUser(users.garcomBrasa, async () => {
    check("garçom não marca pago direto, sem forma e valor", (await fails("update tab_guests set paid_cents=1500 where id=$1", [bia])) !== null);
    biaPayment = (await db.query<{ r: { id: string } }>("select public.register_payment($1, $2, 'pix', 1500) as r", [tab3, bia])).rows[0].r.id;
    check("pagamento da pessoa atualiza paid_cents e paid_at",
      (await count("select 1 from tab_guests where id=$1 and paid_cents=1500 and paid_at is not null", [bia])) === 1);
    check("garçom não muda o nome da pessoa", (await fails("update tab_guests set name='Outra' where id=$1", [bia])) !== null);
  });
  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não registra pagamento", (await fails("select public.register_payment($1, $2, 'pix', 100)", [tab3, bia])) !== null);
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê pessoas das comandas do Brasa", (await count("select 1 from tab_guests")) === 0);
  });
  await asUser(null, async () => {
    check("cliente anônimo não lê as pessoas da comanda", (await fails("select * from tab_guests")) !== null);
  });
  await db.query("update tabs set status='closed' where id=$1", [tab3]);
  await asUser(users.garcomBrasa, async () => {
    check("garçom não estorna depois de fechar a comanda", (await fails("select public.void_payment($1, 'erro')", [biaPayment])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    check("gestor estorna pagamento de comanda fechada", (await db.query<{ ok: boolean }>("select public.void_payment($1, 'erro de digitação') as ok", [biaPayment])).rows[0].ok === true
      && (await count("select 1 from tab_guests where id=$1 and paid_cents is null", [bia])) === 1
      && (await count("select 1 from audit_log where action='pagamento_estornado' and entity_id=$1", [biaPayment])) === 1);
  });

  // Fase 2, etapa 1: papéis múltiplos, permissões e registro de operações -----
  check("papel 'bar' existe", (await count("select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='member_role' and e.enumlabel='bar'")) === 1);
  check("roles preenchido a partir de role nos vínculos antigos",
    (await count("select 1 from restaurant_members where roles = array[role]")) === 4);
  const barBrasa = "a0000000-0000-4000-8000-000000000006";
  const garcomSemFechar = "a0000000-0000-4000-8000-000000000007";
  await db.query("insert into auth.users (id) values ($1), ($2)", [barBrasa, garcomSemFechar]);
  await db.query("insert into restaurant_members (user_id, restaurant_id, roles) values ($1, $2, array['bar','kitchen']::member_role[])", [barBrasa, BRASA]);
  check("inserir só roles preenche role com o primeiro papel",
    (await count("select 1 from restaurant_members where user_id=$1 and role='kitchen' and roles=array['kitchen','bar']::member_role[]", [barBrasa])) === 1);
  await db.query("insert into restaurant_members (user_id, restaurant_id, role, permissions) values ($1, $2, 'waiter', '{\"close_tab\": false}')", [garcomSemFechar, BRASA]);
  await db.query("update restaurant_members set role='bar' where user_id=$1", [barBrasa]);
  check("app antigo muda só role e roles acompanha",
    (await count("select 1 from restaurant_members where user_id=$1 and roles=array['bar']::member_role[]", [barBrasa])) === 1);
  check("registro de operações grava quem adicionou e alterou membros",
    (await count("select 1 from audit_log where restaurant_id=$1 and action in ('membro_adicionado','membro_alterado') and entity_id=$2", [BRASA, barBrasa])) >= 2);
  const mesa4 = await mesa("4");
  const mesa5 = await mesa("5");
  let tab4 = "";
  await asUser(users.garcomBrasa, async () => {
    tab4 = (await db.query<{ id: string }>("select id from public.open_table($1)", [mesa4])).rows[0].id;
  });
  const order4 = (await db.query<{ id: string }>("insert into orders (restaurant_id, tab_id, prep_minutes, total_cents) values ($1, $2, 10, 1000) returning id", [BRASA, tab4])).rows[0].id;
  await asUser(barBrasa, async () => {
    const res = await db.query("update orders set status='em_preparo' where id=$1 returning id", [order4]);
    check("bar inicia o preparo", res.rows.length === 1);
    const sold = await db.query("update menu_items set sold_out=true where name='Chope artesanal' returning id");
    check("bar marca item como esgotado", sold.rows.length === 1);
    check("bar não abre mesa", (await fails("select public.open_table($1)", [mesa5])) !== null);
    const closedByBar = await db.query("update tabs set status='closed' where id=$1 returning id", [tab4]);
    check("bar não fecha comanda", closedByBar.rows.length === 0);
  });
  await asUser(garcomSemFechar, async () => {
    check("garçom sem permissão de fechar é barrado", (await fails("update tabs set status='closed' where id=$1", [tab4])) !== null);
    const cancelled = await db.query("update orders set status='cancelado' where id=$1 returning id", [order4]);
    check("garçom cancela pedido com a permissão padrão", cancelled.rows.length === 1);
    const selfEdit = await db.query("update restaurant_members set permissions='{\"close_tab\": true}' where user_id=$1 and restaurant_id=$2 returning user_id", [garcomSemFechar, BRASA]);
    check("membro não altera o próprio vínculo", selfEdit.rows.length === 0);
  });
  await asUser(users.gestorBrasa, async () => {
    check("gestor não altera o próprio vínculo", (await fails("delete from restaurant_members where user_id=$1 and restaurant_id=$2", [users.gestorBrasa, BRASA])) !== null);
    check("gestor não promove alguém a gestor", (await fails("update restaurant_members set roles=array['manager']::member_role[] where user_id=$1 and restaurant_id=$2", [garcomSemFechar, BRASA])) !== null);
    const updated = await db.query("update restaurant_members set permissions='{\"close_tab\": true, \"edit_menu\": true}' where user_id=$1 and restaurant_id=$2 returning user_id", [garcomSemFechar, BRASA]);
    check("gestor ajusta permissões de um garçom", updated.rows.length === 1);
    check("gestor lê o registro de operações do restaurante", (await count("select 1 from audit_log where action='mesa_aberta' and entity_id=$1", [tab4])) === 1);
    check("gestor não apaga o registro de operações", (await fails("delete from audit_log where restaurant_id=$1", [BRASA])) !== null);
    check("gestor não insere no registro de operações", (await fails("insert into audit_log (restaurant_id, actor_role, action) values ($1, 'manager', 'teste')", [BRASA])) !== null);
  });
  await asUser(garcomSemFechar, async () => {
    const edited = await db.query("update menu_items set price_cents=price_cents where name='Tiramisù' returning id");
    check("garçom com edit_menu edita o cardápio", edited.rows.length === 1);
    const closed = await db.query("update tabs set status='closed' where id=$1 returning id", [tab4]);
    check("garçom liberado fecha a comanda", closed.rows.length === 1);
  });
  await asUser(users.gestorBrasa, async () => {
    await db.query("update restaurant_members set active=false where user_id=$1 and restaurant_id=$2", [garcomSemFechar, BRASA]);
  });
  await asUser(garcomSemFechar, async () => {
    check("membro desligado não vê mais o restaurante", (await count("select 1 from restaurants")) === 0);
  });
  check("fechar comanda e cancelar pedido ficam registrados com quem fez",
    (await count("select 1 from audit_log where actor_id=$1 and action in ('comanda_fechada','pedido_cancelado')", [garcomSemFechar])) === 2);
  check("pedido do cliente fica registrado como customer",
    (await count("select 1 from audit_log where actor_role='customer' and action='pedido_enviado' and entity_id=$1", [anaOrder])) === 1);
  check("esgotado pelo bar fica registrado", (await count("select 1 from audit_log where action='item_esgotado' and actor_id=$1 and actor_role='bar'", [barBrasa])) === 1);
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não lê o registro do Brasa", (await count("select 1 from audit_log where restaurant_id=$1", [BRASA])) === 0);
  });
  await asUser(null, async () => {
    check("cliente anônimo não lê o registro de operações", (await fails("select * from audit_log")) !== null);
  });

  // Fase 2, etapa 2: cancelamento por item e estoque ---------------------------
  const suco = (await db.query<{ id: string; price_cents: number; category_id: string }>("select id,price_cents,category_id from menu_items where restaurant_id=$1 and name='Suco de laranja'", [BRASA])).rows[0];
  const stockInput = { category_id: suco.category_id, name: "Suco de laranja", description: "Natural, 400 ml.", price_cents: suco.price_cents, photo_url: null, prep_minutes: 4, active: true, featured: false, position: 3, groups: [], stock_enabled: true, stock_quantity: 2, low_stock_threshold: 1 };
  await asUser(users.gestorBrasa, async () => {
    await db.query("select public.save_menu_item($1,$2,$3::jsonb)", [BRASA, suco.id, JSON.stringify(stockInput)]);
  });
  check("editor liga o estoque com saldo inicial e registra o movimento",
    (await count("select 1 from menu_items where id=$1 and stock_enabled and stock_quantity=2 and not sold_out", [suco.id])) === 1
    && (await count("select 1 from stock_movements where menu_item_id=$1 and kind='ajuste' and balance_after=2", [suco.id])) === 1);
  const mesa6 = await mesa("6");
  const qr6 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa6])).rows[0].qr_token;
  await db.query("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '5151')", [BRASA, mesa6]);
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'5151','device-caio','caio-1','Caio')", [qr6]);
  const orderStock = (hash: string, request: string, lines: unknown) =>
    db.query<{ result: { id: string; total_cents: number } }>("select public.submit_table_order('brasa-bistro',$1,$2,$3,$4::jsonb) as result", [qr6, hash, request, JSON.stringify(lines)]);
  const tooMany = await fails("select public.submit_table_order('brasa-bistro',$1,'caio-1','b0000000-0000-4000-8000-000000000020',$2::jsonb)", [qr6, JSON.stringify([{ item_id: suco.id, quantity: 3, note: "", modifier_ids: [] }])]);
  check("pedido acima do saldo é recusado com a quantidade restante", tooMany !== null && tooMany.includes("Restam 2 unidades"), tooMany ?? "");
  const twoLines = (await orderStock("caio-1", "b0000000-0000-4000-8000-000000000021", [
    { item_id: suco.id, quantity: 1, note: "sem gelo", modifier_ids: [] },
    { item_id: suco.id, quantity: 1, note: "com gelo", modifier_ids: [] },
  ])).rows[0].result;
  check("venda baixa o estoque na transação do pedido",
    (await count("select 1 from menu_items where id=$1 and stock_quantity=0 and sold_out and sold_out_auto", [suco.id])) === 1
    && (await count("select 1 from stock_movements where menu_item_id=$1 and kind='venda' and quantity=-1", [suco.id])) === 2);
  check("item esgotado pelo estoque fica registrado como cliente",
    (await count("select 1 from audit_log where action='item_esgotado' and entity_id=$1 and actor_role='customer'", [suco.id])) === 1);
  const lineA = (await db.query<{ id: string }>("select id from order_items where order_id=$1 and note='sem gelo'", [twoLines.id])).rows[0].id;
  const lineB = (await db.query<{ id: string }>("select id from order_items where order_id=$1 and note='com gelo'", [twoLines.id])).rows[0].id;
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'5151','device-dani','dani-1','Dani')", [qr6]);
  check("outra pessoa não cancela item do pedido do Caio",
    (await db.query<{ ok: boolean }>("select public.cancel_table_order_item('brasa-bistro',$1,'dani-1',$2) as ok", [qr6, lineA])).rows[0].ok === false);
  check("cliente cancela um item do próprio pedido recebido",
    (await db.query<{ ok: boolean }>("select public.cancel_table_order_item('brasa-bistro',$1,'caio-1',$2) as ok", [qr6, lineA])).rows[0].ok === true);
  check("cancelar item recalcula o total e mantém o pedido",
    (await count("select 1 from orders where id=$1 and status='recebido' and total_cents=$2", [twoLines.id, suco.price_cents])) === 1);
  check("cancelar item devolve o estoque e tira o esgotado automático",
    (await count("select 1 from menu_items where id=$1 and stock_quantity=1 and not sold_out and not sold_out_auto", [suco.id])) === 1);
  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não cancela item", (await fails("select public.cancel_order_item($1,'erro')", [lineB])) !== null);
  });
  await asUser(users.garcomBrasa, async () => {
    const r = await db.query("select public.cancel_order_item($1,'Cliente desistiu')", [lineB]);
    check("garçom cancela item com motivo", r.rows.length === 1);
  });
  check("último item cancelado cancela o pedido com motivo e autor",
    (await count("select 1 from orders where id=$1 and status='cancelado' and total_cents=0 and cancel_reason='Cliente desistiu' and cancelled_by=$2", [twoLines.id, users.garcomBrasa])) === 1);
  check("estoque volta ao saldo original depois dos dois cancelamentos",
    (await count("select 1 from menu_items where id=$1 and stock_quantity=2", [suco.id])) === 1);
  check("cancelamentos de item ficam no registro com quem fez",
    (await count("select 1 from audit_log where action='item_cancelado' and entity='order_item' and tab_id=(select tab_id from orders where id=$1)", [twoLines.id])) === 2);
  const whole = (await orderStock("caio-1", "b0000000-0000-4000-8000-000000000022", [{ item_id: suco.id, quantity: 2, note: "", modifier_ids: [] }])).rows[0].result;
  await asUser(users.garcomBrasa, async () => {
    await db.query("update orders set status='cancelado', cancel_reason='Saiu errado' where id=$1", [whole.id]);
  });
  check("cancelar o pedido inteiro cancela os itens e devolve o estoque",
    (await count("select 1 from order_items where order_id=$1 and cancelled_at is not null and cancel_reason='Saiu errado'", [whole.id])) === 1
    && (await count("select 1 from menu_items where id=$1 and stock_quantity=2 and not sold_out", [suco.id])) === 1
    && (await count("select 1 from orders where id=$1 and total_cents=0 and cancelled_by=$2", [whole.id, users.garcomBrasa])) === 1);
  await asUser(users.garcomBrasa, async () => {
    check("garçom sem manage_stock não ajusta estoque", (await fails("select public.adjust_stock($1,'entrada',5)", [suco.id])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    const entrada = (await db.query<{ balance: number }>("select public.adjust_stock($1,'entrada',5,'Reposição') as balance", [suco.id])).rows[0].balance;
    check("gestor repõe o estoque", entrada === 7);
    const ajuste = (await db.query<{ balance: number }>("select public.adjust_stock($1,'ajuste',0,'Contagem') as balance", [suco.id])).rows[0].balance;
    check("ajuste para zero marca esgotado automático", ajuste === 0 && (await count("select 1 from menu_items where id=$1 and sold_out and sold_out_auto", [suco.id])) === 1);
    check("entrada e ajuste ficam no registro de operações",
      (await count("select 1 from audit_log where action in ('estoque_reposto','estoque_ajustado') and entity_id=$1 and actor_id=$2", [suco.id, users.gestorBrasa])) === 2);
  });
  await asUser(users.cozinhaBrasa, async () => {
    await db.query("update menu_items set sold_out=false where id=$1", [suco.id]);
    check("cozinha desmarcando à mão desliga o esgotado automático",
      (await count("select 1 from menu_items where id=$1 and not sold_out and not sold_out_auto", [suco.id])) === 1);
  });
  check("equipe não altera o total do pedido para um valor arbitrário",
    (await fails("update orders set total_cents=1 where id=$1", [twoLines.id])) !== null);
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê movimentos de estoque do Brasa", (await count("select 1 from stock_movements")) === 0);
  });
  await db.query("insert into restaurant_members (user_id, restaurant_id, roles) values ($1, $2, array['waiter']::member_role[])", [users.garcomBrasa, newRestaurant]);
  check("apagar um restaurante com equipe não quebra o registro de operações",
    (await fails("delete from restaurants where id=$1", [newRestaurant])) === null);

  // Fase 2, etapa 3: chamadas do cliente -----------------------------------------
  const mesa7 = await mesa("7");
  const qr7 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa7])).rows[0].qr_token;
  const call = (hash: string | null, device: string, kind: string, note: string | null = null) =>
    db.query<{ r: { id?: string; already?: boolean; error?: string; status?: number } }>(
      "select public.create_service_call('brasa-bistro',$1,$2,$3,$4,$5) as r", [qr7, hash, device, kind, note]);
  const free = (await call(null, "dev-livre", "garcom")).rows[0].r;
  check("mesa livre chama o garçom sem PIN", !!free.id && free.already === false);
  check("mesa livre não pede a conta sem PIN", (await call(null, "dev-livre", "conta")).rows[0].r.status === 401);
  check("mesmo aparelho é limitado a uma chamada a cada 2 minutos", (await call(null, "dev-livre", "garcom")).rows[0].r.status === 429
    || (await call(null, "dev-livre", "garcom")).rows[0].r.already === true);
  check("só uma chamada aberta por mesa e tipo", (await call(null, "dev-outro", "garcom")).rows[0].r.already === true);
  check("chamada criada fica no registro como cliente",
    (await count("select 1 from audit_log where action='chamada_criada' and entity_id=$1 and actor_role='customer'", [free.id])) === 1);
  check("cliente cancela a própria chamada pelo aparelho",
    (await db.query<{ ok: boolean }>("select public.cancel_service_call('brasa-bistro',$1,null,'dev-livre',$2) as ok", [qr7, free.id])).rows[0].ok === true);
  check("outro aparelho não cancela a chamada", (await db.query<{ ok: boolean }>("select public.cancel_service_call('brasa-bistro',$1,null,'dev-x',$2) as ok", [qr7, free.id])).rows[0].ok === false);
  const tab7 = (await db.query<{ id: string }>("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '6262') returning id", [BRASA, mesa7])).rows[0].id;
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'6262','device-edu','edu-1','Edu')", [qr7]);
  const bill = (await call("edu-1", "device-edu", "conta")).rows[0].r;
  check("com PIN o cliente pede a conta e a chamada liga à comanda", !!bill.id
    && (await count("select 1 from service_calls where id=$1 and tab_id=$2 and guest_id is not null", [bill.id, tab7])) === 1);
  const help = (await call("edu-1", "device-edu", "ajuda", "  mais   guardanapos  ")).rows[0].r;
  check("observação é normalizada", (await count("select 1 from service_calls where id=$1 and note='mais guardanapos'", [help.id])) === 1);
  await asUser(users.cozinhaBrasa, async () => {
    const r = await db.query("update service_calls set status='atendida' where id=$1 returning id", [bill.id]);
    check("cozinha não atende chamadas", r.rows.length === 0);
  });
  await asUser(users.garcomBrasa, async () => {
    check("garçom não altera o tipo da chamada", (await fails("update service_calls set kind='garcom' where id=$1", [bill.id])) !== null);
    const r = await db.query<{ attended_by: string }>("update service_calls set status='atendida' where id=$1 returning attended_by", [bill.id]);
    check("garçom atende e fica registrado como quem atendeu", r.rows[0]?.attended_by === users.garcomBrasa);
    check("chamada atendida não reabre", (await fails("update service_calls set status='aberta' where id=$1", [bill.id])) !== null);
  });
  check("atendimento fica no registro com o tempo", (await count("select 1 from audit_log where action='chamada_atendida' and entity_id=$1 and actor_id=$2 and (data->>'seconds') is not null", [bill.id, users.garcomBrasa])) === 1);
  await db.query("update service_calls set created_at = now() - interval '31 minutes' where id=$1", [help.id]);
  await asUser(users.garcomBrasa, async () => {
    const expired = (await db.query<{ n: number }>("select public.expire_service_calls($1) as n", [BRASA])).rows[0].n;
    check("chamada sem atendimento em 30 minutos expira", expired === 1 && (await count("select 1 from service_calls where id=$1 and status='expirada'", [help.id])) === 1);
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê chamadas do Brasa", (await count("select 1 from service_calls")) === 0);
    check("gestor da Cantina não expira chamadas do Brasa", (await fails("select public.expire_service_calls($1)", [BRASA])) !== null);
  });
  const open7 = (await call("edu-1", "device-edu", "garcom")).rows[0].r;
  await db.query("update tabs set status='closed' where id=$1", [tab7]);
  check("fechar a comanda encerra as chamadas abertas da mesa",
    (await count("select 1 from service_calls where id=$1 and status='atendida'", [open7.id])) === 1);
  await asUser(null, async () => {
    check("cliente anônimo não lê chamadas direto", (await fails("select * from service_calls")) !== null);
  });

  // Fase 2, etapa 4: bar ---------------------------------------------------------
  await asUser(users.gestorBrasa, async () => {
    const r = await db.query("update categories set station='bar' where restaurant_id=$1 and name='Bebidas' returning id", [BRASA]);
    check("gestor marca a categoria Bebidas como bar", r.rows.length === 1);
  });
  const drinque = (await db.query<{ id: string }>("select id from menu_items where restaurant_id=$1 and name='Drinque da casa'", [BRASA])).rows[0].id;
  const picanha = (await db.query<{ id: string }>("select id from menu_items where restaurant_id=$1 and name='Picanha na brasa'", [BRASA])).rows[0].id;
  const ponto = (await db.query<{ id: string }>("select m.id from modifiers m join modifier_groups g on g.id=m.group_id where g.menu_item_id=$1 and g.required limit 1", [picanha])).rows[0].id;
  check("setor efetivo do item vem da categoria", (await db.query<{ s: string }>("select private.item_station($1) as s", [drinque])).rows[0].s === "bar"
    && (await db.query<{ s: string }>("select private.item_station($1) as s", [picanha])).rows[0].s === "cozinha");
  const mesa8 = await mesa("8");
  const qr8 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa8])).rows[0].qr_token;
  const tab8 = (await db.query<{ id: string }>("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '7373') returning id", [BRASA, mesa8])).rows[0].id;
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'7373','device-fe','fe-1','Fê')", [qr8]);
  const mixed = JSON.stringify([
    { item_id: picanha, quantity: 1, note: "", modifier_ids: [ponto] },
    { item_id: drinque, quantity: 2, note: "sem açúcar", modifier_ids: [] },
  ]);
  const sent = (await db.query<{ r: { id: string; batch_id: string; prep_minutes: number; total_cents: number; orders: { station: string }[] } }>(
    "select public.submit_table_order('brasa-bistro',$1,'fe-1','b0000000-0000-4000-8000-000000000030',$2::jsonb) as r", [qr8, mixed])).rows[0].r;
  check("envio com prato e bebida vira um pedido por setor no mesmo envio",
    sent.orders.length === 2 && sent.orders.map((o) => o.station).toSorted().join(",") === "bar,cozinha"
    && (await count("select 1 from orders where batch_id=$1 and tab_id=$2", [sent.batch_id, tab8])) === 2);
  check("total e previsão do envio somam os dois setores",
    sent.total_cents === (await db.query<{ t: number }>("select sum(total_cents)::int as t from orders where batch_id=$1", [sent.batch_id])).rows[0].t
    && sent.prep_minutes === 25);
  check("itens guardam o setor", (await count("select 1 from order_items oi join orders o on o.id=oi.order_id where o.batch_id=$1 and oi.station=o.station", [sent.batch_id])) === 2);
  const retry = (await db.query<{ r: { batch_id: string; orders: unknown[] } }>(
    "select public.submit_table_order('brasa-bistro',$1,'fe-1','b0000000-0000-4000-8000-000000000030',$2::jsonb) as r", [qr8, mixed])).rows[0].r;
  check("retry devolve o mesmo envio sem duplicar", retry.batch_id === sent.batch_id && retry.orders.length === 2
    && (await count("select 1 from orders where request_id='b0000000-0000-4000-8000-000000000030'")) === 2);
  const only = (await db.query<{ r: { orders: { station: string }[] } }>(
    "select public.submit_table_order('brasa-bistro',$1,'fe-1','b0000000-0000-4000-8000-000000000031',$2::jsonb) as r",
    [qr8, JSON.stringify([{ item_id: drinque, quantity: 1, note: "", modifier_ids: [] }])])).rows[0].r;
  check("envio só de bebida vira um pedido do bar", only.orders.length === 1 && only.orders[0].station === "bar");
  check("registro do pedido guarda o setor", (await count("select 1 from audit_log where action='pedido_enviado' and data->>'station'='bar' and tab_id=$1", [tab8])) === 2);
  await asUser(barBrasa, async () => {
    const r = await db.query("update orders set status='em_preparo' where batch_id=$1 and station='bar' returning id", [sent.batch_id]);
    check("bar inicia o preparo do pedido do bar", r.rows.length === 1);
  });
  await asUser(users.gestorBrasa, async () => {
    await db.query("update menu_items set station='cozinha' where id=$1", [drinque]);
    check("item sobrescreve o setor da categoria", (await db.query<{ s: string }>("select private.item_station($1) as s", [drinque])).rows[0].s === "cozinha");
    await db.query("update menu_items set station=null where id=$1", [drinque]);
  });

  // Fase 2, etapa 5: unir mesas ---------------------------------------------------
  // Mesa 8 tem a comanda tab8 aberta (Fê). Mesa 5 está livre; mesa 7 fechou.
  const mesa5b = await mesa("5");
  const qr5 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa5b])).rows[0].qr_token;
  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não une mesas", (await fails("select public.merge_table($1,$2)", [tab8, mesa5b])) !== null);
  });
  await asUser(users.garcomBrasa, async () => {
    const r = (await db.query<{ r: { ok: boolean; moved_orders: number } }>("select public.merge_table($1,$2) as r", [tab8, mesa5b])).rows[0].r;
    check("garçom une uma mesa livre à comanda", r.ok && r.moved_orders === 0);
    check("mesa unida não abre comanda própria", (await fails("select public.open_table($1)", [mesa5b])) !== null);
    check("mesa unida não entra em outra comanda", (await fails("select public.merge_table($1,$2)", [tab4, mesa5b])) !== null);
  });
  check("QR da mesa unida leva à mesma comanda", (await db.query<{ t: string }>("select public.tab_for_table($1) as t", [mesa5b])).rows[0].t === tab8);
  const viaMesa5 = (await db.query<{ r: { tab_id: string; guest_id: string } }>("select public.verify_table_pin('brasa-bistro',$1,'7373','device-gui','gui-1','Gui') as r", [qr5])).rows[0].r;
  check("PIN da comanda vale no QR da mesa unida", viaMesa5.tab_id === tab8);
  const viaMesa5Order = (await db.query<{ r: { orders: unknown[] } }>(
    "select public.submit_table_order('brasa-bistro',$1,'gui-1','b0000000-0000-4000-8000-000000000040',$2::jsonb) as r",
    [qr5, JSON.stringify([{ item_id: drinque, quantity: 1, note: "", modifier_ids: [] }])])).rows[0].r;
  check("pedido pelo QR da mesa unida cai na comanda", viaMesa5Order.orders.length === 1
    && (await count("select 1 from orders where tab_id=$1 and request_id='b0000000-0000-4000-8000-000000000040'", [tab8])) === 1);
  // Mesa 4: comanda própria aberta com pedido e pessoa; une à comanda da mesa 8.
  const tab4b = (await db.query<{ id: string }>("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '8484') returning id", [BRASA, mesa4])).rows[0].id;
  const qr4 = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa4])).rows[0].qr_token;
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'8484','device-fe2','fe-2','Fê')", [qr4]);
  await db.query("select public.submit_table_order('brasa-bistro',$1,'fe-2','b0000000-0000-4000-8000-000000000041',$2::jsonb)",
    [qr4, JSON.stringify([{ item_id: drinque, quantity: 1, note: "da mesa 4", modifier_ids: [] }])]);
  await db.query("select public.create_service_call('brasa-bistro',$1,'fe-2','device-fe2','garcom')", [qr4]);
  await asUser(users.garcomBrasa, async () => {
    const r = (await db.query<{ r: { ok: boolean; moved_orders: number; moved_guests: number } }>("select public.merge_table($1,$2) as r", [tab8, mesa4])).rows[0].r;
    check("unir comanda aberta move pedidos e pessoas", r.ok && r.moved_orders === 1 && r.moved_guests === 1);
  });
  check("segunda comanda fecha como unida e perde as sessões",
    (await count("select 1 from tabs where id=$1 and status='closed' and merged_into=$2", [tab4b, tab8])) === 1
    && (await count("select 1 from tab_sessions where tab_id=$1", [tab4b])) === 0);
  check("pedido da mesa 4 agora está na comanda da mesa 8",
    (await count("select 1 from orders o join order_items i on i.order_id=o.id where o.tab_id=$1 and i.note='da mesa 4'", [tab8])) === 1);
  check("pessoa com nome repetido ganha o nome da mesa",
    (await count("select 1 from tab_guests where tab_id=$1 and name='Fê (mesa 4)'", [tab8])) === 1);
  check("chamada aberta passa para a comanda unida", (await count("select 1 from service_calls where tab_id=$1 and status='aberta' and kind='garcom'", [tab8])) === 1);
  check("mesa 4 aparece como unida à comanda", (await count("select 1 from tab_tables where tab_id=$1 and table_id=$2 and released_at is null", [tab8, mesa4])) === 1);
  check("união fica no registro", (await count("select 1 from audit_log where action in ('mesa_unida','comandas_unidas') and tab_id=$1", [tab8])) === 3);
  await asUser(users.garcomBrasa, async () => {
    check("mesa principal não pode ser separada", (await fails("select public.split_table($1,$2)", [tab8, mesa8])) !== null);
    check("garçom separa a mesa 5", (await db.query<{ ok: boolean }>("select public.split_table($1,$2) as ok", [tab8, mesa5b])).rows[0].ok === true);
  });
  check("mesa separada volta a ficar livre", (await db.query<{ t: string | null }>("select public.tab_for_table($1) as t", [mesa5b])).rows[0].t === null);
  await db.query("update tabs set status='closed' where id=$1", [tab8]);
  check("fechar a comanda libera as mesas unidas", (await count("select 1 from tab_tables where tab_id=$1 and released_at is null", [tab8])) === 0
    && (await db.query<{ t: string | null }>("select public.tab_for_table($1) as t", [mesa4])).rows[0].t === null);
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê mesas unidas do Brasa", (await count("select 1 from tab_tables")) === 0);
  });

  // Fase 2, etapa 6: financeiro ---------------------------------------------------
  await asUser(users.gestorBrasa, async () => {
    const r = await db.query("update restaurants set service_fee_percent=10, service_fee_optional=true where id=$1 returning id", [BRASA]);
    check("gestor define a taxa de serviço", r.rows.length === 1);
  });
  const mesa6b = await mesa("6");
  await db.query("update tabs set status='closed' where table_id=$1 and status='open'", [mesa6b]);
  let tab6 = "";
  await asUser(users.garcomBrasa, async () => {
    tab6 = (await db.query<{ id: string; service_fee_percent: string }>("select id, service_fee_percent from public.open_table($1)", [mesa6b])).rows[0].id;
  });
  check("abrir a mesa copia a taxa do restaurante", (await count("select 1 from tabs where id=$1 and service_fee_percent=10", [tab6])) === 1);
  const qr6b = (await db.query<{ qr_token: string }>("select qr_token from tables where id=$1", [mesa6b])).rows[0].qr_token;
  const pin6 = (await db.query<{ pin: string }>("select pin from tabs where id=$1", [tab6])).rows[0].pin;
  const hugo = (await db.query<{ r: { guest_id: string } }>("select public.verify_table_pin('brasa-bistro',$1,$2,'device-hugo','hugo-1','Hugo') as r", [qr6b, pin6])).rows[0].r.guest_id;
  await db.query("update menu_items set stock_enabled=false, stock_quantity=null where id=$1", [suco.id]);
  await db.query("select public.submit_table_order('brasa-bistro',$1,'hugo-1','b0000000-0000-4000-8000-000000000050',$2::jsonb)",
    [qr6b, JSON.stringify([{ item_id: suco.id, quantity: 10, note: "", modifier_ids: [] }])]);
  const t6 = () => db.query<{ t: Record<string, number | boolean | string | null> }>("select public.tab_totals($1) as t", [tab6]).then((r) => r.rows[0].t);
  const sucoTotal = suco.price_cents * 10;
  check("totais: itens + 10% de taxa", (await t6()).fee_cents === Math.round(sucoTotal * 0.1) && (await t6()).due_cents === sucoTotal + Math.round(sucoTotal * 0.1));
  await asUser(users.garcomBrasa, async () => {
    check("garçom não aplica desconto sem permissão", (await fails("select public.apply_discount($1, 500, 'amigo')", [tab6])) !== null);
    check("garçom não mexe na taxa direto", (await fails("update tabs set service_fee_waived=true where id=$1", [tab6])) !== null);
    const waived = (await db.query<{ t: { fee_cents: number } }>("select public.set_service_fee($1, true) as t", [tab6])).rows[0].t;
    check("garçom retira a taxa opcional", waived.fee_cents === 0);
    await db.query("select public.set_service_fee($1, false)", [tab6]);
  });
  await asUser(users.gestorBrasa, async () => {
    check("desconto exige motivo", (await fails("select public.apply_discount($1, 500, '  ')", [tab6])) !== null);
    check("desconto não passa do valor dos itens", (await fails("select public.apply_discount($1, $2, 'teste')", [tab6, sucoTotal + 1])) !== null);
    const d = (await db.query<{ t: { discount_cents: number; due_cents: number } }>("select public.apply_discount($1, 500, 'Cortesia') as t", [tab6])).rows[0].t;
    check("gestor aplica desconto com motivo", d.discount_cents === 500 && d.due_cents === sucoTotal + Math.round(sucoTotal * 0.1) - 500);
  });
  await asUser(users.garcomBrasa, async () => {
    const due = (await t6()).due_cents as number;
    const partial = (await db.query<{ r: { totals: { balance_cents: number } } }>("select public.register_payment($1, $2, 'credito', $3) as r", [tab6, hugo, due - 1000])).rows[0].r;
    check("pagamento parcial deixa saldo", partial.totals.balance_cents === 1000);
    const blocked = await fails("update tabs set status='closed' where id=$1", [tab6]);
    check("comanda não fecha faltando R$ 10,00", blocked !== null && blocked.includes("Faltam R$ 10,00"), blocked ?? "");
    await db.query("select public.register_payment($1, null, 'dinheiro', 1000)", [tab6]);
    check("pagamento da mesa completa o saldo", (await t6()).balance_cents === 0);
    const closed = await db.query("update tabs set status='closed' where id=$1 returning id", [tab6]);
    check("comanda quitada fecha", closed.rows.length === 1);
  });
  check("pagamentos ficam no registro com forma e valor",
    (await count("select 1 from audit_log where action='pagamento_registrado' and tab_id=$1 and data->>'method' in ('credito','dinheiro')", [tab6])) === 2);
  await asUser(users.garcomBrasa, async () => {
    check("garçom não fecha o dia", (await fails("select public.close_day($1, (now() at time zone 'America/Sao_Paulo')::date)", [BRASA])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    check("dia futuro não fecha", (await fails("select public.close_day($1, ((now() at time zone 'America/Sao_Paulo')::date + 1))", [BRASA])) !== null);
    const closure = (await db.query<{ r: { totals: { tabs_closed: number; payments_cents: number; by_method: Record<string, number>; discount_cents: number } } }>(
      "select public.close_day($1, (now() at time zone 'America/Sao_Paulo')::date, 'Fechamento de teste') as r", [BRASA])).rows[0].r;
    check("fechamento do dia soma pagamentos por forma e descontos",
      closure.totals.tabs_closed >= 2 && closure.totals.by_method.dinheiro === 8990 + 1000 && closure.totals.discount_cents === 500
      && closure.totals.payments_cents === (await db.query<{ s: number }>("select sum(amount_cents)::int as s from payments where restaurant_id=$1 and voided_at is null", [BRASA])).rows[0].s);
    check("dia não fecha duas vezes", (await fails("select public.close_day($1, (now() at time zone 'America/Sao_Paulo')::date)", [BRASA])) !== null);
  });
  const lastPayment = (await db.query<{ id: string }>("select id from payments where tab_id=$1 and method='dinheiro'", [tab6])).rows[0].id;
  await asUser(users.garcomBrasa, async () => {
    check("depois do dia fechado o garçom não estorna", (await fails("select public.void_payment($1, 'x')", [lastPayment])) !== null);
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê pagamentos nem fechamentos do Brasa", (await count("select 1 from payments")) === 0 && (await count("select 1 from cash_closures")) === 0);
  });

  // Fase 2, etapa 7: histórico, relatórios e satisfação -----------------------------
  // tab6 fechou com Hugo dentro: o hash hugo-1 virou convite de pesquisa por 24 h.
  check("fechar a comanda cria o convite de pesquisa e apaga a sessão",
    (await count("select 1 from survey_invites where token_hash='hugo-1' and tab_id=$1 and used_at is null", [tab6])) === 1
    && (await count("select 1 from tab_sessions where token_hash='hugo-1'")) === 0);
  check("comanda unida (segunda) não gera convite", (await count("select 1 from survey_invites where tab_id=$1", [tab4b])) === 0);
  const inviteInfo = (await db.query<{ r: { guest_name: string; answered: boolean } | null }>("select public.survey_invite('brasa-bistro',$1,'hugo-1') as r", [qr6b])).rows[0].r;
  check("convite válido devolve o nome da pessoa", inviteInfo?.guest_name === "Hugo" && inviteInfo.answered === false);
  check("hash sem convite não vale", (await db.query<{ r: unknown }>("select public.survey_invite('brasa-bistro',$1,'inexistente') as r", [qr6b])).rows[0].r === null);
  check("convite não permite pedir", (await fails("select public.submit_table_order('brasa-bistro',$1,'hugo-1','b0000000-0000-4000-8000-000000000060',$2::jsonb)", [qr6b, JSON.stringify([{ item_id: suco.id, quantity: 1, note: "", modifier_ids: [] }])])) !== null);
  await asUser(users.gestorBrasa, async () => {
    await db.query("update restaurants set google_review_url='https://g.page/r/brasa' where id=$1", [BRASA]);
  });
  check("nota fora de 1 a 5 é recusada", (await fails("select public.submit_survey('brasa-bistro',$1,'hugo-1',6,null,null,null,'{}',null)", [qr6b])) !== null);
  const surveyResult = (await db.query<{ r: { ok: boolean; google_review_url: string | null } }>(
    "select public.submit_survey('brasa-bistro',$1,'hugo-1',5,4,5,3,array['Rápido','  Comida ótima ','Rápido'],'  Tudo certo!  ') as r", [qr6b])).rows[0].r;
  check("avaliação 5 grava e devolve o link do Google", surveyResult.ok && surveyResult.google_review_url === "https://g.page/r/brasa");
  check("etiquetas normalizadas e comentário sem espaços", (await count("select 1 from surveys where tab_id=$1 and rating=5 and comment='Tudo certo!' and cardinality(tags)=2", [tab6])) === 1);
  check("cada pessoa avalia uma vez", (await fails("select public.submit_survey('brasa-bistro',$1,'hugo-1',4,null,null,null,'{}',null)", [qr6b])) !== null);
  check("avaliação fica no registro só com a nota", (await count("select 1 from audit_log where action='avaliacao_enviada' and tab_id=$1 and data->>'rating'='5' and actor_role='customer'", [tab6])) === 1);
  await asUser(users.gestorBrasa, async () => {
    const rate = (await db.query<{ r: { avg: number; responses: number } }>("select public.restaurant_rating($1) as r", [BRASA])).rows[0].r;
    check("média do restaurante nos últimos 30 dias", Number(rate.avg) === 5 && rate.responses === 1);
    const summary = (await db.query<{ r: { responses: number; avg_rating: string; distribution: Record<string, number>; tags: { tag: string; n: number }[]; comments: { guest: string; table: string }[]; guests: number } }>(
      "select public.survey_summary($1, now() - interval '1 day', now() + interval '1 day') as r", [BRASA])).rows[0].r;
    check("resumo da satisfação traz distribuição, etiquetas e comentários com nome e mesa",
      summary.responses === 1 && Number(summary.avg_rating) === 5 && summary.distribution["5"] === 1 && summary.tags.length === 2
      && summary.comments[0].guest === "Hugo" && summary.comments[0].table === "6" && summary.guests >= 1);
    const report = (await db.query<{ r: { orders: number; items_cents: number; tabs_closed: number; by_item: { name: string; quantity: number }[]; by_method: { method: string; cents: number }[]; cancellations: { reason: string }[]; by_day: unknown[]; prep_by_station: unknown[]; fee_cents: number; discount_cents: number } }>(
      "select public.report_summary($1, now() - interval '1 day', now() + interval '1 day') as r", [BRASA])).rows[0].r;
    check("relatório do período soma pedidos, itens, formas, cancelamentos e taxa",
      report.orders > 0 && report.items_cents > 0 && report.tabs_closed >= 2 && report.by_item.some((i) => i.name === "Suco de laranja")
      && report.by_method.some((m) => m.method === "dinheiro") && report.cancellations.some((c) => c.reason === "Saiu errado")
      && report.by_day.length === 1 && report.discount_cents === 500 && report.fee_cents > 0);
    check("relatório recusa mais de 12 meses", (await fails("select public.report_summary($1, now() - interval '13 months', now())", [BRASA])) !== null);
    const history = (await db.query<{ r: { id: string; table: string; tables: string[]; guests: number; totals: { due_cents: number } }[] }>(
      "select public.tab_history($1, now() - interval '1 day', now() + interval '1 day') as r", [BRASA])).rows[0].r;
    check("histórico lista as comandas fechadas com mesas unidas", history.some((t) => t.id === tab8 && t.tables.includes("4")) && history.some((t) => t.id === tab6 && t.guests === 1));
    const detail = (await db.query<{ r: { tab: { table: string; totals: { due_cents: number } }; guests: unknown[]; orders: { items: { cancelled_at: string | null }[] }[]; payments: unknown[]; log: { action: string }[]; surveys: { rating: number }[] } }>(
      "select public.tab_detail($1) as r", [tab6])).rows[0].r;
    check("detalhe da comanda traz pessoas, pedidos, pagamentos, avaliação e linha do tempo",
      detail.tab.table === "6" && detail.guests.length === 1 && detail.orders.length === 1 && detail.payments.length === 2 && detail.surveys[0].rating === 5
      && detail.log.some((l) => l.action === "comanda_fechada") && detail.log.some((l) => l.action === "pagamento_registrado"));
    const log = (await db.query<{ r: { action: string }[] }>("select public.audit_history($1, now() - interval '1 day', now() + interval '1 day', 'pagamento_registrado', null, 50) as r", [BRASA])).rows[0].r;
    check("linha do tempo filtra por tipo", log.length > 0 && log.every((l) => l.action === "pagamento_registrado"));
  });
  await asUser(users.garcomBrasa, async () => {
    const todayHistory = (await db.query<{ r: unknown[] }>("select public.tab_history($1, (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), now() + interval '1 day') as r", [BRASA])).rows[0].r;
    check("garçom vê as comandas fechadas de hoje", todayHistory.length >= 2);
    check("garçom não vê histórico de ontem", (await fails("select public.tab_history($1, now() - interval '2 days', now())", [BRASA])) !== null);
    check("garçom não vê relatórios", (await fails("select public.report_summary($1, now() - interval '1 day', now())", [BRASA])) !== null);
    check("garçom abre o detalhe de comanda fechada hoje", (await db.query<{ r: { tab: { table: string } } }>("select public.tab_detail($1) as r", [tab6])).rows[0].r.tab.table === "6");
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê histórico nem avaliações do Brasa", (await fails("select public.tab_detail($1)", [tab6])) !== null && (await count("select 1 from surveys")) === 0);
  });
  await asUser(users.revenda, async () => {
    check("revenda vê a média do restaurante", Number((await db.query<{ r: { avg: number } }>("select public.restaurant_rating($1) as r", [BRASA])).rows[0].r.avg) === 5);
  });

  // Fase 2, etapa 8: planos, assinaturas e suporte ---------------------------------
  // Aqui o seed roda depois das migrations: os restaurantes nasceram "em teste" pelo
  // trigger. Em produção a migration os deixou ativos sem vencimento; reproduzimos isso.
  check("restaurantes do seed nasceram em teste no plano padrão da revenda",
    (await count("select 1 from subscriptions s join restaurants r on r.id=s.restaurant_id where r.reseller_id=$1 and s.status='teste' and s.trial_ends_at > now()", [RESELLER])) >= 2);
  await db.query("update subscriptions set status='ativa', trial_ends_at=null, current_period_end=null where restaurant_id in (select id from restaurants where reseller_id=$1)", [RESELLER]);
  check("migração deu o plano Completo ativo aos restaurantes existentes",
    (await count("select 1 from plans where reseller_id=$1 and name='Completo' and is_default", [RESELLER])) === 1
    && (await count("select 1 from subscriptions s join restaurants r on r.id=s.restaurant_id where r.reseller_id=$1 and s.status='ativa' and s.current_period_end is null", [RESELLER])) >= 2);
  const accessOf = async (rid: string) => (await db.query<{ a: { status: string; blocked: boolean; features: Record<string, boolean>; plan: string | null } }>("select public.restaurant_access($1) as a", [rid])).rows[0].a;
  check("acesso do restaurante: ativo com todos os módulos", (await accessOf(BRASA)).status === "ativa" && (await accessOf(BRASA)).features.bar === true && (await accessOf(BRASA)).blocked === false);
  let basico = "";
  await asUser(users.revenda, async () => {
    basico = (await db.query<{ id: string }>("insert into plans (reseller_id, name, price_cents, trial_days, features) values ($1, 'Básico', 9900, 7, '{\"bar\":false,\"stock\":false,\"finance\":true,\"reports\":false,\"service_calls\":true,\"surveys\":false,\"custom_domain\":false}') returning id", [RESELLER])).rows[0].id;
    check("revenda cria plano", !!basico);
    check("revenda não cria segundo plano padrão", (await fails("insert into plans (reseller_id, name, is_default) values ($1, 'Outro', true)", [RESELLER])) !== null);
    await db.query("update resellers set support_whatsapp='5511999990000', support_email='ajuda@comanda.dev', support_hours='Seg a sex, 9h às 18h' where id=$1", [RESELLER]);
    check("whatsapp de suporte inválido é recusado", (await fails("update resellers set support_whatsapp='abc' where id=$1", [RESELLER])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    check("gestor não cria plano", (await db.query("insert into plans (reseller_id, name) values ($1, 'Hack') returning id", [RESELLER]).catch(() => ({ rows: [] }))).rows.length === 0);
    check("gestor não altera a assinatura", (await fails("select public.set_subscription($1, $2, 'ativa')", [BRASA, basico])) !== null);
    check("gestor lê o contato de suporte da revenda", (await count("select 1 from resellers where id=$1 and support_whatsapp='5511999990000'", [RESELLER])) === 1);
  });
  const completo = (await db.query<{ id: string }>("select id from plans where reseller_id=$1 and is_default", [RESELLER])).rows[0].id;
  await asUser(users.revenda, async () => {
    const a = (await db.query<{ a: { status: string; features: Record<string, boolean>; plan: string } }>("select public.set_subscription($1, $2, 'ativa') as a", [CANTINA, basico])).rows[0].a;
    check("revenda troca o plano da Cantina para Básico", a.plan === "Básico" && a.features.stock === false && a.features.finance === true);
  });
  const cantinaItem = (await db.query<{ id: string; category_id: string }>("select id, category_id from menu_items where restaurant_id=$1 limit 1", [CANTINA])).rows[0];
  await asUser(users.gestorCantina, async () => {
    check("módulo de estoque fora do plano: ajuste recusado", (await fails("select public.adjust_stock($1, 'entrada', 1)", [cantinaItem.id])) !== null);
    check("módulo do bar fora do plano: categoria não vai para o bar", (await fails("update categories set station='bar' where id=$1", [cantinaItem.category_id])) !== null);
    check("módulo de relatórios fora do plano", (await fails("select public.report_summary($1, now() - interval '1 day', now())", [CANTINA])) !== null);
    const fin = await db.query("update restaurants set service_fee_percent=5 where id=$1 returning id", [CANTINA]);
    check("módulo financeiro incluído continua funcionando", fin.rows.length === 1);
  });
  await asUser(users.revenda, async () => {
    const paid = (await db.query<{ r: { access: { status: string; period_end: string } } }>(
      "select public.register_subscription_payment($1, 9900, current_date, (current_date + 30), 'pix', 'Primeiro mês') as r", [CANTINA])).rows[0].r;
    check("pagamento registrado ativa e define o vencimento", paid.access.status === "ativa" && paid.access.period_end !== null);
    check("pagamento fica no registro", (await count("select 1 from audit_log where action='assinatura_paga' and restaurant_id=$1", [CANTINA])) === 1);
    await db.query("update subscriptions set current_period_end = now() - interval '2 days' where restaurant_id=$1", [CANTINA]);
    check("vencimento passado vira atrasada (tudo funciona)", (await accessOf(CANTINA)).status === "atrasada" && (await accessOf(CANTINA)).blocked === false);
    await db.query("update subscriptions set current_period_end = now() - interval '10 days' where restaurant_id=$1", [CANTINA]);
    check("depois da carência vira suspensa", (await accessOf(CANTINA)).status === "suspensa" && (await accessOf(CANTINA)).blocked === true);
  });
  const cantinaQr = (await db.query<{ qr_token: string }>("select qr_token from tables where restaurant_id=$1 limit 1", [CANTINA])).rows[0].qr_token;
  const cantinaTable = (await db.query<{ id: string }>("select id from tables where qr_token=$1", [cantinaQr])).rows[0].id;
  await db.query("insert into tabs (restaurant_id, table_id, pin) values ($1, $2, '9090')", [CANTINA, cantinaTable]);
  check("restaurante suspenso recusa o PIN", (await db.query<{ r: { status: number } }>("select public.verify_table_pin('cantina-da-nonna',$1,'9090','dev-c','c-1','Zé') as r", [cantinaQr])).rows[0].r.status === 403);
  check("restaurante suspenso recusa chamada", (await db.query<{ r: { status: number } }>("select public.create_service_call('cantina-da-nonna',$1,null,'dev-c','garcom') as r", [cantinaQr])).rows[0].r.status === 403);
  await asUser(users.revenda, async () => {
    const back = (await db.query<{ a: { status: string } }>("select public.set_subscription($1, $2, 'ativa') as a", [CANTINA, completo])).rows[0].a;
    check("revenda reativa no plano Completo", back.status === "ativa");
    await db.query("update subscriptions set current_period_end = null where restaurant_id=$1", [CANTINA]);
  });
  check("reativado volta a aceitar o PIN", !!(await db.query<{ r: { tab_id?: string } }>("select public.verify_table_pin('cantina-da-nonna',$1,'9090','dev-c','c-1','Zé') as r", [cantinaQr])).rows[0].r.tab_id);
  await asUser(users.revenda, async () => {
    await db.query("update plans set max_tables=8 where id=$1", [completo]);
  });
  check("limite de mesas do plano", (await fails("insert into tables (restaurant_id, label) values ($1, 'Extra')", [CANTINA])) !== null);
  await asUser(users.revenda, async () => { await db.query("update plans set max_tables=null where id=$1", [completo]); });
  const newRestaurant2 = "c0000000-0000-4000-8000-000000000002";
  await asUser(users.revenda, async () => {
    await db.query("insert into restaurants(id,reseller_id,name,slug) values($1,$2,'Novo em teste','novo-em-teste')", [newRestaurant2, RESELLER]);
    check("restaurante novo nasce em teste no plano padrão", (await accessOf(newRestaurant2)).status === "teste" && (await accessOf(newRestaurant2)).plan === "Completo");
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê a assinatura do Brasa", (await count("select 1 from subscriptions where restaurant_id=$1", [BRASA])) === 0);
  });

  // Fase 2, etapa 9: domínio próprio ----------------------------------------------
  await asUser(users.revenda, async () => {
    await db.query("update resellers set domain='cardapio.revenda-demo.com.br' where id=$1", [RESELLER]);
    check("domínio novo da revenda nasce pendente", (await count("select 1 from resellers where id=$1 and domain_status='pending'", [RESELLER])) === 1);
  });
  check("host pendente não resolve", (await db.query<{ r: unknown }>("select public.resolve_host('cardapio.revenda-demo.com.br') as r")).rows[0].r === null);
  await db.query("update resellers set domain_status='active' where id=$1", [RESELLER]);
  check("host ativo da revenda resolve para a revenda",
    (await db.query<{ r: { kind: string; reseller_id: string } }>("select public.resolve_host('CARDAPIO.revenda-demo.com.br') as r")).rows[0].r?.kind === "reseller");
  await asUser(users.revenda, async () => { await db.query("select public.set_subscription($1, $2, 'ativa')", [CANTINA, basico]); });
  await asUser(users.gestorCantina, async () => {
    check("domínio do restaurante fora do plano é recusado", (await fails("update restaurants set custom_domain='cardapio.nonna.com.br' where id=$1", [CANTINA])) !== null);
  });
  await asUser(users.revenda, async () => {
    await db.query("select public.set_subscription($1, $2, 'ativa')", [CANTINA, completo]);
    await db.query("update subscriptions set current_period_end=null where restaurant_id=$1", [CANTINA]);
  });
  await asUser(users.gestorCantina, async () => {
    const r = await db.query("update restaurants set custom_domain='cardapio.nonna.com.br' where id=$1 returning custom_domain_status", [CANTINA]);
    check("gestor define o domínio próprio com o módulo no plano", r.rows.length === 1 && (r.rows[0] as { custom_domain_status: string }).custom_domain_status === "pending");
    check("domínio inválido é recusado", (await fails("update restaurants set custom_domain='nao é dominio' where id=$1", [CANTINA])) !== null);
  });
  await db.query("update restaurants set custom_domain_status='active' where id=$1", [CANTINA]);
  check("host ativo do restaurante resolve para o restaurante",
    (await db.query<{ r: { kind: string; slug: string } }>("select public.resolve_host('cardapio.nonna.com.br') as r")).rows[0].r?.slug === "cantina-da-nonna");
  await asUser(users.gestorCantina, async () => {
    await db.query("update restaurants set custom_domain=null where id=$1", [CANTINA]);
  });
  check("domínio removido deixa de resolver", (await db.query<{ r: unknown }>("select public.resolve_host('cardapio.nonna.com.br') as r")).rows[0].r === null);
  await asUser(null, async () => {
    check("anônimo não resolve hosts", (await fails("select public.resolve_host('x.com')")) !== null);
  });

  // Fase 3: lista de espera, bloqueios e idiomas ------------------------------------
  const brasaFeatures = (await accessOf(BRASA)).features;
  check("módulos novos ligados para quem já existe", brasaFeatures.waitlist && brasaFeatures.order_blocks && brasaFeatures.languages);
  const f3 = (await db.query<{ id: string; label: string; qr_token: string }>(
    "insert into tables (restaurant_id, label) values ($1, 'F3a'), ($1, 'F3b'), ($1, 'F3c') returning id, label, qr_token", [BRASA])).rows;
  const [f3a, f3b, f3c] = f3;
  await db.query("update menu_items set active=true, sold_out=false, stock_enabled=false, stock_quantity=null where id=$1", [suco.id]);
  const f3Tabs: Record<string, string> = {};
  await asUser(users.garcomBrasa, async () => {
    for (const t of [f3a, f3b]) f3Tabs[t.label] = (await db.query<{ id: string }>("select id from public.open_table($1)", [t.id])).rows[0].id;
  });
  await db.query("update tabs set pin = case table_id when $1 then '3131' else '3232' end where id in ($2, $3)", [f3a.id, f3Tabs.F3a, f3Tabs.F3b]);
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'3131','device-f3a','f3a-1','Ivo')", [f3a.qr_token]);
  await db.query("select public.verify_table_pin('brasa-bistro',$1,'3232','device-f3b','f3b-1','Jai')", [f3b.qr_token]);
  let f3req = 100;
  const f3submit = (t: { qr_token: string }, hash: string, item = suco.id) =>
    fails("select public.submit_table_order('brasa-bistro',$1,$2,$3,$4::jsonb)",
      [t.qr_token, hash, `b0000000-0000-4000-8000-000000000${f3req++}`, JSON.stringify([{ item_id: item, quantity: 1, note: "", modifier_ids: [] }])]);
  check("pedido normal passa antes dos bloqueios", (await f3submit(f3a, "f3a-1")) === null);

  // PIN opcional por restaurante
  const pinCall = (pin: string, device: string, hash: string, name: string | null) =>
    db.query<{ r: { status?: number; tab_id?: string; error?: string } }>(
      "select public.verify_table_pin('brasa-bistro',$1,$2,$3,$4,$5) as r", [f3b.qr_token, pin, device, hash, name]).then((q) => q.rows[0].r);
  check("PIN continua exigido por padrão", (await pinCall("", "device-np", "np-0", "Lia")).status === 401);
  await asUser(users.gestorBrasa, async () => { await db.query("update restaurants set pin_required=false where id=$1", [BRASA]); });
  check("sem PIN, o nome basta para entrar na comanda", (await pinCall("", "device-np", "np-1", "Lia")).tab_id === f3Tabs.F3b);
  check("sem PIN, nome continua obrigatório", (await pinCall("", "device-np", "np-2", null)).status === 400);
  check("sem PIN, mesa sem comanda aberta continua fechada", (await db.query<{ r: { status?: number } }>(
    "select public.verify_table_pin('brasa-bistro',$1,'','device-np','np-3','Lia') as r", [f3c.qr_token])).rows[0].r.status === 409);
  check("sem PIN, sessão envia pedido", (await f3submit(f3b, "np-1")) === null);
  await asUser(users.gestorBrasa, async () => { await db.query("update restaurants set pin_required=true where id=$1", [BRASA]); });
  check("religar o PIN volta a exigir o código", (await pinCall("", "device-np2", "np-4", "Lia")).status === 401);
  check("ligar e desligar o PIN fica no registro",
    (await count("select 1 from audit_log where restaurant_id=$1 and action in ('pin_exigido','pin_dispensado')", [BRASA])) === 2);
  await asUser(users.garcomBrasa, async () => {
    await db.query("update restaurants set pin_required=false where id=$1", [BRASA]);
  });
  check("garçom não muda a exigência do PIN", (await count("select 1 from restaurants where id=$1 and pin_required", [BRASA])) === 1);

  // Pausar pedidos do restaurante
  await asUser(users.cozinhaBrasa, async () => {
    const r = (await db.query<{ r: { orders_paused: boolean } }>("select public.set_orders_paused($1, true, 'Cozinha lotada') as r", [BRASA])).rows[0].r;
    check("cozinha pausa os pedidos (permissão padrão)", r.orders_paused === true);
  });
  const pausedErr = await f3submit(f3a, "f3a-1");
  check("pedido pausado é recusado com o motivo", !!pausedErr && pausedErr.includes("Cozinha lotada"), pausedErr ?? "");
  check("pausa fica no registro", (await count("select 1 from audit_log where restaurant_id=$1 and action='pedidos_pausados'", [BRASA])) === 1);
  await asUser(users.gestorCantina, async () => {
    check("gestor de outro restaurante não pausa o Brasa", (await fails("select public.set_orders_paused($1, false)", [BRASA])) !== null);
  });
  await db.query("update restaurant_members set permissions = permissions || '{\"block_orders\":false}'::jsonb where user_id=$1", [garcomSemFechar]);
  await asUser(garcomSemFechar, async () => {
    check("garçom sem a permissão não retoma", (await fails("select public.set_orders_paused($1, false)", [BRASA])) !== null);
  });
  await asUser(users.garcomBrasa, async () => { await db.query("select public.set_orders_paused($1, false)", [BRASA]); });
  check("retomar volta a aceitar pedidos", (await f3submit(f3a, "f3a-1")) === null);
  check("retomar limpa o motivo", (await count("select 1 from restaurants where id=$1 and not orders_paused and orders_paused_reason is null", [BRASA])) === 1);

  // Bloquear uma comanda
  await asUser(users.garcomBrasa, async () => {
    await db.query("select public.set_tab_blocked($1, true, 'Suspeita')", [f3Tabs.F3a]);
  });
  check("mesa bloqueada não envia pedido", (await f3submit(f3a, "f3a-1")) !== null);
  check("outra mesa do restaurante continua enviando", (await f3submit(f3b, "f3b-1")) === null);
  check("mesa bloqueada ainda chama o garçom",
    !(await db.query<{ r: { error?: string } }>("select public.create_service_call('brasa-bistro',$1,'f3a-1','device-f3a','garcom') as r", [f3a.qr_token])).rows[0].r.error);
  await asUser(users.garcomBrasa, async () => { await db.query("select public.set_tab_blocked($1, false)", [f3Tabs.F3a]); });
  check("mesa desbloqueada volta a enviar", (await f3submit(f3a, "f3a-1")) === null);
  check("bloqueio de mesa fica no registro", (await count("select 1 from audit_log where tab_id=$1 and action in ('mesa_bloqueada','mesa_desbloqueada')", [f3Tabs.F3a])) === 2);

  // Bloquear item e categoria, janela de horário
  await asUser(users.gestorBrasa, async () => {
    await db.query("update menu_items set blocked=true, blocked_reason='Acabou o gelo' where id=$1", [suco.id]);
  });
  const blockedErr = await f3submit(f3a, "f3a-1");
  check("item bloqueado é recusado", !!blockedErr && blockedErr.includes("não está disponível"), blockedErr ?? "");
  check("item bloqueado fica no registro", (await count("select 1 from audit_log where entity_id=$1 and action='item_bloqueado'", [suco.id])) === 1);
  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não bloqueia item (só esgota)", (await fails("update menu_items set blocked=false where id=$1", [suco.id])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    await db.query("update menu_items set blocked=false where id=$1", [suco.id]);
    check("desbloquear limpa o motivo", (await count("select 1 from menu_items where id=$1 and blocked_reason is null", [suco.id])) === 1);
    await db.query("update categories set blocked=true where id=$1", [suco.category_id]);
  });
  check("categoria bloqueada recusa o item", (await f3submit(f3a, "f3a-1")) !== null);
  await asUser(users.gestorBrasa, async () => {
    await db.query("update categories set blocked=false where id=$1", [suco.category_id]);
    check("horário com uma ponta só é recusado", (await fails("update menu_items set available_from='11:00' where id=$1", [suco.id])) !== null);
    check("horário com início igual ao fim é recusado", (await fails("update menu_items set available_from='11:00', available_until='11:00' where id=$1", [suco.id])) !== null);
  });
  const nowSp = (await db.query<{ h: number }>("select extract(hour from now() at time zone 'America/Sao_Paulo')::int as h")).rows[0].h;
  const hh = (h: number) => `${String((h + 24) % 24).padStart(2, "0")}:00`;
  await asUser(users.gestorBrasa, async () => {
    await db.query("update menu_items set available_from=$2, available_until=$3 where id=$1", [suco.id, hh(nowSp + 1), hh(nowSp + 3)]);
  });
  const outErr = await f3submit(f3a, "f3a-1");
  check("item fora do horário é recusado", !!outErr && outErr.includes("fora do horário"), outErr ?? "");
  await asUser(users.gestorBrasa, async () => {
    // Janela que vira a meia-noite e contém a hora atual.
    await db.query("update menu_items set available_from=$2, available_until=$3 where id=$1", [suco.id, hh(nowSp), hh(nowSp - 22)]);
  });
  check("janela que vira a meia-noite aceita dentro do horário", (await f3submit(f3a, "f3a-1")) === null);
  check("within_hours: janela comum e virada", (await db.query<{ a: boolean; b: boolean; c: boolean }>(
    "select private.within_hours(null, null) as a, private.within_hours($1::time, $2::time) as b, private.within_hours($3::time, $4::time) as c",
    [hh(nowSp), hh(nowSp + 1), hh(nowSp + 1), hh(nowSp)])).rows.every((r) => r.a && r.b && !r.c));
  await asUser(users.gestorBrasa, async () => {
    await db.query("update menu_items set available_from=null, available_until=null where id=$1", [suco.id]);
  });

  // Idiomas
  await asUser(users.gestorBrasa, async () => {
    const ok = await db.query("update menu_items set translations=$2::jsonb where id=$1 returning id",
      [suco.id, JSON.stringify({ en: { name: "Orange juice", description: "Fresh" }, es: { name: "Jugo de naranja" } })]);
    check("gestor salva tradução do item", ok.rows.length === 1);
    check("idioma fora de en/es é recusado", (await fails("update menu_items set translations='{\"fr\":{\"name\":\"Jus\"}}' where id=$1", [suco.id])) !== null);
    check("campo desconhecido na tradução é recusado", (await fails("update menu_items set translations='{\"en\":{\"price\":\"1\"}}' where id=$1", [suco.id])) !== null);
    check("categoria aceita só o nome traduzido", (await fails("update categories set translations='{\"en\":{\"description\":\"x\"}}' where id=$1", [suco.category_id])) !== null);
    const saved = await db.query<{ id: string }>("select public.save_menu_item($1, null, $2::jsonb) as id", [BRASA, JSON.stringify({
      category_id: suco.category_id, name: "Limonada F3", description: "", price_cents: 900, photo_url: null, prep_minutes: 3, active: true, featured: false,
      translations: { en: { name: "Lemonade" } }, blocked: true, blocked_reason: "Teste", available_from: "10:00", available_until: "16:00",
      groups: [{ name: "Gelo", required: false, min_select: 0, max_select: 1, position: 0, translations: { es: { name: "Hielo" } },
        modifiers: [{ name: "Com gelo", price_cents: 0, position: 0, translations: { en: { name: "With ice" } } }] }],
    })]);
    const lemon = saved.rows[0].id;
    check("editor salva traduções, bloqueio e horário do item",
      (await count("select 1 from menu_items where id=$1 and translations->'en'->>'name'='Lemonade' and blocked and blocked_reason='Teste' and available_from='10:00'", [lemon])) === 1);
    check("editor salva traduções de grupos e adicionais",
      (await count("select 1 from modifier_groups g join modifiers m on m.group_id=g.id where g.menu_item_id=$1 and g.translations->'es'->>'name'='Hielo' and m.translations->'en'->>'name'='With ice'", [lemon])) === 1);
    await db.query("delete from menu_items where id=$1", [lemon]);
  });

  // Lista de espera
  let w1 = "", w2 = "", w3 = "";
  await asUser(users.garcomBrasa, async () => {
    w1 = (await db.query<{ id: string; number: number }>("select id, number from public.add_waitlist_entry($1, '  Maria   Souza ', 4, '(11) 99999-0000')", [BRASA])).rows[0].id;
    w2 = (await db.query<{ id: string }>("select id from public.add_waitlist_entry($1, 'João', 2)", [BRASA])).rows[0].id;
    w3 = (await db.query<{ id: string }>("select id from public.add_waitlist_entry($1, 'Lia', 3)", [BRASA])).rows[0].id;
  });
  const wl = async (id: string) => (await db.query<{ number: number; status: string; name: string; phone: string | null; public_token: string; called_at: string | null }>(
    "select number, status, name, phone, public_token, called_at from waitlist_entries where id=$1", [id])).rows[0];
  check("números de ordem 1, 2 e 3 no dia", (await wl(w1)).number === 1 && (await wl(w2)).number === 2 && (await wl(w3)).number === 3);
  check("nome e telefone normalizados", (await wl(w1)).name === "Maria Souza" && (await wl(w1)).phone === "11999990000");
  await db.query("insert into waitlist_entries (restaurant_id, day, number, name, party_size) values ($1, current_date - 1, 1, 'Ontem', 2)", [BRASA]);
  check("o mesmo número pode existir em outro dia", (await count("select 1 from waitlist_entries where restaurant_id=$1 and number=1", [BRASA])) === 2);
  await asUser(users.cozinhaBrasa, async () => {
    check("cozinha não cadastra na espera", (await fails("select public.add_waitlist_entry($1, 'X', 2)", [BRASA])) !== null);
  });
  await asUser(users.gestorCantina, async () => {
    check("gestor da Cantina não vê a espera do Brasa", (await count("select 1 from waitlist_entries where restaurant_id=$1", [BRASA])) === 0);
    check("gestor da Cantina não cadastra no Brasa", (await fails("select public.add_waitlist_entry($1, 'X', 2)", [BRASA])) !== null);
  });
  await asUser(null, async () => {
    check("anônimo não lê a espera", (await fails("select * from waitlist_entries")) !== null);
    check("anônimo não chama o status público direto", (await fails("select public.waitlist_status('brasa-bistro', gen_random_uuid())")) !== null);
  });
  const status = async (id: string) => (await db.query<{ r: { number: number; ahead: number; status: string; name: string } | null }>(
    "select public.waitlist_status('brasa-bistro', $1) as r", [(await wl(id)).public_token])).rows[0].r;
  check("status público: posição e primeiro nome", (await status(w3))?.ahead === 2 && (await status(w1))?.name === "Maria");
  check("token de outro restaurante não vale", (await db.query<{ r: unknown }>("select public.waitlist_status('cantina-da-nonna', $1) as r", [(await wl(w1)).public_token])).rows[0].r === null);
  await asUser(users.garcomBrasa, async () => {
    await db.query("update waitlist_entries set status='chamado' where id=$1", [w1]);
    check("chamar carimba o horário", !!(await wl(w1)).called_at);
    await db.query("update waitlist_entries set status='aguardando' where id=$1", [w1]);
    check("desfazer a chamada limpa o horário", (await wl(w1)).called_at === null);
    check("não troca o número de ordem", (await fails("update waitlist_entries set number=9 where id=$1", [w2])) !== null);
    await db.query("update waitlist_entries set status='desistiu' where id=$1", [w2]);
    check("desistência é final", (await fails("update waitlist_entries set status='aguardando' where id=$1", [w2])) !== null);
    check("sentar numa mesa ocupada é recusado", (await fails("select public.seat_waitlist_entry($1, $2)", [w1, f3a.id])) !== null);
    const seated = (await db.query<{ r: { tab_id: string; pin: string } }>("select public.seat_waitlist_entry($1, $2) as r", [w1, f3c.id])).rows[0].r;
    check("sentar numa mesa livre abre a comanda", !!seated.tab_id && /^\d{4}$/.test(seated.pin));
  });
  check("quem desistiu ou sentou não conta na frente", (await status(w3))?.ahead === 0);
  check("espera fica no registro", (await count("select 1 from audit_log where entity='waitlist' and restaurant_id=$1", [BRASA])) >= 6);
  await db.query("update waitlist_entries set created_at = now() - interval '13 hours' where id=$1", [w3]);
  check("link público vence em 12 horas", (await status(w3)) === null);

  // Módulos desligados no plano
  await asUser(users.revenda, async () => {
    await db.query("update plans set features = features || '{\"waitlist\":false,\"order_blocks\":false,\"languages\":false}'::jsonb where id=$1", [basico]);
    await db.query("select public.set_subscription($1, $2, 'ativa')", [BRASA, basico]);
    await db.query("update subscriptions set current_period_end=null where restaurant_id=$1", [BRASA]);
  });
  check("plano sem os módulos desliga as chaves", (await accessOf(BRASA)).features.waitlist === false);
  await asUser(users.garcomBrasa, async () => {
    check("espera fora do plano é recusada", (await fails("select public.add_waitlist_entry($1, 'X', 2)", [BRASA])) !== null);
    check("pausa fora do plano é recusada", (await fails("select public.set_orders_paused($1, true)", [BRASA])) !== null);
  });
  await asUser(users.gestorBrasa, async () => {
    check("bloqueio de item fora do plano é recusado", (await fails("update menu_items set blocked=true where id=$1", [suco.id])) !== null);
  });
  await db.query("update tabs set orders_blocked=true where id=$1", [f3Tabs.F3a]);
  check("bloqueio antigo não trava pedido com o módulo desligado", (await f3submit(f3a, "f3a-1")) === null);
  await db.query("update tabs set orders_blocked=false where id=$1", [f3Tabs.F3a]);
  await asUser(users.revenda, async () => {
    await db.query("select public.set_subscription($1, $2, 'ativa')", [BRASA, completo]);
    await db.query("update subscriptions set current_period_end=null where restaurant_id=$1", [BRASA]);
  });

  console.log(failures ? `\n${failures} verificação(ões) falharam` : "\nTudo certo.");
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
