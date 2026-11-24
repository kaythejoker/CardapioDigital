/**
 * Implanta um restaurante piloto MesaClick: restaurante, logo, banner, cores,
 * cardápio completo (com fotos, "Combina com" e sobremesa ao pedir a conta) e
 * mesas, na mesma revenda do `brasa-demo`. Opcionalmente cria o gestor do
 * restaurante e grava o WhatsApp do suporte da revenda.
 *
 * Pilotos: `arroba` (Arroba Experience, 12/11/2026, já implantado) e
 * `pastel` (Pastel do Chef, 21/11/2026).
 *
 * Seguro para rodar de novo: se o restaurante já existe, NÃO altera cardápio,
 * mesas, PINs nem pedidos — só confere o que falta (gestor e suporte).
 * Não precisa de migration nova.
 *
 * Uso:  npm run pilot:pastel -- --dry-run   (só confere os dados, sem banco)
 *       npm run pilot:pastel
 * Variáveis (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   NEXT_PUBLIC_MENU_URL; opcionais SUPPORT_WHATSAPP e, por piloto,
 *   {ARROBA|PASTEL}_MANAGER_EMAIL, _MANAGER_PASSWORD (12+ caracteres) e
 *   _MANAGER_NAME.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { ARROBA, ARROBA_MENU, type PilotCategory } from "./pilot/arroba-menu";
import { PASTEL, PASTEL_MENU } from "./pilot/pasteldochef/menu";

type Pilot = {
  name: string;
  slug: string;
  primary_color: string;
  background_color: string;
  tables: string[];
  envPrefix: string;
  /** Pasta com logo, banner e fotos. */
  dir: string;
  logo: string;
  cover?: string;
  photos?: string;
  menu: PilotCategory[];
};

const PILOTS: Record<string, Pilot> = {
  arroba: {
    ...ARROBA,
    envPrefix: "ARROBA",
    dir: join(import.meta.dirname, "pilot"),
    logo: "arroba-logo.webp",
    menu: ARROBA_MENU,
  },
  pastel: {
    ...PASTEL,
    dir: join(import.meta.dirname, "pilot", "pasteldochef"),
    photos: "fotos",
    menu: PASTEL_MENU,
  },
};

const dryRun = process.argv.includes("--dry-run");
const pilotKey = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
const pilot = PILOTS[pilotKey];

function validate(p: Pilot) {
  const names = new Set<string>();
  let items = 0;
  let photos = 0;
  for (const c of p.menu)
    for (const i of c.items) {
      items++;
      const key = i.name.toLowerCase();
      if (names.has(key)) throw new Error(`Item repetido: ${i.name}`);
      names.add(key);
      if (!Number.isInteger(i.price) || i.price <= 0)
        throw new Error(`Preço inválido: ${i.name}`);
      if (i.prep < 1 || i.prep > 240) throw new Error(`Preparo inválido: ${i.name}`);
      for (const g of i.groups ?? []) {
        if (g.min > g.max || g.max < 1 || (g.required && g.min < 1) || g.options.length < g.max)
          throw new Error(`Adicionais inválidos: ${i.name} / ${g.name}`);
        for (const [, price] of g.options)
          if (!Number.isInteger(price) || price < 0)
            throw new Error(`Preço de adicional inválido: ${i.name} / ${g.name}`);
      }
      if (i.photo) {
        if (!p.photos || !existsSync(join(p.dir, p.photos, i.photo)))
          throw new Error(`Foto não encontrada: ${i.name} (${i.photo})`);
        photos++;
      }
    }
  for (const c of p.menu)
    for (const i of c.items) {
      if ((i.pairs?.length ?? 0) > 3) throw new Error(`"Combina com" passa de 3: ${i.name}`);
      for (const pair of i.pairs ?? [])
        if (!names.has(pair.toLowerCase()) || pair.toLowerCase() === i.name.toLowerCase())
          throw new Error(`"Combina com" inválido: ${i.name} → ${pair}`);
    }
  for (const file of [p.logo, p.cover].filter(Boolean) as string[])
    if (!existsSync(join(p.dir, file))) throw new Error(`Arquivo não encontrado: ${file}`);
  return { items, photos };
}

async function ok<T>(q: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const r = await q;
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
}

