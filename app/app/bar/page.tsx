import { Suspense } from "react";
import { Operation } from "@/components/operation";

async function Content({ searchParams }: PageProps<"/app/bar">) {
  const params = await searchParams;
  return (
    <Operation
      role="bar"
      initialRestaurant={
        typeof params.restaurant_id === "string" ? params.restaurant_id : undefined
      }
    />
  );
}
export default function Page(props: PageProps<"/app/bar">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
