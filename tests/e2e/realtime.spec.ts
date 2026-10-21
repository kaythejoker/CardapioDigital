import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerOrigin } from "./helpers";

const BRASA = "20000000-0000-4000-8000-000000000001";

/**
 * Etapa 10 (spec-fase2.md, seção 14): a comanda aberta em outro celular da
 * mesma mesa atualiza em até 3 s quando alguém pede ou cancela; a consulta
 * pausa com a aba em segundo plano e volta na hora.
 */
test("comanda compartilhada atualiza em até 3 s e pausa em segundo plano", async ({ browser }) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const origin = await customerOrigin();
  const phoneA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phoneB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let tableId = "";
  try {
    const { data: table, error } = await admin
      .from("tables")
      .insert({ restaurant_id: BRASA, label: `E2E-tempo-real-${stamp}` })
      .select("id,qr_token")
      .single();
    if (error) throw error;
    tableId = table.id;
    let pin = "";
    for (let i = 0; i < 30; i++) {
      pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const result = await admin.from("tabs").insert({ restaurant_id: BRASA, table_id: tableId, pin });
      if (!result.error) break;
    }
    const endpoint = `${origin}/api/customer/brasa-bistro/${table.qr_token}`;
    // Um item simples do cardápio público: sem adicionais obrigatórios, sem estoque, disponível.
    const menu = await (await phoneA.request.get(`${origin}/api/menu/brasa-bistro/${table.qr_token}`)).json();
    const item = (menu.items as { id: string; name: string; sold_out: boolean; stock_left?: number | null; modifier_groups: { required: boolean; min_select: number }[] }[]).find(
      (i) => !i.sold_out && i.stock_left == null && i.modifier_groups.every((g) => !g.required && g.min_select === 0),
    );
    expect(item).toBeTruthy();
    const postAs = (ctx: typeof phoneA, data: unknown) =>
      ctx.request.post(endpoint, { headers: { Origin: origin }, data });
    expect((await postAs(phoneA, { action: "pin", pin, name: "Ana E2E" })).status()).toBe(200);
    expect((await postAs(phoneB, { action: "pin", pin, name: "Bia E2E" })).status()).toBe(200);
    const order = (quantity: number) =>
      postAs(phoneA, {
        action: "order",
        request_id: crypto.randomUUID(),
        items: Array.from({ length: quantity }, (_, i) => ({ item_id: item!.id, quantity: 1, note: `pedido ${i + 1}`, modifier_ids: [] })),
      });
    expect((await order(2)).status()).toBe(201);

    // Bia abre a comanda e vê o pedido da Ana com o rodapé de atualização.
    const bia = await phoneB.newPage();
    await bia.goto(`/brasa-bistro/m/${table.qr_token}`);
    await bia.getByRole("button", { name: "Minha comanda", exact: true }).click();
    await expect(bia.getByRole("heading", { name: "Comanda da mesa", exact: true })).toBeVisible();
    await expect(bia.getByText("Ana E2E")).toBeVisible();
    await expect(bia.getByRole("status", { name: "Atualização da comanda" })).toHaveText("Atualizado agora");

    // Ana cancela um item no celular dela: Bia vê em até 3 s.
    const ana = await phoneA.newPage();
    await ana.goto(`/brasa-bistro/m/${table.qr_token}`);
    await ana.getByRole("button", { name: "Minha comanda", exact: true }).click();
    const cancelled = ana.waitForResponse((r) => r.url().includes(endpoint) && r.request().method() === "POST");
    await ana.getByRole("button", { name: `Cancelar item ${item!.name}` }).first().click();
    expect((await cancelled).status()).toBe(200);
    const started = Date.now();
    await expect(bia.getByText("Cancelado", { exact: true })).toBeVisible({ timeout: 4_000 });
    expect(Date.now() - started).toBeLessThan(4_000);

    // Ana pede de novo (outro pedido): Bia vê o segundo pedido em até 3 s.
    await expect(bia.getByRole("article")).toHaveCount(1);
    expect((await order(1)).status()).toBe(201);
    const again = Date.now();
    await expect(bia.getByRole("article")).toHaveCount(2, { timeout: 4_000 });
    expect(Date.now() - again).toBeLessThan(4_000);

    // Em segundo plano a consulta para; ao voltar, atualiza na hora.
    const hits = { count: 0 };
    bia.on("request", (r) => {
      if (r.method() === "GET" && r.url().includes(endpoint)) hits.count += 1;
    });
    await bia.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await bia.waitForTimeout(7_000);
    expect(hits.count).toBe(0);
    await bia.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => hits.count, { timeout: 2_000 }).toBeGreaterThan(0);
  } finally {
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
    await phoneA.close();
    await phoneB.close();
  }
});
