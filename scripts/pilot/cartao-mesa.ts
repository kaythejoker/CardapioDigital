/**
 * Cartão de mesa para impressão (display de acrílico), no visual MesaClick:
 * fundo azul-marinho, borda dourada, logo do restaurante num círculo, faixa
 * "MESA N", QR code e rodapé "MesaClick — solução digital da Nutrivox Digital".
 * Mesmo modelo usado no Arroba (12/11/2026).
 *
 * Uso:  npx tsx --env-file=.env.local scripts/pilot/cartao-mesa.ts pastel-do-chef
 * Lê do banco o nome, a logo, o domínio próprio (se ativo) e as mesas, e grava
 * um PNG por mesa em output/cartoes/{slug}/ (2172 x 2896 px, proporção 3:4).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import sharp from "sharp";

const W = 1086;
const H = 1448;
const SCALE = 2;
const NAVY = "#0B1730";
const GOLD = "#E0AE4A";
const root = join(import.meta.dirname, "..", "..");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "Segoe UI, Arial, Helvetica, sans-serif";

async function png(input: Buffer | string, w: number, h: number) {
  return sharp(input).resize(w * SCALE, h * SCALE, { fit: "contain", background: "#0000" }).png().toBuffer();
}

async function card(label: string, url: string, logo: Buffer) {
  const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: "M", margin: 0, width: 380 * SCALE, color: { dark: "#000000", light: "#ffffff" } });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${NAVY}"/>
  <rect x="46" y="34" width="${W - 92}" height="${H - 68}" rx="44" fill="none" stroke="${GOLD}" stroke-width="7"/>
  <circle cx="543" cy="174" r="122" fill="#000" opacity=".35"/>
  <text x="543" y="378" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="56" fill="#fff">Faça seu pedido</text>
  <text x="543" y="444" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="56" fill="#fff">pelo celular</text>
  <rect x="247" y="470" width="592" height="108" rx="36" fill="${GOLD}"/>
  <text x="543" y="555" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="78" letter-spacing="3" fill="${NAVY}">${esc(`MESA ${label}`)}</text>
  <rect x="323" y="600" width="440" height="440" rx="20" fill="#fff"/>
  <text x="543" y="1222" text-anchor="middle" font-family="${FONT}" font-size="30" letter-spacing="1.5" fill="#fff">SOLUÇÃO DIGITAL DA</text>
  <text x="458" y="1293" font-family="${FONT}" font-weight="700" font-size="34" fill="#fff">Nutrivox</text>
  <text x="608" y="1293" font-family="${FONT}" font-size="34" fill="#A9B4C6">Digital</text>
</svg>`;
  const at = (x: number, y: number) => ({ left: Math.round(x * SCALE), top: Math.round(y * SCALE) });
  // Logo recortada no círculo branco e anel dourado por cima, para nada vazar.
  const D = 236 * SCALE;
  const circle = (extra: string) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 236 236"><circle cx="118" cy="118" r="${extra}"/></svg>`);
  const logoRound = await sharp(
    await sharp(logo).resize(Math.round(D * 0.86), Math.round(D * 0.86), { fit: "contain", background: "#fff" }).flatten({ background: "#fff" })
      .extend({ top: Math.round(D * 0.07), bottom: D - Math.round(D * 0.86) - Math.round(D * 0.07), left: Math.round(D * 0.07), right: D - Math.round(D * 0.86) - Math.round(D * 0.07), background: "#fff" })
      .png().toBuffer(),
  ).composite([{ input: circle(`115" fill="#000`), blend: "dest-in" }]).png().toBuffer();
  const ring = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 236 236"><circle cx="118" cy="118" r="115" fill="none" stroke="${GOLD}" stroke-width="6"/></svg>`,
  );
  return sharp(Buffer.from(svg))
    .composite([
      { input: logoRound, ...at(425, 52) },
      { input: ring, ...at(425, 52) },
      { input: qr, ...at(353, 630) },
      { input: await png(join(root, "public/brand/mesaclick-logo-dark.png"), 520, 102), ...at(283, 1080) },
      { input: await png(join(import.meta.dirname, "nutrivox-logo.png"), 64, 64), ...at(382, 1250) },
    ])
    .png()
    .toBuffer();
}

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Informe o slug do restaurante (ex.: pastel-do-chef)");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data: r, error } = await db
    .from("restaurants")
    .select("id,name,logo_url,custom_domain,custom_domain_status")
    .eq("slug", slug)
    .single();
  if (error || !r?.logo_url) throw error ?? new Error("Restaurante sem logo");
  const { data: tables } = await db.from("tables").select("label,qr_token").eq("restaurant_id", r.id).order("label");
  // Mesma regra do PDF do painel (lib/qr-pdf.ts): domínio próprio ativo usa /m/{qr}.
  const origin = (process.env.NEXT_PUBLIC_MENU_URL || "https://cardapio-cliente-three.vercel.app").replace(/\/$/, "");
  const base = r.custom_domain && r.custom_domain_status === "active" ? `https://${r.custom_domain}` : `${origin}/${slug}`;
  const logo = Buffer.from(await (await fetch(r.logo_url)).arrayBuffer());
  const dir = join(root, "output", "cartoes", slug);
  mkdirSync(dir, { recursive: true });
  for (const t of tables ?? []) {
    const file = join(dir, `mesa-${t.label}.png`);
    writeFileSync(file, await card(t.label, `${base}/m/${t.qr_token}`, logo));
    console.log(`Mesa ${t.label}: ${file}  →  ${base}/m/${t.qr_token}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
