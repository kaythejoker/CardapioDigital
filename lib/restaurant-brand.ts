/** Public menu links always point at the independently deployed customer project. */
export function publicMenuUrl(slug: string, qrToken: string) {
  const origin = (process.env.NEXT_PUBLIC_MENU_URL || "").replace(/\/$/, "");
  return `${origin}/${encodeURIComponent(slug)}/m/${encodeURIComponent(qrToken)}`;
}
export function restaurantBrand<T extends {resellers: {primary_color: string}; primary_color?: string | null}>(restaurant: T): T["resellers"] {
  return {...restaurant.resellers, primary_color: restaurant.primary_color || restaurant.resellers.primary_color};
}
