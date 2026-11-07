import type { Metadata, Viewport } from "next";

// Painéis da equipe: marca MesaClick. O cardápio do cliente segue com o
// título e as cores do restaurante (app/layout.tsx e app/[slug]).
export const metadata: Metadata = {
  title: "MesaClick",
  description: "Painéis da equipe MesaClick",
};

export const viewport: Viewport = {
  themeColor: "#F3F6FB",
};

export default function PanelsLayout({ children }: LayoutProps<"/app">) {
  return children;
}
