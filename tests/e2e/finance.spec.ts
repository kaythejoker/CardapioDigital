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

test("taxa de serviço, pagamento por forma, bloqueio do fechamento e fechamento do dia", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const label = `E2E-fin-${stamp}`;
  const origin = await customerOrigin();
  const waiterContext = await browser.newContext();
  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const customer = await browser.newContext();
  let tableId = "";
  let closureId = "";
  const { data: before } = await admin.from("restaurants").select("service_fee_percent,service_fee_optional").eq("id", BRASA).single();
  try {
    await admin.from("restaurants").update({ service_fee_percent: 10, service_fee_optional: true }).eq("id", BRASA);
    const { data: table, error } = await admin
      .from("tables")
      .insert({ restaurant_id: BRASA, label })
      .select("id,qr_token")
      .single();
    if (error) throw error;
    tableId = table.id;
    const waiter = await waiterContext.newPage();
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    const card = waiter.getByRole("button").filter({ has: waiter.getByRole("heading", { name: label, exact: true }) });
    await card.click();
    await waiter.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    await expect(waiter.getByText("Código da mesa", { exact: true })).toBeVisible();
    const { data: tab } = await admin.from("tabs").select("id,pin,service_fee_percent").eq("table_id", tableId).eq("status", "open").single();
    expect(Number(tab!.service_fee_percent)).toBe(10);
    const { data: items } = await admin
      .from("menu_items")
      .select("id,price_cents,modifier_groups(id)")
      .eq("restaurant_id", BRASA)
      .eq("active", true)
      .eq("sold_out", false)
      .eq("stock_enabled", false);
    const item = items!.find((i) => i.modifier_groups.length === 0)!;
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    const post = (data: unknown) => customer.request.post(endpoint, { headers: { Origin: origin }, data });
    expect((await post({ action: "pin", pin: tab!.pin, name: "Rui" })).status()).toBe(200);
    expect((await post({ action: "order", request_id: crypto.randomUUID(), items: [{ item_id: item.id, quantity: 2, note: "", modifier_ids: [] }] })).status()).toBe(201);
    const itemsCents = item.price_cents * 2;
    const fee = Math.round(itemsCents * 0.1);
    // Cliente vê o total com a taxa.
    const snapshot = await (await customer.request.get(endpoint)).json();
    expect(snapshot.totals.fee_cents).toBe(fee);
    expect(snapshot.totals.due_cents).toBe(itemsCents + fee);
    // Garçom: taxa aparece, pode ser retirada e aplicada de novo; fechar sem pagar é bloqueado.
    await waiter.getByRole("button", { name: "Ver pedidos", exact: true }).click();
    await expect(waiter.getByText("Taxa de serviço 10%")).toBeVisible();
    await waiter.getByRole("button", { name: "Retirar", exact: true }).click();
    await expect(waiter.getByText("retirada")).toBeVisible();
    await waiter.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(waiter.getByText("retirada")).toHaveCount(0);
    await waiter.getByRole("button", { name: "Fechar comanda", exact: true }).click();
    await expect(waiter.getByText(/^Faltam R\$/)).toBeVisible();
    await expect(waiter.getByRole("button", { name: "Confirmar fechamento", exact: true })).toBeDisabled();
    await waiter.getByRole("button", { name: "Voltar", exact: true }).click();
    // Pagamento da pessoa em pix (parcial) + mesa em dinheiro (resto).
    await waiter.getByRole("button", { name: "Registrar pagamento de Rui", exact: true }).click();
    await waiter.getByLabel("Forma de pagamento").selectOption("pix");
    await waiter.getByLabel("Valor recebido").fill(((itemsCents - 500) / 100).toFixed(2));
    await waiter.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
    await expect(waiter.getByText("Falta", { exact: true })).toBeVisible();
    await waiter.getByRole("button", { name: "Registrar pagamento da mesa", exact: true }).click();
    await waiter.getByLabel("Forma de pagamento").selectOption("dinheiro");
    await waiter.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
    await expect(waiter.getByText("Quitado", { exact: true })).toBeVisible();
    await waiter.getByRole("button", { name: "Fechar comanda", exact: true }).click();
    await waiter.getByRole("button", { name: "Confirmar fechamento", exact: true }).click();
    await expect(waiter.getByText("Código da mesa", { exact: true })).toHaveCount(0);
    const { data: payments } = await admin.from("payments").select("method,amount_cents,guest_id").eq("tab_id", tab!.id).is("voided_at", null).order("created_at");
    expect(payments!.map((p) => `${p.method}:${p.amount_cents}:${p.guest_id ? "pessoa" : "mesa"}`)).toEqual([
      `pix:${itemsCents - 500}:pessoa`,
      `dinheiro:${fee + 500}:mesa`,
    ]);
    const { data: closed } = await admin.from("tabs").select("status,closed_by").eq("id", tab!.id).single();
    expect(closed!.status).toBe("closed");
    expect(closed!.closed_by).toBeTruthy();
    // Gestor: Financeiro mostra a comanda e fecha o dia (se ainda não fechado hoje).
    const manager = await managerContext.newPage();
    await login(manager, "gestor@brasa.dev", "/app/gestor");
    await manager.getByRole("button", { name: "Financeiro", exact: true }).click();
    const row = manager.getByRole("row").filter({ hasText: label });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`R$ ${((itemsCents + fee) / 100).toFixed(2).replace(".", ",")}`);
    const closeButton = manager.getByRole("button", { name: "Fechar o dia", exact: true });
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await manager.getByRole("button", { name: "Confirmar fechamento do dia", exact: true }).click();
      await expect(manager.getByText("Hoje já fechado", { exact: true })).toBeVisible();
      const { data: closure } = await admin.from("cash_closures").select("id,totals").eq("restaurant_id", BRASA).order("closed_at", { ascending: false }).limit(1).single();
      closureId = closure!.id;
      const totals = closure!.totals as { by_method: Record<string, number>; tabs_closed: number };
      expect(totals.by_method.pix).toBeGreaterThanOrEqual(itemsCents - 500);
      expect(totals.tabs_closed).toBeGreaterThanOrEqual(1);
    } else {
      await expect(manager.getByText("Hoje já fechado", { exact: true })).toBeVisible();
    }
  } finally {
    await Promise.allSettled([waiterContext.close(), managerContext.close(), customer.close()]);
    await admin.from("restaurants").update({ service_fee_percent: before?.service_fee_percent ?? 0, service_fee_optional: before?.service_fee_optional ?? true }).eq("id", BRASA);
    if (closureId) await admin.from("cash_closures").delete().eq("id", closureId);
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
  }
});
