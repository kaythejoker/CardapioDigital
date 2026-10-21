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

test("comanda fechada vira pesquisa no celular; gestor vê histórico, relatórios, CSV e satisfação", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const label = `E2E-hist-${stamp}`;
  const origin = await customerOrigin();
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const waiterContext = await browser.newContext();
  let tableId = "";
  const { data: before } = await admin.from("restaurants").select("google_review_url,survey_enabled").eq("id", BRASA).single();
  try {
    await admin.from("restaurants").update({ google_review_url: "https://g.page/r/brasa-e2e", survey_enabled: true }).eq("id", BRASA);
    const { data: table, error } = await admin.from("tables").insert({ restaurant_id: BRASA, label }).select("id,qr_token").single();
    if (error) throw error;
    tableId = table.id;
    let tab: { id: string; pin: string } | null = null;
    for (let i = 0; i < 30 && !tab; i++) {
      const pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const r = await admin.from("tabs").insert({ restaurant_id: BRASA, table_id: tableId, pin }).select("id,pin").single();
      if (!r.error) tab = r.data;
    }
    const { data: items } = await admin.from("menu_items").select("id,price_cents,modifier_groups(id)").eq("restaurant_id", BRASA).eq("active", true).eq("sold_out", false).eq("stock_enabled", false);
    const item = items!.find((i) => i.modifier_groups.length === 0)!;
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    const post = (data: unknown) => customerContext.request.post(endpoint, { headers: { Origin: origin }, data });
    expect((await post({ action: "pin", pin: tab!.pin, name: "Lia E2E" })).status()).toBe(200);
    expect((await post({ action: "order", request_id: crypto.randomUUID(), items: [{ item_id: item.id, quantity: 1, note: "", modifier_ids: [] }] })).status()).toBe(201);
    // Paga e fecha pelo servidor (o garçom já é coberto pela E2E do financeiro).
    await admin.from("payments").insert({ restaurant_id: BRASA, tab_id: tab!.id, method: "pix", amount_cents: item.price_cents });
    const start = Date.now();
    await admin.from("tabs").update({ status: "closed" }).eq("id", tab!.id);
    // Celular: sessão caiu, mas a pesquisa aparece.
    expect((await customerContext.request.get(endpoint)).status()).toBe(401);
    expect((await post({ action: "order", request_id: crypto.randomUUID(), items: [{ item_id: item.id, quantity: 1, note: "", modifier_ids: [] }] })).status()).toBe(401);
    const customer = await customerContext.newPage();
    await customer.goto(`/brasa-bistro/m/${table.qr_token}`);
    const survey = customer.getByLabel("Pesquisa de satisfação");
    await expect(survey).toBeVisible({ timeout: 10_000 });
    console.log(`Pesquisa visível ${Date.now() - start}ms depois de fechar`);
    await expect(survey).toContainText("Lia E2E");
    await survey.getByRole("radiogroup", { name: "Nota geral" }).getByRole("radio", { name: "5 estrelas" }).click();
    await survey.getByRole("radiogroup", { name: "Comida" }).getByRole("radio", { name: "4 estrelas" }).click();
    await survey.getByRole("button", { name: "Rápido", exact: true }).click();
    await survey.getByLabel("Comentário").fill("Tudo ótimo, voltaremos!");
    await survey.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(customer.getByRole("status")).toContainText("Que bom!");
    await expect(customer.getByRole("link", { name: "Avaliar no Google" })).toHaveAttribute("href", "https://g.page/r/brasa-e2e");
    const { data: saved } = await admin.from("surveys").select("rating,food_rating,tags,comment").eq("tab_id", tab!.id).single();
    expect(saved).toEqual({ rating: 5, food_rating: 4, tags: ["Rápido"], comment: "Tudo ótimo, voltaremos!" });
    // Segunda resposta da mesma pessoa é recusada.
    expect((await post({ action: "survey", rating: 3 })).status()).toBe(409);
    // Gestor: histórico com a comanda, detalhe, relatórios com o item, CSV com acentos e satisfação com o comentário.
    const manager = await managerContext.newPage();
    await login(manager, "gestor@brasa.dev", "/app/gestor");
    await manager.getByRole("button", { name: "Histórico", exact: true }).click();
    const row = manager.getByRole("row").filter({ hasText: label });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Ver comanda da mesa ${label}` }).click();
    const detail = manager.getByRole("region", { name: `Comanda da mesa ${label}` });
    await expect(detail).toContainText("Lia E2E");
    await expect(detail).toContainText("Pix");
    await expect(detail).toContainText("Comanda fechada");
    await expect(detail).toContainText("★★★★★");
    await manager.getByRole("button", { name: "Operações", exact: true }).click();
    await expect(manager.getByRole("row").filter({ hasText: "Avaliação enviada" }).first()).toBeVisible();
    await manager.getByRole("button", { name: "Relatórios", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "Por item" })).toBeVisible();
    const csvHref = await manager.getByRole("link", { name: "Exportar CSV de Por mesa" }).getAttribute("href");
    const csv = await manager.request.get(csvHref!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Mesa;Comandas;Valor (R$)");
    expect(text).toContain(`${label};1;${(item.price_cents / 100).toFixed(2).replace(".", ",")}`);
    await manager.getByRole("button", { name: "Satisfação", exact: true }).click();
    await expect(manager.getByText("Tudo ótimo, voltaremos!")).toBeVisible();
    await expect(manager.getByText("Nota geral")).toBeVisible();
    // Garçom vê as comandas fechadas de hoje, somente leitura.
    const waiter = await waiterContext.newPage();
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await waiter.getByRole("button", { name: "Comandas fechadas hoje", exact: true }).click();
    await waiter.getByRole("button", { name: `Ver comanda fechada da mesa ${label}` }).click();
    await expect(waiter.getByRole("region", { name: `Comanda da mesa ${label}` })).toContainText("Lia E2E");
    const forbidden = await waiter.request.get(`/api/reports/${BRASA}?period=7d`);
    expect(forbidden.status()).toBe(403);
  } finally {
    await Promise.allSettled([customerContext.close(), managerContext.close(), waiterContext.close()]);
    await admin.from("restaurants").update({ google_review_url: before?.google_review_url ?? null, survey_enabled: before?.survey_enabled ?? true }).eq("id", BRASA);
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
  }
});
