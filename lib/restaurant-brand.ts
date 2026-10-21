/**
 * Link público de uma mesa. Sem domínio próprio, aponta para o projeto público;
 * com `menuOrigin` do servidor (domínio ativo), usa o domínio e o caminho curto.
 */
export function publicMenuUrl(slug: string, qrToken: string, menuOrigin?: { origin: string; short: boolean } | null) {
  const origin = (menuOrigin?.origin || process.env.NEXT_PUBLIC_MENU_URL || "").replace(/\/$/, "");
  return menuOrigin?.short
    ? `${origin}/m/${encodeURIComponent(qrToken)}`
    : `${origin}/${encodeURIComponent(slug)}/m/${encodeURIComponent(qrToken)}`;
}
export function restaurantBrand<T extends {resellers: {primary_color: string}; primary_color?: string | null}>(restaurant: T): T["resellers"] {
  return {...restaurant.resellers, primary_color: restaurant.primary_color || restaurant.resellers.primary_color};
}
