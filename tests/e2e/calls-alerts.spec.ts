import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerOrigin } from "./helpers";

const BRASA = "20000000-0000-4000-8000-000000000001";
async function login(page: Page, email: string, route: string) {
  await page.goto("/app/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(process.env.SEED_USER_PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(route);
}

test("cliente chama o garçom e pede a conta; garçom vê, é avisado e atende", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const label = `E2E-chamada-${Date.now()}`;
  const { data: table, error } = await admin
    .from("tables")
    .insert({ restaurant_id: BRASA, label })
    .select("id,qr_token")
    .single();
  if (error) throw error;
  const waiterContext = await browser.newContext();
  const customerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const waiter = await waiterContext.newPage();
  const customer = await customerContext.newPage();
  try {
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await expect(waiter.getByText("Suas mesas", { exact: true })).toBeVisible();
    await expect(waiter.getByText("Ao vivo", { exact: false })).toBeVisible();
    await expect(waiter).toHaveTitle(/Salão/);
    // Mesa livre: chamada para abrir a mesa, sem PIN.
    const url = `/brasa-bistro/m/${table.qr_token}`;
    await customer.goto(url);
    const start = Date.now();
    await customer
      .getByRole("button", { name: "Chamar garçom para abrir a mesa", exact: true })
      .click();
    await expect(customer.getByRole("status")).toContainText("Avisamos o garçom");
    const tableCard = waiter
      .getByRole("button")
      .filter({ has: waiter.getByRole("heading", { name: label, exact: true }) });
    await expect(tableCard).toContainText("Chamando", { timeout: 3000 });
    console.log(`Chamada visível no garçom em ${Date.now() - start}ms`);
    await expect(waiter.getByRole("status").filter({ hasText: "chamada" })).toBeVisible();
    // Título da aba com a pendência e botão de som disponível.
    await expect(waiter).toHaveTitle(/^\(1\) /);
    await expect(waiter.getByRole("button", { name: "Ativar som", exact: true })).toBeVisible();
    // Cliente cancela; o aviso some do garçom.
    await customer.getByRole("button", { name: "Cancelar chamada", exact: true }).click();
    await expect(tableCard).not.toContainText("Chamando", { timeout: 5000 });
    // Garçom abre a mesa; cliente entra com o PIN e pede a conta.
    await tableCard.click();
    await waiter.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    await expect(waiter.getByText("Código da mesa", { exact: true })).toBeVisible();
    const { data: tab } = await admin
      .from("tabs")
      .select("id,pin")
      .eq("table_id", table.id)
      .eq("status", "open")
      .single();
    await waiter.getByRole("button", { name: "Fechar detalhe da mesa" }).click();
    const origin = await customerOrigin();
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    expect(
      (await customerContext.request.post(endpoint, {
        headers: { Origin: origin },
        data: { action: "pin", pin: tab!.pin, name: "Edu E2E" },
      })).status(),
    ).toBe(200);
    await customer.goto(url);
    await customer.getByRole("button", { name: "Chamar garçom", exact: true }).click();
    await customer.getByRole("button", { name: /Pedir a conta/ }).click();
    await expect(customer.getByRole("status")).toContainText("vem até a mesa para fechar");
    await expect(tableCard).toContainText("Pede a conta", { timeout: 3000 });
    // Pedir a conta não fecha nada: a comanda continua aberta.
    const { data: still } = await admin.from("tabs").select("status").eq("id", tab!.id).single();
    expect(still!.status).toBe("open");
    // Garçom atende; registro guarda quem atendeu.
    await tableCard.click();
    await waiter.getByRole("button", { name: "Atender chamada: Pede a conta", exact: true }).click();
    await expect(waiter.getByRole("button", { name: /Atender chamada/ })).toHaveCount(0);
    const { data: log } = await admin
      .from("audit_log")
      .select("action,actor_role")
      .eq("restaurant_id", BRASA)
      .eq("tab_id", tab!.id)
      .in("action", ["chamada_criada", "chamada_atendida"]);
    expect(log!.map((l) => `${l.action}:${l.actor_role}`).toSorted()).toEqual([
      "chamada_atendida:waiter",
      "chamada_criada:customer",
    ]);
    await expect(customer.getByRole("status")).toContainText("Chamada atendida", { timeout: 12_000 });
  } finally {
    await Promise.allSettled([waiterContext.close(), customerContext.close()]);
    const cleanup = await admin.from("tables").delete().eq("id", table.id);
    if (cleanup.error) throw cleanup.error;
  }
});
