import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BRASA = "20000000-0000-4000-8000-000000000001";
test("PIN, idempotência, snapshot, adicionais, esgotado e comanda fechada via API", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const wrong = await browser.newContext();
  const correct = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const customer = await correct.newPage();
  const name = `Item segurança ${Date.now()}`;
  let tableId = "";
  let itemId = "";
  let categoryId = "";
  const origin = process.env.QA_BASE_URL || "http://localhost:3000";
  try {
    const { data: table, error } = await admin
      .from("tables")
      .insert({ restaurant_id: BRASA, label: `E2E-security-${Date.now()}` })
      .select("id,qr_token")
      .single();
    if (error) throw error;
    tableId = table.id;
    const { data: category } = await admin
      .from("categories")
      .insert({
        restaurant_id: BRASA,
        name: "Categoria de teste",
        position: 100,
      })
      .select("id")
      .single();
    categoryId = category!.id;
    const { data: item } = await admin
      .from("menu_items")
      .insert({
        restaurant_id: BRASA,
        category_id: categoryId,
        name,
        price_cents: 4290,
        prep_minutes: 12,
      })
      .select("id")
      .single();
    itemId = item!.id;
    const { data: group } = await admin
      .from("modifier_groups")
      .insert({
        menu_item_id: itemId,
        name: "Ponto",
        required: true,
        min_select: 1,
        max_select: 1,
      })
      .select("id")
      .single();
    const { data: modifier } = await admin
      .from("modifiers")
      .insert({ group_id: group!.id, name: "Ao ponto", price_cents: 200 })
      .select("id")
      .single();
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
    const endpoint = `/api/customer/brasa-bistro/${table.qr_token}`;
    const post = (context: typeof correct, data: unknown) =>
      context.request.post(endpoint, { headers: { Origin: origin }, data });
    const lines = [
      {
        item_id: itemId,
        quantity: 2,
        note: "Sem sal",
        modifier_ids: [modifier!.id],
        price_cents: 1,
      },
    ];
    expect(
      (
        await post(wrong, {
          action: "order",
          request_id: crypto.randomUUID(),
          items: lines,
        })
      ).status(),
    ).toBe(401);
    const wrongPin = pin === "9999" ? "9998" : "9999";
    for (let i = 0; i < 5; i++)
      expect(
        (await post(wrong, { action: "pin", pin: wrongPin })).status(),
      ).toBe(i === 4 ? 429 : 401);
    expect((await post(wrong, { action: "pin", pin })).status()).toBe(429);
    expect((await post(correct, { action: "pin", pin })).status()).toBe(200);
    expect(
      (
        await post(correct, {
          action: "order",
          request_id: crypto.randomUUID(),
          items: [{ ...lines[0], modifier_ids: [] }],
        })
      ).status(),
    ).toBe(409);
    const requestId = crypto.randomUUID();
    const response = await post(correct, {
      action: "order",
      request_id: requestId,
      items: lines,
    });
    expect(response.status()).toBe(201);
    const order = await response.json();
    expect(order.total_cents).toBe(8980);
    expect(order.prep_minutes).toBe(12);
    const retry = await post(correct, {
      action: "order",
      request_id: requestId,
      items: lines,
    });
    expect((await retry.json()).id).toBe(order.id);
    await admin
      .from("menu_items")
      .update({ name: `${name} alterado`, price_cents: 1 })
      .eq("id", itemId);
    const tabResponse = await correct.request.get(endpoint);
    const snapshot = await tabResponse.json();
    expect(snapshot.orders[0].order_items[0].name_snapshot).toBe(name);
    expect(snapshot.total_cents).toBe(8980);
    await admin
      .from("tabs")
      .update({ pin: pin === "0000" ? "0001" : "0000" })
      .eq("id", tabId);
    expect((await correct.request.get(endpoint)).status()).toBe(200);
    await customer.goto(`/brasa-bistro/m/${table.qr_token}`);
    const itemButton = customer
      .getByRole("button")
      .filter({
        has: customer.getByRole("heading", {
          name: `${name} alterado`,
          exact: true,
        }),
      });
    await expect(itemButton).toBeVisible();
    const start = Date.now();
    await admin.from("menu_items").update({ sold_out: true }).eq("id", itemId);
    await expect(itemButton).not.toBeVisible({ timeout: 10_000 });
    console.log(`Item esgotado sumiu em ${Date.now() - start}ms`);
    expect(
      (
        await post(correct, {
          action: "order",
          request_id: crypto.randomUUID(),
          items: lines,
        })
      ).status(),
    ).toBe(409);
    expect(
      (await post(correct, { action: "cancel", order_id: order.id })).status(),
    ).toBe(200);
    await admin.from("tabs").update({ status: "closed" }).eq("id", tabId);
    expect((await correct.request.get(endpoint)).status()).toBe(401);
    expect(
      (
        await post(correct, {
          action: "order",
          request_id: crypto.randomUUID(),
          items: lines,
        })
      ).status(),
    ).toBe(401);
  } finally {
    await Promise.allSettled([wrong.close(), correct.close()]);
    if (tableId) await admin.from("tables").delete().eq("id", tableId);
    if (itemId) await admin.from("menu_items").delete().eq("id", itemId);
    if (categoryId)
      await admin.from("categories").delete().eq("id", categoryId);
  }
});
