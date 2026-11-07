import Image from "next/image";

export function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={className} width="42" height="42" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 33h34M10 32a14 14 0 0 1 28 0M5 38h38M21 15h6M24 15v3M15 7l2 4M24 4v5M33 7l-2 4" /></svg>;
}

/**
 * Logo MesaClick dos painéis da equipe. Traz as versões clara e escura; o CSS
 * (panel-brand.css) mostra a escura dentro de `.dark` (cozinha e bar).
 */
export function MesaClickLogo({ className = "", tagline = false, priority = false }: { className?: string; tagline?: boolean; priority?: boolean }) {
  const file = tagline ? "mesaclick-logo-tagline" : "mesaclick-logo";
  return (
    <span className={className}>
      <Image src={`/brand/${file}.png`} alt="MesaClick" width={1437} height={282} priority={priority} className="mc-logo mc-logo-light" />
      <Image src={`/brand/${file}-dark.png`} alt="MesaClick" width={1437} height={282} priority={priority} className="mc-logo mc-logo-dark" />
    </span>
  );
}
