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

test("estoque baixa no pedido, cancelamento por item devolve e gestor repõe", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const name = `Item estoque ${stamp}`;
  const origin = await customerOrigin();
  const customerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const waiterContext = await browser.newContext();
  const managerContext = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  let tableId = "";
  let itemId = "";
  let categoryId = "";
  try {
    const { data: table, error } = await admin
      .from("tables")
      .insert({ restaurant_id: BRASA, label: `E2E-estoque-${stamp}` })
      .select("id,qr_token,label")
      .single();
    if (error) throw error;
    tableId = table.id;
    const { data: category } = await admin
      .from("categories")
      .insert({ restaurant_id: BRASA, name: "Categoria estoque", position: 101 })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: item } = await admin
      .from("menu_items")
      .insert({
        restaurant_id: BRASA,
        category_id: categoryId,
        name,
        price_cents: 1500,
        prep_minutes: 5,
        stock_enabled: true,
        stock_quantity: 2,
        low_stock_threshold: 1,
      })
      .select("id")
      .single();
    itemId = item!.id;
    let pin = "";
    let tabId = "";
    for (let i = 0; i < 30; i++) {
      pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const result = await admin
        .from("tabs")
        .insert({ restaurant_id: BRASA, table_id: tableId, pin })
        .select("id")
        .single();
      if (!result.error) {
        tabId = result.data.id;
        break;
      }
    }
    expect(tabId).not.toBe("");
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    const post = (data: unknown) =>
      customerContext.request.post(endpoint, { headers: { Origin: origin }, data });
    expect((await post({ action: "pin", pin, name: "Caio E2E" })).status()).toBe(200);
    // Acima do saldo: recusado com a quantidade restante.
    const tooMany = await post({
      action: "order",
      request_id: crypto.randomUUID(),
      items: [{ item_id: itemId, quantity: 3, note: "", modifier_ids: [] }],
    });
    expect(tooMany.status()).toBe(409);
    expect((await tooMany.json()).error).toContain("Restam 2 unidades");
    const order = await post({
      action: "order",
      request_id: crypto.randomUUID(),
      items: [
        { item_id: itemId, quantity: 1, note: "sem gelo", modifier_ids: [] },
        { item_id: itemId, quantity: 1, note: "com gelo", modifier_ids: [] },
      ],
    });
    expect(order.status()).toBe(201);
    const { data: afterSale } = await admin
      .from("menu_items")
      .select("stock_quantity,sold_out,sold_out_auto")
      .eq("id", itemId)
      .single();
    expect(afterSale).toEqual({ stock_quantity: 0, sold_out: true, sold_out_auto: true });
    // Esgotado pelo estoque some do cardápio público.
    const menu = await customerContext.request.get(`${origin}/api/menu/brasa-bistro/${table.qr_token}`);
    expect((await menu.json()).items.some((i: { id: string }) => i.id === itemId)).toBe(false);
    // Cliente cancela um item na tela da comanda.
    const customer = await customerContext.newPage();
    await customer.goto(`/brasa-bistro/m/${table.qr_token}`);
    await customer.getByRole("button", { name: "Minha comanda", exact: true }).click();
    await customer.getByRole("button", { name: `Cancelar item ${name}` }).first().click();
    await expect(customer.getByText("Cancelado", { exact: true })).toBeVisible();
    const { data: afterCustomerCancel } = await admin
      .from("menu_items")
      .select("stock_quantity,sold_out")
      .eq("id", itemId)
      .single();
    expect(afterCustomerCancel).toEqual({ stock_quantity: 1, sold_out: false });
    const tab = await (await customerContext.request.get(endpoint)).json();
    expect(tab.total_cents).toBe(1500);
    // Garçom cancela o outro item com motivo: o pedido inteiro fica cancelado.
    const waiter = await waiterContext.newPage();
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await waiter
      .getByRole("button")
      .filter({ has: waiter.getByRole("heading", { name: table.label, exact: true }) })
      .click();
    await waiter.getByRole("button", { name: "Ver pedidos", exact: true }).click();
    await waiter.getByRole("button", { name: `Cancelar item ${name}` }).click();
    await waiter.getByLabel("Motivo do cancelamento").selectOption("Saiu errado");
    await waiter.getByRole("button", { name: "Confirmar cancelamento", exact: true }).click();
    await expect(waiter.getByText("Motivo: Saiu errado")).toBeVisible();
    const { data: cancelled } = await admin
      .from("orders")
      .select("status,total_cents,cancel_reason")
      .eq("tab_id", tabId)
      .single();
    expect(cancelled).toEqual({ status: "cancelado", total_cents: 0, cancel_reason: "Saiu errado" });
    // Gestor vê o saldo de volta em 2 e repõe 3.
    const manager = await managerContext.newPage();
    await login(manager, "gestor@brasa.dev", "/app/gestor");
    await manager.getByRole("button", { name: "Estoque", exact: true }).click();
    const card = manager.locator("section").filter({ has: manager.getByRole("heading", { name, exact: true }) });
    await expect(card.getByLabel(`Saldo de ${name}`)).toContainText("2");
    await card.getByRole("button", { name: "Repor", exact: true }).click();
    await card.getByLabel("Quantidade recebida").fill("3");
    await card.getByRole("button", { name: "Confirmar reposição", exact: true }).click();
    await expect(card.getByLabel(`Saldo de ${name}`)).toContainText("5");
    const { data: movements } = await admin
      .from("stock_movements")
      .select("kind,quantity,balance_after")
      .eq("menu_item_id", itemId)
      .order("id");
    expect(movements!.map((m) => `${m.kind}:${m.quantity}:${m.balance_after}`)).toEqual([
      "venda:-1:1",
      "venda:-1:0",
      "cancelamento:1:1",
      "cancelamento:1:2",
      "entrada:3:5",
    ]);
    const { data: log } = await admin
      .from("audit_log")
      .select("action,actor_role")
      .eq("restaurant_id", BRASA)
      .eq("tab_id", tabId)
      .in("action", ["item_cancelado", "pedido_cancelado"]);
    expect(log!.length).toBe(3);
    expect(log!.some((l) => l.actor_role === "customer")).toBe(true);
    expect(log!.some((l) => l.actor_role === "waiter")).toBe(true);
  } finally {
    await Promise.allSettled([customerContext.close(), waiterContext.close(), managerContext.close()]);
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
    if (itemId) await admin.from("menu_items").delete().eq("id", itemId);
    if (categoryId) await admin.from("categories").delete().eq("id", categoryId);
  }
});
