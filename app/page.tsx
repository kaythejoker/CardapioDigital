import Link from "next/link";
import { T } from "@/components/i18n";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-heading text-4xl font-semibold">Comanda</h1>
      <p className="max-w-sm text-muted-foreground"><T>{"Cardápio digital com pedido pela mesa. Escaneie o QR code da sua mesa para ver o cardápio."}</T></p>
      <Link href={`${process.env.NEXT_PUBLIC_ADMIN_URL || ""}/app`} className="mt-6 rounded-xl bg-primary px-6 py-4 text-primary-foreground"><T>{"Acesso da equipe"}</T></Link>
    </main>
  );
}
