import { Suspense } from "react";
import { Menu } from "@/components/menu";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { loadMenuConsult } from "@/lib/menu-data";

/** Cardápio para consulta, sem mesa: a raiz do domínio próprio do restaurante. */
async function Content({ params }: PageProps<"/[slug]/consulta">) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  await connection();
  const menu = await loadMenuConsult(slug);
  if (!menu) notFound();
  return <Menu slug={slug} qrToken="" initialMenu={menu} consult />;
}

export default function Page(props: PageProps<"/[slug]/consulta">) {
  return <Suspense fallback={<main className="p-8 text-center">Preparando seu cardápio…</main>}><Content {...props} /></Suspense>;
}
