import { Suspense } from "react";
import { Operation } from "@/components/operation";

async function Content({ searchParams }: PageProps<"/app/garcom">) {
  const params = await searchParams;
  return (
    <Operation
      role="garcom"
      initialRestaurant={
        typeof params.restaurant_id === "string" ? params.restaurant_id : undefined
      }
    />
  );
}
export default function Page(props: PageProps<"/app/garcom">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