async function main() {
  if (!pilot)
    throw new Error(`Informe o piloto: ${Object.keys(PILOTS).join(" ou ")} (ex.: npm run pilot:pastel)`);
  const { items, photos } = validate(pilot);
  const featured = pilot.menu.flatMap((c) => c.items).filter((i) => i.featured).length;
  console.log(
    `${pilot.name}: ${pilot.menu.length} categorias, ${items} itens, ${featured} destaques, ${photos} fotos.`,
  );
  if (dryRun) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url?.includes("yekmailbymutimhmddzx") || !key)
    throw new Error("Configure o .env.local do projeto Supabase yekmailbymutimhmddzx");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const bucket = db.storage.from("restaurant-images");
  const upload = async (path: string, body: Buffer) => {
    const r = await bucket.upload(path, body, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (r.error) throw r.error;
    return bucket.getPublicUrl(path).data.publicUrl;
  };
  // Mesmo tratamento do envio pelo painel (app/api/upload): WebP de até 1600 px.
  const toWebp = (file: string) =>
    sharp(readFileSync(file))
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

  // Mesma revenda (Felipe) do restaurante de demonstração dos sócios.
  const demo = await ok(db.from("restaurants").select("reseller_id").eq("slug", "brasa-demo").single());
  const resellerId = process.env.RESELLER_ID || demo.reseller_id;
  const support = process.env.SUPPORT_WHATSAPP?.replace(/[^\d+]/g, "") || null;
  if (support) {
    await ok(db.from("resellers").update({ support_whatsapp: support }).eq("id", resellerId).select("id"));
    console.log("WhatsApp do suporte gravado na revenda.");
  }

  let restaurant = await ok(
    db.from("restaurants").select("id,slug").eq("slug", pilot.slug).maybeSingle(),
  );
  if (restaurant) {
    console.log("Restaurante já existe: cardápio, mesas e pedidos mantidos como estão.");
  } else {
    restaurant = await ok(
      db.from("restaurants").insert({
        reseller_id: resellerId,
        name: pilot.name,
        slug: pilot.slug,
        primary_color: pilot.primary_color,
        background_color: pilot.background_color,
        status: "active",
      }).select("id,slug").single(),
    );
    const rid = restaurant.id;
    // Restaurante novo nasce "em teste" (14 dias). O piloto fica ativo, sem
    // vencimento, até a revenda decidir o plano em Revenda → Assinaturas.
    await ok(
      db.from("subscriptions").update({
        status: "ativa",
        trial_ends_at: null,
        current_period_end: null,
        notes: "Piloto MesaClick, sem cobrança",
      }).eq("restaurant_id", rid).select("id"),
    );
    const logoUrl = await upload(`restaurant/${rid}/logo.webp`, await toWebp(join(pilot.dir, pilot.logo)));
    const coverUrl = pilot.cover
      ? await upload(`restaurant/${rid}/capa.webp`, await toWebp(join(pilot.dir, pilot.cover)))
      : null;
    await ok(db.from("restaurants").update({ logo_url: logoUrl, cover_url: coverUrl }).eq("id", rid).select("id"));

    const ids = new Map<string, string>();
    for (const [cPos, category] of pilot.menu.entries()) {
      // Tudo na fila da cozinha. Para mandar bebidas ao bar, o gestor troca o
      // setor da categoria para "Bar".
      const c = await ok(
        db.from("categories").insert({
          restaurant_id: rid,
          name: category.name,
          position: cPos,
          active: true,
          suggest_at_bill: !!category.suggestAtBill,
        }).select("id").single(),
      );
      for (const [iPos, item] of category.items.entries()) {
        const photoUrl =
          item.photo && pilot.photos
            ? await upload(
                `restaurant/${rid}/itens/${item.photo.replace(/\.\w+$/, "")}.webp`,
                await toWebp(join(pilot.dir, pilot.photos, item.photo)),
              )
            : null;
        const created = await ok(
          db.from("menu_items").insert({
            restaurant_id: rid,
            category_id: c.id,
            name: item.name,
            description: item.description ?? null,
            price_cents: item.price,
            photo_url: photoUrl,
            prep_minutes: item.prep,
            featured: !!item.featured,
            position: iPos,
            active: true,
            sold_out: false,
          }).select("id").single(),
        );
        ids.set(item.name.toLowerCase(), created.id);
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
    // "Combina com" depois de todos os itens existirem.
    for (const item of pilot.menu.flatMap((c) => c.items))
      if (item.pairs?.length)
        await ok(
          db.from("menu_items")
            .update({ pairs: item.pairs.map((n) => ids.get(n.toLowerCase())) })
            .eq("id", ids.get(item.name.toLowerCase())!)
            .select("id"),
        );
    await ok(
      db.from("tables").insert(pilot.tables.map((label) => ({ restaurant_id: rid, label }))).select("id"),
    );
    console.log(`Restaurante criado com ${items} itens (${photos} com foto) e ${pilot.tables.length} mesas.`);
  }

  // Gestor do restaurante (opcional).
  const env = (k: string) => process.env[`${pilot.envPrefix}_MANAGER_${k}`];
  const email = env("EMAIL")?.trim().toLowerCase();
  const password = env("PASSWORD");
  if (email) {
    const users = await db.auth.admin.listUsers({ perPage: 1000 });
    if (users.error) throw users.error;
    let user = users.data.users.find((u) => u.email === email);
    if (!user) {
      if (!password || password.length < 12)
        throw new Error(`${pilot.envPrefix}_MANAGER_PASSWORD precisa de 12 caracteres ou mais`);
      const created = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: env("NAME") || `Gestor ${pilot.name}` },
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
  console.log(`Cardápio para consulta: ${origin}/${pilot.slug}/consulta`);
  for (const t of tables) console.log(`Mesa ${t.label}: ${origin}/${pilot.slug}/m/${t.qr_token}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
