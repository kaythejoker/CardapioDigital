import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

async function login(page: Page, email: string, password: string) {
  await page.goto("/app/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("revenda cria restaurante e gestor monta cardápio, equipe, imagem e QR", async ({
  browser,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const slug = `teste-e2e-${stamp}`;
  const name = `Restaurante E2E ${stamp}`;
  const email = `gestor-${stamp}@comanda.dev`;
  const password = `Teste-${stamp}-seguro!`;
  const resellerContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const managerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const reseller = await resellerContext.newPage();
  const manager = await managerContext.newPage();
  let restaurantId = "";
  let staffId = "";
  let userId = "";
  const imagePaths: string[] = [];
  try {
    await login(
      reseller,
      "revenda@comanda.dev",
      process.env.SEED_RESELLER_PASSWORD || process.env.SEED_USER_PASSWORD!,
    );
    await reseller.goto("/app/revenda");
    await reseller.getByLabel("Nome", { exact: true }).fill(name);
    await reseller.getByLabel("Endereço do cardápio").fill(slug);
    await reseller
      .getByRole("button", { name: "Criar restaurante", exact: true })
      .click();
    await expect(
      reseller.getByRole("heading", { name: `Gestor de ${name}`, exact: true }),
    ).toBeVisible();
    const { data: r } = await admin
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .single();
    restaurantId = r!.id;
    const invite = reseller
      .getByRole("heading", { name: "Convidar gestor", exact: true })
      .locator("..");
    await invite.getByLabel("Nome", { exact: true }).fill("Gestor de teste");
    await invite.getByLabel("E-mail", { exact: true }).fill(email);
    await invite.getByLabel("Tipo de acesso").selectOption("password");
    await invite.getByLabel("Senha inicial", { exact: true }).fill(password);
    await invite
      .getByRole("button", { name: "Criar acesso", exact: true })
      .click();
    await expect(invite.getByRole("status")).toContainText("Acesso vinculado");
    const { data: members } = await admin
      .from("restaurant_members")
      .select("user_id")
      .eq("restaurant_id", restaurantId);
    userId = members![0].user_id;
    await login(manager, email, password);
    await manager.goto("/app/gestor");
    const overview = manager.getByRole("heading", {
      name: "Visão geral",
      level: 2,
      exact: true,
    });
    await expect(overview).toBeVisible();
    await expect(
      overview.locator("..").getByText(name, { exact: true }),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Cardápio", exact: true })
      .click();
    await manager.getByLabel("Nova categoria", { exact: true }).fill("Pratos");
    await manager
      .getByRole("button", { name: "Adicionar categoria", exact: true })
      .click();
    await expect(
      manager.getByLabel("Nome da categoria Pratos", { exact: true }),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Novo item", exact: true })
      .click();
    await manager.getByLabel("Nome", { exact: true }).fill("Prato de teste");
    await manager
      .getByLabel("Descrição", { exact: true })
      .fill("Feito na hora");
    await manager.getByLabel("Preço (R$)", { exact: true }).fill("42.90");
    await manager.getByLabel("Preparo (minutos)").fill("12");
    const image = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#E0552B" },
    })
      .png()
      .toBuffer();
    const uploadResponse = manager.waitForResponse(
      (response) =>
        response.url().endsWith("/api/upload") &&
        response.request().method() === "POST",
    );
    await manager
      .getByLabel("Foto do item", { exact: true })
      .setInputFiles({
        name: "prato.png",
        mimeType: "image/png",
        buffer: image,
      });
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(200);
    const uploadedData = await uploaded.json();
    imagePaths.push(
      new URL(uploadedData.url).pathname.split("/restaurant-images/")[1],
    );
    await manager
      .getByRole("button", { name: "Adicionar grupo", exact: true })
      .click();
    await manager.getByLabel("Nome do grupo", { exact: true }).fill("Ponto");
    await manager.getByLabel("Obrigatório", { exact: true }).check();
    await manager.getByLabel("Opção 1", { exact: true }).fill("Ao ponto");
    await manager
      .getByRole("button", { name: "Salvar item", exact: true })
      .click();
    await expect(
      manager.getByRole("heading", { name: "Prato de teste", exact: true }),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Mesas e QR", exact: true })
      .click();
    await manager.getByLabel("Nova mesa", { exact: true }).fill("1");
    await manager
      .getByRole("button", { name: "Adicionar mesa", exact: true })
      .click();
    await expect(
      manager.getByRole("link", { name: "Abrir cardápio", exact: true }),
    ).toBeVisible();
    const qr = await manager.request.get(`/api/qr/${restaurantId}`);
    expect(qr.status()).toBe(200);
    expect(qr.headers()["content-type"]).toContain("application/pdf");
    const pdf = await PDFDocument.load(await qr.body());
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28);
    const { data: table } = await admin
      .from("tables")
      .select("qr_token")
      .eq("restaurant_id", restaurantId)
      .single();
    const menu = await manager.request.get(
      `/api/menu/${slug}/${table!.qr_token}`,
    );
    const publicMenu = await menu.json();
    expect(publicMenu.items[0].name).toBe("Prato de teste");
    expect(publicMenu.items[0].price_cents).toBe(4290);
    expect(publicMenu.items[0].modifier_groups[0].required).toBe(true);
    const cross = await manager.request.get(
      "/api/manage/20000000-0000-4000-8000-000000000001",
    );
    expect(cross.status()).toBe(403);
    await manager
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await manager.getByLabel("Regra de prioridade").selectOption("complexity");
    await manager.getByLabel("Limite de espera (minutos)").fill("15");
    await manager
      .getByRole("button", { name: "Salvar regra da fila", exact: true })
      .click();
    await expect(manager.getByRole("status").filter({ hasText: "Alterações salvas" })).toBeVisible();
    const { data: settings } = await admin
      .from("kitchen_settings")
      .select("mode,max_wait_minutes")
      .eq("restaurant_id", restaurantId)
      .single();
    expect(settings!.mode).toBe("complexity");
    expect(settings!.max_wait_minutes).toBe(15);
    await manager.getByRole("button", { name: "Equipe", exact: true }).click();
    const teamForm = manager.getByRole("heading", { name: "Adicionar à equipe", exact: true }).locator("..");
    await teamForm.getByLabel("Nome", { exact: true }).fill("Garçom QA");
    await teamForm.getByLabel("E-mail", { exact: true }).fill(`garcom-${stamp}@comanda.dev`);
    await teamForm.getByLabel("Tipo de acesso").selectOption("password");
    await teamForm.getByLabel("Senha inicial", { exact: true }).fill(password);
    await teamForm.getByRole("button", { name: "Criar acesso", exact: true }).click();
    const person = manager.getByRole("article").filter({ hasText: `garcom-${stamp}@comanda.dev` });
    await expect(person).toBeVisible();
    const { data: staff } = await admin.from("restaurant_members").select("user_id").eq("restaurant_id", restaurantId).eq("role", "waiter").single(); staffId = staff!.user_id;
    await person.getByRole("button", { name: "Remover acesso", exact: true }).click();
    await person.getByRole("button", { name: "Confirmar remoção", exact: true }).click();
    await expect(person).toHaveCount(0);
    const { count } = await admin.from("restaurant_members").select("user_id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).eq("user_id", staffId); expect(count).toBe(0);
  } finally {
    await Promise.allSettled([resellerContext.close(), managerContext.close()]);
    if (restaurantId) {
      const result = await admin
        .from("restaurants")
        .delete()
        .eq("id", restaurantId);
      if (result.error) throw result.error;
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (staffId) await admin.auth.admin.deleteUser(staffId);
    if (imagePaths.length)
      await admin.storage.from("restaurant-images").remove(imagePaths);
  }
});
