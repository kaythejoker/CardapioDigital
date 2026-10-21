import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerOrigin } from "./helpers";

const BRASA = "20000000-0000-4000-8000-000000000001";
const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
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

test("pedido completo, Realtime e revogação de sessão", async ({ browser }) => {
  const admin = db();
  const label = `E2E-${Date.now()}`;
  const { data: table, error } = await admin
    .from("tables")
    .insert({ restaurant_id: BRASA, label })
    .select("id,qr_token")
    .single();
  if (error) throw error;
  const waiterContext = await browser.newContext();
  const kitchenContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const waiter = await waiterContext.newPage();
  const kitchen = await kitchenContext.newPage();
  const customer = await customerContext.newPage();
  kitchen.on("console", (message) => {
    if (message.type() === "error") console.log("Cozinha: " + message.text());
  });
  kitchen.on("websocket", (socket) => {
    if (socket.url().includes("supabase"))
      socket.on("framereceived", (frame) => {
        if (typeof frame.payload !== "string") return;
        const message = JSON.parse(frame.payload);
        const event = Array.isArray(message) ? message[3] : message.event;
        const payload = Array.isArray(message) ? message[4] : message.payload;
        console.log(
          "Realtime: " +
            event +
            " " +
            JSON.stringify(
              event === "phx_reply" || event === "system"
                ? payload
                : { type: payload?.data?.type },
            ),
        );
      });
  });
  try {
    await login(waiter, "garcom@brasa.dev", "/app/garcom");
    await waiter
      .getByRole("button")
      .filter({
        has: waiter.getByRole("heading", { name: label, exact: true }),
      })
      .click();
    await waiter
      .getByRole("button", { name: "Abrir mesa", exact: true })
      .click();
    await expect(
      waiter.getByText("Código da mesa", { exact: true }),
    ).toBeVisible();
    const { data: tab } = await admin
      .from("tabs")
      .select("id,pin")
      .eq("table_id", table.id)
      .eq("status", "open")
      .single();
    expect(tab).toBeTruthy();
    await login(kitchen, "cozinha@brasa.dev", "/app/cozinha");
    await expect(kitchen.getByText("Ao vivo", { exact: false })).toBeVisible();
    const url = `/brasa-bistro/m/${table.qr_token}`;
    await customer.goto(url);
    await expect(
      customer.getByRole("heading", { name: "Brasa Bistrô", exact: true }),
    ).toBeVisible();
    const { data: items } = await admin
      .from("menu_items")
      .select("id,name,modifier_groups(id)")
      .eq("restaurant_id", BRASA)
      .eq("active", true)
      .eq("sold_out", false);
    const item = items!.find((i) => i.modifier_groups.length === 0)!;
    await customer
      .getByRole("button")
      .filter({
        has: customer.getByRole("heading", { name: item.name, exact: true }),
      })
      .first()
      .click();
    await customer.getByRole("button", { name: /^Adicionar •/ }).click();
    await customer.getByLabel("Seu nome").fill("Ana E2E");
    await customer.getByLabel("Código de 4 dígitos").fill(tab!.pin);
    await customer
      .getByRole("button", { name: "Confirmar código", exact: true })
      .click();
    await expect(
      customer.getByRole("heading", { name: "Seu pedido" }),
    ).toBeVisible();
    const start = Date.now();
    await customer
      .getByRole("button", { name: "Enviar pedido", exact: true })
      .click();
    await expect(
      customer.getByRole("heading", { name: "Pedido enviado!" }),
    ).toBeVisible();
    const card = kitchen
      .getByRole("article")
      .filter({
        has: kitchen.getByRole("heading", {
          name: `Mesa ${label}`,
          exact: true,
        }),
      });
    await expect(card).toBeVisible({ timeout: 3000 });
    console.log(
      `Pedido visível na cozinha em ${Date.now() - start}ms (inclui resposta de envio)`,
    );
    await card.getByRole("button", { name: "Iniciar", exact: true }).click();
    await card.getByRole("button", { name: "Pronto", exact: true }).click();
    await expect(
      waiter.getByRole("button", { name: "Marcar entregue", exact: true }),
    ).toBeVisible();
    await waiter
      .getByRole("button", { name: "Marcar entregue", exact: true })
      .click();
    await customer
      .getByRole("button", { name: "Acompanhar minha comanda", exact: true })
      .click();
    await expect(customer.getByText("Entregue", { exact: true })).toBeVisible();
    await expect(
      customer.getByRole("heading", { name: "Você • Ana E2E", exact: true }),
    ).toBeVisible();
    await waiter
      .getByRole("button", { name: "Registrar pagamento de Ana E2E", exact: true })
      .click();
    await waiter.getByLabel("Forma de pagamento").selectOption("pix");
    await waiter
      .getByRole("button", { name: "Confirmar pagamento", exact: true })
      .click();
    await expect(waiter.getByText("Quitado", { exact: true })).toBeVisible();
    await expect(waiter.getByRole("button", { name: /Desfazer pagamento de/ })).toBeVisible();
    await waiter
      .getByRole("button", { name: "Fechar comanda", exact: true })
      .click();
    await waiter
      .getByRole("button", { name: "Confirmar fechamento", exact: true })
      .click();
    // O fechamento é assíncrono: espera a comanda constar como fechada antes de testar a revogação.
    await expect
      .poll(async () => (await admin.from("tabs").select("status").eq("id", tab!.id).single()).data?.status, { timeout: 10_000 })
      .toBe("closed");
    const response = await customer.request.get(
      `${await customerOrigin()}/api/customer/brasa-bistro/${table.qr_token}`,
    );
    expect(response.status()).toBe(401);
    await customer.goto(url);
    await expect(
      customer.getByText("Chame o garçom para abrir a mesa", { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.allSettled([
      waiterContext.close(),
      kitchenContext.close(),
      customerContext.close(),
    ]);
    const cleanup = await admin.from("tables").delete().eq("id", table.id);
    if (cleanup.error) throw cleanup.error;
  }
});
