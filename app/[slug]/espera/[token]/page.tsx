import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { WaitlistTicket } from "@/components/waitlist-ticket";
import { loadWaitlistTicket } from "@/lib/waitlist";
import { T } from "@/components/i18n";

/** Posição na lista de espera (spec-fase3.md, seção 1). */
async function Content({ params }: PageProps<"/[slug]/espera/[token]">) {
  const { slug, token } = await params;
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[0-9a-f-]{36}$/.test(token)) notFound();
  await connection();
  const ticket = await loadWaitlistTicket(slug, token).catch(() => null);
  return <WaitlistTicket slug={slug} token={token} initial={ticket} />;
}

export default function Page(props: PageProps<"/[slug]/espera/[token]">) {
  return (
    <Suspense fallback={<main className="p-8 text-center"><T>{"Carregando sua posição…"}</T></main>}>
      <Content {...props} />
    </Suspense>
  );
}
