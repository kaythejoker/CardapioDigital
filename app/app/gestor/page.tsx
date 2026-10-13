import { Suspense } from "react";
import { Manager } from "@/components/manager";
async function Content({ searchParams }: PageProps<"/app/gestor">) {
  const params = await searchParams;
  return (
    <Manager
      initialRestaurant={
        typeof params.restaurant_id === "string"
          ? params.restaurant_id
          : undefined
      }
    />
  );
}
export default function Page(props: PageProps<"/app/gestor">) {
  return (
    <Suspense fallback={<p className="p-8">Carregando painel…</p>}>
      <Content {...props} />
    </Suspense>
  );
}
