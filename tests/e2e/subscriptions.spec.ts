import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerOrigin } from "./helpers";

const BRASA = "20000000-0000-4000-8000-000000000001";
const RESELLER = "10000000-0000-4000-8000-000000000001";
async function login(page: Page, email: string, password: string, route: string) {
  await page.goto("/app/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(route);
}

test("revenda cria plano sem estoque, suspende e reativa o restaurante; módulo e bloqueio valem no cliente e no painel", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const origin = process.env.QA_BASE_URL || "http://localhost:3000";
  const menuOrigin = await customerOrigin();
  const resellerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { data: original } = await admin.from("subscriptions").select("plan_id,status,current_period_end").eq("restaurant_id", BRASA).single();
  const { data: table } = await admin.from("tables").select("qr_token").eq("restaurant_id", BRASA).limit(1).single();
  let planId = "";
  try {
    const reseller = await resellerContext.newPage();
    await login(reseller, "revenda@comanda.dev", process.env.SEED_RESELLER_PASSWORD || process.env.SEED_USER_PASSWORD!, "/app/revenda");
    // Plano novo sem estoque nem bar.
    await reseller.getByRole("button", { name: "Planos", exact: true }).click();
    await reseller.getByRole("button", { name: "Novo plano", exact: true }).click();
    await reseller.getByLabel("Nome", { exact: true }).fill(`Essencial ${stamp}`);
    await reseller.getByLabel("Preço do plano").fill("149.90");
    await reseller.getByLabel("Controle de estoque").uncheck();
    await reseller.getByLabel("Painel do bar").uncheck();
    await reseller.getByRole("button", { name: "Salvar plano", exact: true }).click();
    await expect(reseller.getByRole("heading", { name: `Essencial ${stamp}` })).toBeVisible();
    const { data: plan } = await admin.from("plans").select("id,features,price_cents").eq("reseller_id", RESELLER).eq("name", `Essencial ${stamp}`).single();
    planId = plan!.id;
    expect(plan!.features).toMatchObject({ stock: false, bar: false, finance: true });
    expect(plan!.price_cents).toBe(14990);
    // Brasa Bistrô passa para o plano novo, suspenso.
    await reseller.getByRole("button", { name: "Restaurantes", exact: true }).click();
    const card = reseller.getByRole("article").filter({ hasText: "Brasa Bistrô" }).filter({ hasText: "/brasa-bistro" });
    await card.getByRole("button", { name: "Plano e status", exact: true }).click();
    await card.getByLabel("Plano").selectOption(planId);
    await card.getByLabel("Status da assinatura").selectOption("suspensa");
    await card.getByRole("button", { name: "Salvar assinatura", exact: true }).click();
    await expect(card.getByText("Suspensa", { exact: true })).toBeVisible();
    // Cliente: cardápio indisponível e PIN recusado.
    const endpoint = `${menuOrigin}/api/customer/brasa-bistro/${table!.qr_token}`;
    const menu = await (await customer.request.get(`${menuOrigin}/api/menu/brasa-bistro/${table!.qr_token}`)).json();
    expect(menu.suspended).toBe(true);
    expect(menu.items).toEqual([]);
    const page = await customer.newPage();
    await page.goto(`/brasa-bistro/m/${table!.qr_token}`);
    await expect(page.getByRole("alert").filter({ hasText: "Cardápio temporariamente" })).toBeVisible();
    expect((await customer.request.post(endpoint, { headers: { Origin: menuOrigin }, data: { action: "pin", pin: "0000", name: "X" } })).status()).toBe(403);
    // Gestor: painel em modo leitura, aviso visível, módulo de estoque some.
    const manager = await managerContext.newPage();
    await login(manager, "gestor@brasa.dev", process.env.SEED_USER_PASSWORD!, "/app/gestor");
    await expect(manager.getByRole("alert").filter({ hasText: "Assinatura suspensa" })).toBeVisible();
    await expect(manager.getByRole("button", { name: "Estoque", exact: true })).toHaveCount(0);
    await expect(manager.getByRole("button", { name: "Financeiro", exact: true })).toBeVisible();
    const blocked = await manager.request.post(`/api/manage/${BRASA}`, { headers: { Origin: origin }, data: { action: "settings", data: { mode: "fifo", weight_wait: 1, weight_complexity: 1, max_wait_minutes: 20 } } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error).toContain("Assinatura suspensa");
    // Reativa: tudo volta; estoque continua fora do plano (403), bar também.
    await card.getByRole("button", { name: "Plano e status", exact: true }).click();
    await card.getByLabel("Status da assinatura").selectOption("ativa");
    await card.getByRole("button", { name: "Salvar assinatura", exact: true }).click();
    await expect(card.getByText("Ativa", { exact: true })).toBeVisible();
    expect((await (await customer.request.get(`${menuOrigin}/api/menu/brasa-bistro/${table!.qr_token}`)).json()).items.length).toBeGreaterThan(0);
    const { data: item } = await admin.from("menu_items").select("id").eq("restaurant_id", BRASA).limit(1).single();
    const stock = await manager.request.post(`/api/manage/${BRASA}`, { headers: { Origin: origin }, data: { action: "stock", data: { item_id: item!.id, kind: "entrada", quantity: 1 } } });
    expect(stock.status()).toBe(403);
    expect((await stock.json()).error).toContain("não incluída no seu plano");
    const settings = await manager.request.post(`/api/manage/${BRASA}`, { headers: { Origin: origin }, data: { action: "settings", data: { mode: "balanced", weight_wait: 1, weight_complexity: 1, max_wait_minutes: 20 } } });
    expect(settings.status()).toBe(200);
    // Pagamento registrado pela revenda: vencimento definido, receita no painel.
    await card.getByRole("button", { name: "Registrar pagamento", exact: true }).click();
    await card.getByLabel("Início do período").fill("2026-10-01");
    await card.getByLabel("Fim do período").fill("2026-10-31");
    await card.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
    await expect(card).toContainText("vence 31/10/2026");
    await expect(reseller.getByText("Receita recorrente do mês")).toBeVisible();
    // Suporte: WhatsApp cadastrado aparece no botão Ajuda do gestor.
    await reseller.getByRole("button", { name: "Marca", exact: true }).click();
    await reseller.getByLabel("WhatsApp de suporte").fill("5511999990000");
    await reseller.getByLabel("Horário de atendimento").fill("Seg a sex, 9h às 18h");
    await reseller.getByRole("button", { name: "Salvar marca", exact: true }).click();
    await expect(reseller.getByRole("status")).toContainText("Alterações salvas");
    await manager.reload();
    await manager.getByRole("button", { name: "Ajuda", exact: true }).click();
    const help = manager.getByRole("dialog", { name: "Ajuda" });
    await expect(help.getByRole("link", { name: "Falar no WhatsApp" })).toHaveAttribute("href", /wa\.me\/5511999990000/);
    await expect(help).toContainText("Seg a sex, 9h às 18h");
  } finally {
    await Promise.allSettled([resellerContext.close(), managerContext.close(), customer.close()]);
    if (original) await admin.from("subscriptions").update({ plan_id: original.plan_id, status: original.status, current_period_end: original.current_period_end, trial_ends_at: null }).eq("restaurant_id", BRASA);
    await admin.from("subscription_payments").delete().in("subscription_id", (await admin.from("subscriptions").select("id").eq("restaurant_id", BRASA)).data?.map((s) => s.id) ?? []);
    if (planId) await admin.from("plans").delete().eq("id", planId);
    await admin.from("resellers").update({ support_whatsapp: null, support_email: null, support_hours: null }).eq("id", RESELLER);
  }
});
