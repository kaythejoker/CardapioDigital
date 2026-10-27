import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerOrigin } from "./helpers";

// Fase 3 (spec-fase3.md): lista de espera, pausa, bloqueio de mesa, idiomas e
// PIN opcional. Usa só o Brasa Bistrô do seed e apaga a mesa criada no fim.
const BRASA = "20000000-0000-4000-8000-000000000001";
const shots = (name: string) => `tmp/fase3-${name}.png`;

async function login(page: Page, email: string, route: string) {
  await page.goto("/app/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(process.env.SEED_USER_PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(route);
}

test("espera, pausa, bloqueio, idiomas e PIN opcional", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const stamp = Date.now();
  const label = `E2E-f3-${stamp}`;
  const group = `Grupo E2E ${stamp}`;
  const { data: table, error } = await admin
    .from("tables")
    .insert({ restaurant_id: BRASA, label })
    .select("id,qr_token")
    .single();
  if (error) throw error;
  const waiterContext = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const waiter = await waiterContext.newPage();
  const manager = await managerContext.newPage();
  const customer = await customerContext.newPage();
  const origin = await customerOrigin();
  // Erros de console e de execução das páginas aparecem na saída do teste.
  const consoleErrors: string[] = [];
  for (const [who, page] of [["garçom", waiter], ["gestor", manager], ["cliente", customer]] as const) {
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${who}] ${m.text()}`));
    page.on("pageerror", (e) => consoleErrors.push(`[${who}] ${e.message}`));
  }
  const menuUrl = `${origin}/brasa-bistro/m/${table.qr_token}`;
  let entryId: string | undefined;
  try {
    // Lista de espera: cadastro, número, página do cliente, chamar e sentar.
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await expect(waiter.getByText("Suas mesas", { exact: true })).toBeVisible();
    await waiter.getByRole("tab", { name: /Espera/ }).click();
    await waiter.getByRole("button", { name: "Adicionar grupo", exact: true }).click();
    await waiter.locator('input[name="name"]').fill(group);
    await waiter.locator('input[name="party_size"]').fill("3");
    await waiter.getByRole("button", { name: "Entrar na fila", exact: true }).click();
    const entryRow = waiter.locator("li.waitlist-entry").filter({ hasText: group });
    await expect(entryRow).toBeVisible();
    const { data: entry } = await admin
      .from("waitlist_entries")
      .select("id,number,public_token,status")
      .eq("restaurant_id", BRASA)
      .eq("name", group)
      .single();
    entryId = entry!.id;
    await expect(entryRow.getByLabel(`Senha ${entry!.number}`)).toBeVisible();
    await waiter.screenshot({ path: shots("1-espera-garcom") });

    await customer.goto(`${origin}/brasa-bistro/espera/${entry!.public_token}`);
    await expect(customer.getByText("Seu número", { exact: true })).toBeVisible();
    await expect(customer.locator(".waitlist-number")).toHaveText(String(entry!.number));
    await customer.screenshot({ path: shots("2-espera-cliente") });

    await entryRow.getByRole("button", { name: "Chamar", exact: true }).click();
    await expect(customer.getByText("Sua mesa está pronta!", { exact: true })).toBeVisible({ timeout: 15_000 });
    await customer.screenshot({ path: shots("3-espera-chamado") });

    await entryRow.getByRole("button", { name: "Sentar", exact: true }).click();
    await waiter.getByRole("button", { name: `Sentar na mesa ${label}`, exact: true }).click();
    await expect(waiter.getByText("Código da mesa", { exact: true })).toBeVisible();
    await expect(customer.getByText("Bom apetite!", { exact: true })).toBeVisible({ timeout: 15_000 });
    const { data: tab } = await admin
      .from("tabs")
      .select("id,pin")
      .eq("table_id", table.id)
      .eq("status", "open")
      .single();
    expect((await admin.from("waitlist_entries").select("status,table_id").eq("id", entryId).single()).data).toEqual({
      status: "sentado",
      table_id: table.id,
    });

    // Cliente entra com o PIN (ainda exigido) e vê o cardápio liberado.
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    expect(
      (await customerContext.request.post(endpoint, {
        headers: { Origin: origin },
        data: { action: "pin", pin: "", name: "Sem PIN" },
      })).status(),
    ).toBe(401);
    expect(
      (await customerContext.request.post(endpoint, {
        headers: { Origin: origin },
        data: { action: "pin", pin: tab!.pin, name: "Lia E2E" },
      })).status(),
    ).toBe(200);

    // Bloquear os pedidos desta mesa.
    await waiter.getByRole("button", { name: "Bloquear novos pedidos desta mesa", exact: true }).click();
    await waiter.getByLabel("Motivo (opcional, o cliente vê)").fill("Conta em revisão E2E");
    await waiter.locator(".tab-block-box").getByRole("button", { name: "Bloquear pedidos", exact: true }).click();
    await expect(waiter.getByText("Novos pedidos desta mesa bloqueados.", { exact: true })).toBeVisible();
    await customer.goto(menuUrl);
    await expect(customer.getByText("Novos pedidos desta mesa estão bloqueados", { exact: true })).toBeVisible();
    await customer.screenshot({ path: shots("4-mesa-bloqueada") });
    await waiter.getByRole("button", { name: "Desbloquear pedidos", exact: true }).click();
    await expect(waiter.getByRole("button", { name: "Bloquear novos pedidos desta mesa", exact: true })).toBeVisible();
    await waiter.getByRole("button", { name: "Fechar detalhe da mesa" }).click();

    // Pausar pedidos do restaurante.
    await waiter.getByRole("button", { name: "Pausar pedidos", exact: true }).click();
    await waiter.getByLabel("Motivo (opcional, o cliente vê)").fill("Cozinha lotada E2E");
    await waiter.locator(".pause-sheet").getByRole("button", { name: "Pausar pedidos", exact: true }).click();
    await expect(waiter.getByRole("button", { name: "Retomar pedidos", exact: true })).toBeVisible();
    await waiter.screenshot({ path: shots("5-pausa-garcom") });
    await customer.goto(menuUrl);
    await expect(customer.getByText("Pedidos pausados no momento", { exact: true })).toBeVisible();
    await expect(customer.getByText("Cozinha lotada E2E", { exact: true })).toBeVisible();
    await customer.screenshot({ path: shots("6-pausa-cliente") });
    await waiter.getByRole("button", { name: "Retomar pedidos", exact: true }).click();
    await expect(waiter.getByRole("button", { name: "Pausar pedidos", exact: true })).toBeVisible();

    // Idioma do painel.
    await waiter.getByRole("combobox", { name: "Idioma" }).selectOption("en");
    await expect(waiter.getByText("Your tables", { exact: true })).toBeVisible();
    await waiter.screenshot({ path: shots("7-garcom-ingles") });
    await waiter.getByRole("combobox", { name: "Language" }).selectOption("pt");

    // Gestor desliga o PIN; um celular novo entra só com o nome.
    await login(manager, "gestor@brasa.dev", "/app/gestor");
    await manager.getByRole("button", { name: "Configurações", exact: true }).click();
    const pinBox = manager.getByRole("checkbox", { name: "Exigir PIN da mesa" });
    await expect(pinBox).toBeChecked();
    await pinBox.uncheck();
    await manager.getByRole("button", { name: "Salvar PIN da mesa", exact: true }).click();
    await expect(manager.getByText("Alterações salvas", { exact: true })).toBeVisible();
    await manager.screenshot({ path: shots("8-gestor-pin") });

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await phone.newPage();
      await page.goto(menuUrl);
      // Sem sessão, adicionar um item leva à tela de entrada.
      await page.getByRole("button", { name: /Salada da casa/ }).first().click();
      await page.getByRole("button", { name: /^Adicionar/ }).click();
      await expect(page.getByRole("heading", { name: "Qual é o seu nome?" })).toBeVisible();
      await expect(page.getByLabel("Código de 4 dígitos")).toHaveCount(0);
      await page.screenshot({ path: shots("9-cliente-sem-pin") });
      await page.getByLabel("Seu nome").fill("Rui E2E");
      await page.getByRole("button", { name: "Entrar na mesa", exact: true }).click();
      // Volta ao carrinho, liberado; o pedido não é enviado.
      await expect(page.getByRole("heading", { name: "Seu pedido" })).toBeVisible();
      const { count } = await admin
        .from("tab_guests")
        .select("id", { count: "exact", head: true })
        .eq("tab_id", tab!.id)
        .eq("name", "Rui E2E");
      expect(count).toBe(1);
    } finally {
      await phone.close();
    }

    await pinBox.check();
    await manager.getByRole("button", { name: "Salvar PIN da mesa", exact: true }).click();
    await expect(manager.getByText("Alterações salvas", { exact: true })).toBeVisible();
    const { data: log } = await admin
      .from("audit_log")
      .select("action")
      .eq("restaurant_id", BRASA)
      .in("action", ["pin_dispensado", "pin_exigido"])
      .gte("created_at", new Date(stamp).toISOString());
    expect(log!.map((l) => l.action).toSorted()).toEqual(["pin_dispensado", "pin_exigido"]);
  } finally {
    if (consoleErrors.length) console.log(consoleErrors.join("\n"));
    await Promise.allSettled([waiterContext.close(), managerContext.close(), customerContext.close()]);
    // Segurança: o Brasa Bistrô volta ao normal mesmo se o teste falhar no meio.
    await admin.from("restaurants").update({ pin_required: true, orders_paused: false, orders_paused_reason: null }).eq("id", BRASA);
    if (entryId) await admin.from("waitlist_entries").delete().eq("id", entryId);
    const cleanup = await admin.from("tables").delete().eq("id", table.id);
    if (cleanup.error) throw cleanup.error;
  }
});
