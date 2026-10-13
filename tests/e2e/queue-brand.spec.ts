import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("marca isolada em dois restaurantes e fila com três regras, limite e fixação", async ({
  page,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const email = `fila-${stamp}@comanda.dev`,
    password = `Fila-${stamp}-segura!`;
  const restaurantIds: string[] = [];
  let resellerId = "",
    userId = "";
  const checked = <T>(result: { data: T; error: unknown }): NonNullable<T> => {
    if (result.error || !result.data)
      throw result.error ?? new Error("Dado ausente");
    return result.data;
  };
  try {
    const user = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (user.error || !user.data.user) throw user.error ?? new Error("Usuário ausente");
    userId = user.data.user.id;
    const reseller = checked(
      await admin
        .from("resellers")
        .insert({
          name: "Revenda QA",
          brand_name: "Marca inicial",
          primary_color: "#E0552B",
        })
        .select("id")
        .single(),
    );
    resellerId = reseller.id;
    const membership = await admin
      .from("reseller_members")
      .insert({ user_id: userId, reseller_id: resellerId });
    if (membership.error) throw membership.error;
    for (const suffix of ["a", "b"]) {
      const restaurant = checked(
        await admin
          .from("restaurants")
          .insert({
            reseller_id: resellerId,
            name: `Fila ${suffix}`,
            slug: `fila-${stamp}-${suffix}`,
          })
          .select("id")
          .single(),
      );
      restaurantIds.push(restaurant.id);
    }
    const member = await admin
      .from("restaurant_members")
      .insert({
        user_id: userId,
        restaurant_id: restaurantIds[0],
        role: "manager",
      });
    if (member.error) throw member.error;
    const tables = checked(
      await admin
        .from("tables")
        .insert(
          restaurantIds.flatMap((restaurant_id, i) =>
            (i === 0 ? ["Antigo", "Complexo", "Recente"] : ["Outra"]).map(
              (label) => ({ restaurant_id, label }),
            ),
          ),
        )
        .select("id,label,restaurant_id,qr_token"),
    );
    const tabs = checked(
      await admin
        .from("tabs")
        .insert(
          tables
            .filter((t) => t.restaurant_id === restaurantIds[0])
            .map((t, i) => ({
              table_id: t.id,
              restaurant_id: t.restaurant_id,
              pin: `100${i}`,
            })),
        )
        .select("id,table_id"),
    );
    for (const [index, label] of ["Antigo", "Complexo", "Recente"].entries()) {
      const table = tables.find((t) => t.label === label)!;
      const order = checked(
        await admin
          .from("orders")
          .insert({
            restaurant_id: restaurantIds[0],
            tab_id: tabs.find((t) => t.table_id === table.id)!.id,
            prep_minutes: [2, 30, 1][index],
            total_cents: 1000,
            created_at: new Date(
              stamp - [12, 3, 1][index] * 60_000,
            ).toISOString(),
          })
          .select("id")
          .single(),
      );
      const item = await admin
        .from("order_items")
        .insert({
          order_id: order.id,
          name_snapshot: `Prato ${label}`,
          quantity: 1,
          unit_price_cents: 1000,
          note: "Sem cebola",
        });
      if (item.error) throw item.error;
    }
    await page.goto("/app/login");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/revenda");
    await page.getByRole("button", { name: "Marca", exact: true }).click();
    await page
      .getByLabel("Nome do produto", { exact: true })
      .fill("Marca de teste");
    await page.getByLabel("Cor principal", { exact: true }).fill("#2357a4");
    await page
      .getByRole("button", { name: "Salvar marca", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Alterações salvas");
    for (const [index, restaurantId] of restaurantIds.entries()) {
      const table = tables.find((t) => t.restaurant_id === restaurantId)!;
      const response = await page.request.get(
        `/api/menu/fila-${stamp}-${["a", "b"][index]}/${table.qr_token}`,
      );
      expect(response.status()).toBe(200);
      const menu = await response.json();
      expect(menu.restaurant.resellers.brand_name).toBe("Marca de teste");
      expect(menu.restaurant.resellers.primary_color).toBe("#2357a4");
    }
    const settings = async (mode: string, max = 60) => {
      const response = await page.request.post(
        `/api/manage/${restaurantIds[0]}`,
        {
          headers: { Origin: new URL(page.url()).origin },
          data: {
            action: "settings",
            data: {
              mode,
              weight_wait: 1,
              weight_complexity: 1,
              max_wait_minutes: max,
            },
          },
        },
      );
      expect(response.status()).toBe(200);
      await page.goto("/app/cozinha");
      await expect(page.getByRole("article")).toHaveCount(3);
    };
    const first = () => page.getByRole("article").first().getByRole("heading", { level: 2 });
    await settings("fifo");
    await expect(first()).toHaveAccessibleName("Mesa Antigo");
    await settings("complexity");
    await expect(first()).toHaveAccessibleName("Mesa Complexo");
    await settings("balanced");
    await expect(first()).toHaveAccessibleName("Mesa Complexo");
    await settings("complexity", 10);
    await expect(first()).toHaveAccessibleName("Mesa Antigo");
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: "Mesa Recente", exact: true }),
      })
      .getByRole("button", { name: "Fixar pedido", exact: true })
      .click();
    await expect(first()).toHaveAccessibleName("Mesa Recente");
    await expect(page.getByText("Atrasado", { exact: true })).toBeVisible();
    await page.screenshot({ path: "tmp/qa-cozinha.png", fullPage: true });
  } finally {
    if (restaurantIds.length) {
      const r = await admin
        .from("restaurants")
        .delete()
        .in("id", restaurantIds);
      if (r.error) throw r.error;
    }
    if (resellerId) {
      const r = await admin.from("resellers").delete().eq("id", resellerId);
      if (r.error) throw r.error;
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
