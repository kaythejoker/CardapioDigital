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

test("prato vai para a cozinha, bebida para o bar e o cliente vê um pedido com status por setor", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const label = `E2E-bar-${stamp}`;
  const drink = `Drinque E2E ${stamp}`;
  const dish = `Prato E2E ${stamp}`;
  const origin = await customerOrigin();
  let tableId = "";
  let categoryId = "";
  const kitchenContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const barContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const { data: table, error } = await admin
      .from("tables")
      .insert({ restaurant_id: BRASA, label })
      .select("id,qr_token")
      .single();
    if (error) throw error;
    tableId = table.id;
    const { data: category } = await admin
      .from("categories")
      .insert({ restaurant_id: BRASA, name: `Bar E2E ${stamp}`, position: 102, station: "bar" })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: items } = await admin
      .from("menu_items")
      .insert([
        { restaurant_id: BRASA, category_id: categoryId, name: drink, price_cents: 2000, prep_minutes: 3 },
        // Item do bar que sobrescreve o setor: vai para a cozinha.
        { restaurant_id: BRASA, category_id: categoryId, name: dish, price_cents: 5000, prep_minutes: 20, station: "cozinha" },
      ])
      .select("id,name");
    const drinkId = items!.find((i) => i.name === drink)!.id;
    const dishId = items!.find((i) => i.name === dish)!.id;
    let pin = "";
    for (let i = 0; i < 30; i++) {
      pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const result = await admin
        .from("tabs")
        .insert({ restaurant_id: BRASA, table_id: tableId, pin })
        .select("id")
        .single();
      if (!result.error) break;
    }
    const kitchen = await kitchenContext.newPage();
    const bar = await barContext.newPage();
    await login(kitchen, "cozinha@brasa.dev", "/app/cozinha");
    await expect(kitchen.getByText("Ao vivo", { exact: false })).toBeVisible();
    // O gestor abre o painel do bar (cozinha e bar são o mesmo KDS filtrado).
    await login(bar, "gestor@brasa.dev", "/app/bar");
    await expect(bar.getByRole("heading", { name: /^Bar • / })).toBeVisible();
    await expect(bar.getByText("Ao vivo", { exact: false })).toBeVisible();
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    const post = (data: unknown) =>
      customerContext.request.post(endpoint, { headers: { Origin: origin }, data });
    expect((await post({ action: "pin", pin, name: "Fê E2E" })).status()).toBe(200);
    const response = await post({
      action: "order",
      request_id: crypto.randomUUID(),
      items: [
        { item_id: dishId, quantity: 1, note: "", modifier_ids: [] },
        { item_id: drinkId, quantity: 2, note: "sem açúcar", modifier_ids: [] },
      ],
    });
    expect(response.status()).toBe(201);
    const sent = await response.json();
    expect(sent.orders.map((o: { station: string }) => o.station).toSorted()).toEqual(["bar", "cozinha"]);
    expect(sent.total_cents).toBe(9000);
    const kitchenCard = kitchen.getByRole("article").filter({ has: kitchen.getByRole("heading", { name: `Mesa ${label}`, exact: true }) });
    const barCard = bar.getByRole("article").filter({ has: bar.getByRole("heading", { name: `Mesa ${label}`, exact: true }) });
    await expect(kitchenCard).toBeVisible({ timeout: 3000 });
    await expect(barCard).toBeVisible({ timeout: 3000 });
    await expect(kitchenCard).toContainText(dish);
    await expect(kitchenCard).not.toContainText(drink);
    await expect(barCard).toContainText(drink);
    await expect(barCard).not.toContainText(dish);
    // Esgotados do bar só mostram itens do bar.
    await bar.getByRole("button", { name: "Esgotados", exact: true }).click();
    await expect(bar.getByText(drink, { exact: true })).toBeVisible();
    await expect(bar.getByText(dish, { exact: true })).toHaveCount(0);
    await bar.getByRole("button", { name: /^Fila/ }).click();
    // Bar inicia e finaliza; cozinha ainda não começou.
    await barCard.getByRole("button", { name: "Iniciar", exact: true }).click();
    await barCard.getByRole("button", { name: "Pronto", exact: true }).click();
    const customer = await customerContext.newPage();
    await customer.goto(`/brasa-bistro/m/${table.qr_token}`);
    await customer.getByRole("button", { name: "Minha comanda", exact: true }).click();
    await expect(customer.getByRole("heading", { name: "Pedido em andamento" })).toHaveCount(1);
    await expect(customer.getByLabel("Status por setor")).toContainText("Cozinha: Recebido");
    await expect(customer.getByLabel("Status por setor")).toContainText("Bar: Pronto");
    await expect(customer.getByRole("article").getByText("R$ 90,00", { exact: true })).toBeVisible();
    const { data: orders } = await admin.from("orders").select("station,status,batch_id").eq("tab_id", (await admin.from("tabs").select("id").eq("table_id", tableId).single()).data!.id);
    expect(orders!.length).toBe(2);
    expect(new Set(orders!.map((o) => o.batch_id)).size).toBe(1);
    expect(orders!.find((o) => o.station === "bar")!.status).toBe("pronto");
    expect(orders!.find((o) => o.station === "cozinha")!.status).toBe("recebido");
  } finally {
    await Promise.allSettled([kitchenContext.close(), barContext.close(), customerContext.close()]);
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
    if (categoryId) await admin.from("categories").delete().eq("id", categoryId);
  }
});
