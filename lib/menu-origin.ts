// Endereço público do cardápio de um restaurante (spec-fase2.md, seção 7):
// domínio próprio do restaurante ativo > domínio da revenda ativo > URL do
// projeto público. QR codes impressos com a URL antiga continuam válidos.

type ResellerDomain = { domain?: string | null; domain_status?: string | null };
export type DomainBearer = {
  slug: string;
  custom_domain?: string | null;
  custom_domain_status?: string | null;
  // O Supabase tipa a junção ora como objeto, ora como lista.
  resellers?: ResellerDomain | ResellerDomain[] | null;
};

export function menuOrigin(restaurant: DomainBearer) {
  const reseller = Array.isArray(restaurant.resellers) ? restaurant.resellers[0] : restaurant.resellers;
  if (restaurant.custom_domain && restaurant.custom_domain_status === "active")
    return { origin: `https://${restaurant.custom_domain}`, short: true, kind: "restaurant" as const };
  if (reseller?.domain && reseller.domain_status === "active")
    return { origin: `https://${reseller.domain}`, short: false, kind: "reseller" as const };
  return { origin: (process.env.NEXT_PUBLIC_MENU_URL || "").replace(/\/$/, ""), short: false, kind: "default" as const };
}

/** URL da mesa no melhor endereço disponível. */
export function tableUrl(restaurant: DomainBearer, qrToken: string) {
  const { origin, short } = menuOrigin(restaurant);
  return short
    ? `${origin}/m/${encodeURIComponent(qrToken)}`
    : `${origin}/${encodeURIComponent(restaurant.slug)}/m/${encodeURIComponent(qrToken)}`;
}
