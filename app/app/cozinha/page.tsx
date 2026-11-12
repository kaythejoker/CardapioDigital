import { Suspense } from "react";
import { Operation } from "@/components/operation";

async function Content({ searchParams }: PageProps<"/app/cozinha">) {
  const params = await searchParams;
  return (
    <Operation
      role="cozinha"
      initialRestaurant={
        typeof params.restaurant_id === "string" ? params.restaurant_id : undefined
      }
    />
  );
}
export default function Page(props: PageProps<"/app/cozinha">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
