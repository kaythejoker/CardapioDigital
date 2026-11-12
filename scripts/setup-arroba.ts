/**
 * Implanta o piloto MesaClick no Arroba Experience: restaurante, logo, cores,
 * cardápio completo e 2 mesas, na mesma revenda do `brasa-demo`. Opcionalmente
 * cria o gestor do restaurante e grava o WhatsApp do suporte da revenda.
 *
 * Seguro para rodar de novo: se o restaurante já existe, NÃO altera cardápio,
 * mesas, PINs nem pedidos — só confere o que falta (gestor e suporte).
 * Não precisa de migration nova: usa o esquema das fases 2 e 3.
 *
 * Uso:  npm run pilot:arroba -- --dry-run   (só confere os dados, sem banco)
 *       npm run pilot:arroba
 * Variáveis (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   NEXT_PUBLIC_MENU_URL; opcionais SUPPORT_WHATSAPP, ARROBA_MANAGER_EMAIL,
 *   ARROBA_MANAGER_PASSWORD (12+ caracteres) e ARROBA_MANAGER_NAME.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ARROBA, ARROBA_MENU } from "./pilot/arroba-menu";

const dryRun = process.argv.includes("--dry-run");

function validate() {
  const names = new Set<string>();
  let items = 0;
  for (const c of ARROBA_MENU)
    for (const i of c.items) {
      items++;
      const key = i.name.toLowerCase();
      if (names.has(key)) throw new Error(`Item repetido: ${i.name}`);
      names.add(key);
      if (!Number.isInteger(i.price) || i.price <= 0)
        throw new Error(`Preço inválido: ${i.name}`);
      if (i.prep < 1 || i.prep > 240) throw new Error(`Preparo inválido: ${i.name}`);
      for (const g of i.groups ?? [])
        if (g.min > g.max || g.max < 1 || (g.required && g.min < 1) || g.options.length < g.max)
          throw new Error(`Adicionais inválidos: ${i.name} / ${g.name}`);
    }
  return items;
}

async function ok<T>(q: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const r = await q;
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
}

async function main() {
  const items = validate();
  const featured = ARROBA_MENU.flatMap((c) => c.items).filter((i) => i.featured).length;
  console.log(`Cardápio conferido: ${ARROBA_MENU.length} categorias, ${items} itens, ${featured} destaques.`);
  if (dryRun) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url?.includes("yekmailbymutimhmddzx") || !key)
    throw new Error("Configure o .env.local do projeto Supabase yekmailbymutimhmddzx");
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Mesma revenda (Felipe) do restaurante de demonstração dos sócios.
  const demo = await ok(db.from("restaurants").select("reseller_id").eq("slug", "brasa-demo").single());
  const resellerId = process.env.RESELLER_ID || demo.reseller_id;
  const support = process.env.SUPPORT_WHATSAPP?.replace(/[^\d+]/g, "") || null;
  if (support) {
    await ok(db.from("resellers").update({ support_whatsapp: support }).eq("id", resellerId).select("id"));
    console.log("WhatsApp do suporte gravado na revenda.");
  }

  let restaurant = await ok(
    db.from("restaurants").select("id,slug").eq("slug", ARROBA.slug).maybeSingle(),
  );
  if (restaurant) {
    console.log("Restaurante já existe: cardápio, mesas e pedidos mantidos como estão.");
  } else {
    restaurant = await ok(
      db.from("restaurants").insert({
        reseller_id: resellerId,
        name: ARROBA.name,
        slug: ARROBA.slug,
        primary_color: ARROBA.primary_color,
        background_color: ARROBA.background_color,
        status: "active",
      }).select("id,slug").single(),
    );
    // Restaurante novo nasce "em teste" (14 dias). O piloto fica ativo, sem
    // vencimento, até a revenda decidir o plano em Revenda → Assinaturas.
    await ok(
      db.from("subscriptions").update({
        status: "ativa",
        trial_ends_at: null,
        current_period_end: null,
        notes: "Piloto MesaClick (novembro/2026), sem cobrança",
      }).eq("restaurant_id", restaurant.id).select("id"),
    );
    const logoPath = `restaurant/${restaurant.id}/logo-arroba.webp`;
    const upload = await db.storage
      .from("restaurant-images")
      .upload(logoPath, readFileSync(join(import.meta.dirname, "pilot", "arroba-logo.webp")), {
        contentType: "image/webp",
        upsert: true,
        cacheControl: "31536000",
      });
    if (upload.error) throw upload.error;
    const logoUrl = db.storage.from("restaurant-images").getPublicUrl(logoPath).data.publicUrl;
    await ok(db.from("restaurants").update({ logo_url: logoUrl }).eq("id", restaurant.id).select("id"));

    for (const [cPos, category] of ARROBA_MENU.entries()) {
      // Tudo na fila da cozinha: o Arroba ainda não confirmou se terá bar
      // separado. Para mudar, o gestor troca o setor da categoria para "Bar".
      const c = await ok(
        db.from("categories").insert({ restaurant_id: restaurant.id, name: category.name, position: cPos, active: true }).select("id").single(),
      );
      for (const [iPos, item] of category.items.entries()) {
        const created = await ok(
          db.from("menu_items").insert({
            restaurant_id: restaurant.id,
            category_id: c.id,
            name: item.name,
            description: item.description ?? null,
            price_cents: item.price,
            prep_minutes: item.prep,
            featured: !!item.featured,
            position: iPos,
            active: true,
            sold_out: false,
          }).select("id").single(),
        );
        for (const [gPos, group] of (item.groups ?? []).entries()) {
          const g = await ok(
            db.from("modifier_groups").insert({
              menu_item_id: created.id,
              name: group.name,
              required: group.required,
              min_select: group.min,
              max_select: group.max,
              position: gPos,
            }).select("id").single(),
          );
          await ok(
            db.from("modifiers").insert(
              group.options.map(([name, price_cents], position) => ({ group_id: g.id, name, price_cents, position })),
            ).select("id"),
          );
        }
      }
    }
    await ok(
      db.from("tables").insert(ARROBA.tables.map((label) => ({ restaurant_id: restaurant!.id, label }))).select("id"),
    );
    console.log(`Restaurante criado com ${items} itens e ${ARROBA.tables.length} mesas.`);
  }

  // Gestor do restaurante (opcional).
  const email = process.env.ARROBA_MANAGER_EMAIL?.trim().toLowerCase();
  const password = process.env.ARROBA_MANAGER_PASSWORD;
  if (email) {
    const users = await db.auth.admin.listUsers({ perPage: 1000 });
    if (users.error) throw users.error;
    let user = users.data.users.find((u) => u.email === email);
    if (!user) {
      if (!password || password.length < 12)
        throw new Error("ARROBA_MANAGER_PASSWORD precisa de 12 caracteres ou mais");
      const created = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: process.env.ARROBA_MANAGER_NAME || "Gestor Arroba" },
      });
      if (created.error) throw created.error;
      user = created.data.user;
    }
    await ok(
      db.from("restaurant_members").upsert({
        user_id: user.id,
        restaurant_id: restaurant.id,
        role: "manager",
        roles: ["manager"],
      }).select("user_id"),
    );
    console.log(`Gestor com acesso: ${email}`);
  }

  const tables = await ok(
    db.from("tables").select("label,qr_token").eq("restaurant_id", restaurant.id).order("label"),
  );
  const origin = (process.env.NEXT_PUBLIC_MENU_URL || "").replace(/\/$/, "");
  for (const t of tables) console.log(`Mesa ${t.label}: ${origin}/${ARROBA.slug}/m/${t.qr_token}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
