export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-heading text-4xl font-semibold">Comanda</h1>
      <p className="max-w-sm text-muted-foreground">
        Cardápio digital com pedido pela mesa. Escaneie o QR code da sua mesa
        para ver o cardápio.
      </p>
    </main>
  );
}
