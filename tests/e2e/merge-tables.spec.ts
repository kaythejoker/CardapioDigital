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

test("garçom une duas mesas: pedidos passam para uma comanda, QR de qualquer mesa funciona e separar libera", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const labelA = `E2E-uniao-A-${stamp}`;
  const labelB = `E2E-uniao-B-${stamp}`;
  const origin = await customerOrigin();
  const waiterContext = await browser.newContext();
  const customerA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customerB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tableIds: string[] = [];
  try {
    const { data: tables, error } = await admin
      .from("tables")
      .insert([{ restaurant_id: BRASA, label: labelA }, { restaurant_id: BRASA, label: labelB }])
      .select("id,label,qr_token");
    if (error) throw error;
    tableIds.push(...tables!.map((t) => t.id));
    const A = tables!.find((t) => t.label === labelA)!;
    const B = tables!.find((t) => t.label === labelB)!;
    const openTab = async (tableId: string) => {
      for (let i = 0; i < 30; i++) {
        const pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        const r = await admin.from("tabs").insert({ restaurant_id: BRASA, table_id: tableId, pin }).select("id,pin").single();
        if (!r.error) return r.data;
      }
      throw new Error("sem PIN livre");
    };
    const tabA = await openTab(A.id);
    const tabB = await openTab(B.id);
    const { data: item } = await admin
      .from("menu_items")
      .select("id,name,modifier_groups(id)")
      .eq("restaurant_id", BRASA)
      .eq("active", true)
      .eq("sold_out", false)
      .eq("stock_enabled", false);
    const simple = item!.find((i) => i.modifier_groups.length === 0)!;
    const post = (ctx: typeof customerA, table: typeof A, data: unknown) =>
      ctx.request.post(`${origin}/api/customer/brasa-bistro/${table.qr_token}`, { headers: { Origin: origin }, data });
    expect((await post(customerA, A, { action: "pin", pin: tabA.pin, name: "Ana" })).status()).toBe(200);
    expect((await post(customerB, B, { action: "pin", pin: tabB.pin, name: "Ana" })).status()).toBe(200);
    expect((await post(customerA, A, { action: "order", request_id: crypto.randomUUID(), items: [{ item_id: simple.id, quantity: 1, note: "da A", modifier_ids: [] }] })).status()).toBe(201);
    expect((await post(customerB, B, { action: "order", request_id: crypto.randomUUID(), items: [{ item_id: simple.id, quantity: 2, note: "da B", modifier_ids: [] }] })).status()).toBe(201);
    // Garçom une a comanda da mesa B à da mesa A.
    const waiter = await waiterContext.newPage();
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await expect(waiter.getByText("Ao vivo", { exact: false })).toBeVisible();
    const cardA = waiter.getByRole("button").filter({ has: waiter.getByRole("heading", { name: labelA, exact: true }) });
    await cardA.click();
    await waiter.getByRole("button", { name: "Unir mesa", exact: true }).click();
    await waiter.getByRole("button", { name: `Unir comanda da mesa ${labelB}`, exact: true }).click();
    await expect(waiter.getByRole("heading", { name: `Mesas ${labelA} + ${labelB}`, exact: true })).toBeVisible();
    await waiter.getByRole("button", { name: "Ver pedidos", exact: true }).click();
    await expect(waiter.getByText("da B", { exact: false })).toBeVisible();
    // Pessoa com o mesmo nome ganha o nome da mesa; B perdeu a sessão; o QR de B abre a comanda de A com o PIN de A.
    await expect(waiter.getByText(`Ana (mesa ${labelB})`, { exact: true })).toBeVisible();
    expect((await customerB.request.get(`${origin}/api/customer/brasa-bistro/${B.qr_token}`)).status()).toBe(401);
    expect((await post(customerB, B, { action: "pin", pin: tabB.pin, name: "Bia" })).status()).toBe(401);
    expect((await post(customerB, B, { action: "pin", pin: tabA.pin, name: "Bia" })).status()).toBe(200);
    const merged = await (await customerB.request.get(`${origin}/api/customer/brasa-bistro/${B.qr_token}`)).json();
    expect(merged.orders.length).toBe(2);
    expect(merged.guests.map((g: { name: string }) => g.name).toSorted()).toEqual(["Ana", `Ana (mesa ${labelB})`, "Bia"]);
    const { data: tabs } = await admin.from("tabs").select("id,status,merged_into").in("id", [tabA.id, tabB.id]);
    expect(tabs!.find((t) => t.id === tabB.id)).toMatchObject({ status: "closed", merged_into: tabA.id });
    // Mesa B aparece unida no mapa e pode ser separada.
    await waiter.getByRole("button", { name: "Fechar detalhe da mesa" }).click();
    const cardB = waiter.getByRole("button").filter({ has: waiter.getByRole("heading", { name: labelB, exact: true }) });
    await expect(cardB).toContainText("Unida à mesa");
    await cardA.click();
    await waiter.getByRole("button", { name: `Separar mesa ${labelB}`, exact: true }).click();
    await expect(waiter.getByRole("heading", { name: `Mesa ${labelA}`, exact: true })).toBeVisible();
    await waiter.getByRole("button", { name: "Fechar detalhe da mesa" }).click();
    await expect(cardB).toContainText("Livre");
    expect((await customerB.request.get(`${origin}/api/customer/brasa-bistro/${B.qr_token}`)).status()).toBe(401);
    const { data: log } = await admin
      .from("audit_log")
      .select("action,actor_role")
      .eq("tab_id", tabA.id)
      .in("action", ["mesa_unida", "comandas_unidas", "mesa_separada"]);
    expect(log!.map((l) => l.action).toSorted()).toEqual(["comandas_unidas", "mesa_separada", "mesa_unida"]);
    expect(log!.every((l) => l.actor_role === "waiter")).toBe(true);
  } finally {
    await Promise.allSettled([waiterContext.close(), customerA.close(), customerB.close()]);
    if (tableIds.length) await admin.from("tables").delete().in("id", tableIds);
  }
});
