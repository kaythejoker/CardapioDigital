import type { Metadata } from "next";
import { restaurantName } from "@/lib/menu-data";

// Cardápio do cliente: a aba do navegador mostra o nome do restaurante.
export async function generateMetadata({ params }: LayoutProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const name = await restaurantName(slug).catch(() => null);
  return name ? { title: name, description: `Cardápio digital de ${name}` } : {};
}

export default function RestaurantLayout({ children }: LayoutProps<"/[slug]">) {
  return children;
}
