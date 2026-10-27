import { Suspense } from "react";
import { Menu } from "@/components/menu";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { loadMenu } from "@/lib/menu-data";
import { T } from "@/components/i18n";

async function Content({ params }: PageProps<"/[slug]/m/[qrToken]">) {
  const { slug, qrToken } = await params;
  if(!/^[a-z0-9-]+$/.test(slug)||!/^[a-f0-9]{32}$/.test(qrToken))notFound();
  await connection();
  const menu=await loadMenu(slug,qrToken);
  if(!menu)notFound();
  return <Menu slug={slug} qrToken={qrToken} initialMenu={menu} />;
}

export default function Page(props: PageProps<"/[slug]/m/[qrToken]">) {
  return <Suspense fallback={<main className="p-8 text-center"><T>{"Preparando seu cardápio…"}</T></main>}><Content {...props} /></Suspense>;
}
