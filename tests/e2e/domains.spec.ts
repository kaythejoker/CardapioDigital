import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BRASA = "20000000-0000-4000-8000-000000000001";
const RESELLER = "10000000-0000-4000-8000-000000000001";

// Em produção o Host é resolvido pela Vercel antes de chegar ao app: um domínio
// de teste sem DNS nunca alcança o proxy. Só roda contra o servidor local.
test.skip(!!process.env.QA_BASE_URL, "resolução por Host só é testável no servidor local");

test("domínio da revenda e do restaurante servem o cardápio pelo host; a URL antiga continua valendo", async ({
  request,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const stamp = Date.now();
  const resellerDomain = `cardapio-${stamp}.revenda-e2e.com.br`;
  const restaurantDomain = `menu-${stamp}.brasa-e2e.com.br`;
  const { data: table } = await admin.from("tables").select("qr_token").eq("restaurant_id", BRASA).eq("active", true).limit(1).single();
  const { data: before } = await admin.from("resellers").select("domain,domain_status").eq("id", RESELLER).single();
  try {
    // Domínios ativos (a verificação de DNS na Vercel é feita pela rota /api/domains; aqui simulamos o resultado).
    await admin.from("resellers").update({ domain: resellerDomain }).eq("id", RESELLER);
    await admin.from("resellers").update({ domain_status: "active" }).eq("id", RESELLER);
    await admin.from("restaurants").update({ custom_domain: restaurantDomain }).eq("id", BRASA);
    await admin.from("restaurants").update({ custom_domain_status: "active" }).eq("id", BRASA);
    // Revenda: /{slug}/m/{qr} no domínio dela.
    const viaReseller = await request.get(`/brasa-bistro/m/${table!.qr_token}`, { headers: { host: resellerDomain } });
    expect(viaReseller.status()).toBe(200);
    expect(await viaReseller.text()).toContain("Brasa Bistrô");
    // Restaurante: raiz = consulta; /m/{qr} = mesa.
    const consult = await request.get("/", { headers: { host: restaurantDomain } });
    expect(consult.status()).toBe(200);
    const consultHtml = await consult.text();
    expect(consultHtml).toContain("Brasa Bistrô");
    expect(consultHtml).toContain("Cardápio para consulta");
    const viaRestaurant = await request.get(`/m/${table!.qr_token}`, { headers: { host: restaurantDomain } });
    expect(viaRestaurant.status()).toBe(200);
    expect(await viaRestaurant.text()).toContain("Brasa Bistrô");
    // Outro restaurante pelo domínio do Brasa não abre.
    const { data: other } = await admin.from("tables").select("qr_token").eq("restaurant_id", "20000000-0000-4000-8000-000000000002").limit(1).single();
    const cross = await request.get(`/m/${other!.qr_token}`, { headers: { host: restaurantDomain } });
    // notFound() dentro de Suspense responde 200 com a página de não encontrado (streaming).
    const crossHtml = await cross.text();
    expect(crossHtml).toContain("404");
    expect(crossHtml).not.toContain("Cardápio para consulta");
    // QR gerado agora usa o domínio do restaurante; a URL antiga continua abrindo.
    const menuApi = await request.get(`/api/menu/brasa-bistro/${table!.qr_token}`);
    expect(menuApi.status()).toBe(200);
    expect((await menuApi.json()).menu_url).toBe(`https://${restaurantDomain}/m/${table!.qr_token}`);
    const old = await request.get(`/brasa-bistro/m/${table!.qr_token}`);
    expect(old.status()).toBe(200);
    // Host desconhecido continua servindo normalmente.
    const unknown = await request.get(`/brasa-bistro/m/${table!.qr_token}`, { headers: { host: `nada-${stamp}.exemplo.com` } });
    expect(unknown.status()).toBe(200);
  } finally {
    await admin.from("restaurants").update({ custom_domain: null }).eq("id", BRASA);
    await admin.from("resellers").update({ domain: before?.domain ?? null }).eq("id", RESELLER);
    if (before?.domain) await admin.from("resellers").update({ domain_status: before.domain_status }).eq("id", RESELLER);
  }
});
