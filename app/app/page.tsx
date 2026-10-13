import { publicMenuUrl } from "@/lib/restaurant-brand";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight, ChefHat, LayoutDashboard, Store, UtensilsCrossed } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

async function Home() {
  await connection();
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/app/login");
  const [members, resellers] = await Promise.all([
    db
      .from("restaurant_members")
      .select("role,restaurants(name,slug,tables(label,qr_token,active))")
      .eq("user_id", user.id),
    db.from("reseller_members").select("reseller_id").eq("user_id", user.id),
  ]);
  const links = new Set<string>();
  for (const m of members.data ?? []) {
    if (m.role === "manager") {
      links.add("gestor");
      links.add("garcom");
      links.add("cozinha");
    }
    if (m.role === "waiter") links.add("garcom");
    if (m.role === "kitchen") links.add("cozinha");
  }
  if (resellers.data?.length) links.add("revenda");
  return (
    <main className="operations-hub">
      <header className="hub-brand"><BrandMark/><span>Comanda</span><small>{user.email}</small></header>
      <div className="hub-intro"><p>SEU RESTAURANTE, CONECTADO</p><h1 className="font-heading text-4xl">Sua operação</h1><span>Escolha o painel para começar.</span></div>
      <div className="hub-grid">
        {[...links].map((role) => (
          <Link
            key={role}
            href={`/app/${role}`}
            className={`hub-card hub-${role}`}
          >
            <span className="hub-card-icon">{role === "gestor" ? <LayoutDashboard/> : role === "garcom" ? <UtensilsCrossed/> : role === "cozinha" ? <ChefHat/> : <Store/>}</span>
            <ArrowUpRight className="hub-card-arrow"/>
            <h2>{
              {
                gestor: "Painel do gestor",
                garcom: "Salão e mesas",
                cozinha: "Fila da cozinha",
                revenda: "Painel da revenda",
              }[role]
            }</h2><p>{{gestor:"Acompanhe o dia, edite o cardápio e personalize a marca do restaurante.",garcom:"Abra mesas, consulte o PIN e acompanhe o atendimento.",cozinha:"Organize o preparo e avise quando cada pedido estiver pronto.",revenda:"Gerencie seus restaurantes, acessos e a identidade da revenda."}[role]}</p><span className="hub-card-link">Abrir painel <ArrowUpRight size={16}/></span>
          </Link>
        ))}
      </div>
      {(members.data ?? []).filter(m => m.role === "manager").map(m => {const r = Array.isArray(m.restaurants) ? m.restaurants[0] : m.restaurants; if (!r) return null; const t = r.tables.find(t => t.active && t.label === "12") || r.tables.find(t => t.active); return t && <Link key={r.slug} href={publicMenuUrl(r.slug,t.qr_token)} target="_blank" className="hub-customer"><span className="hub-card-icon"><UtensilsCrossed/></span><span><strong>Visão do cliente ↗</strong><span className="mt-2 block text-sm text-muted-foreground">{r.name} · Mesa {t.label} · Cardápio público</span></span><ArrowUpRight/></Link>;})}
      {!links.size && (
        <p>Seu acesso ainda não foi vinculado. Fale com o gestor.</p>
      )}
    </main>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p className="p-8">Carregando seus acessos…</p>}>
      <Home />
    </Suspense>
  );
}
