export type Modifier = {
  id: string;
  name: string;
  price_cents: number;
  position: number;
};
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  position: number;
  modifiers: Modifier[];
};
export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  photo_url: string | null;
  prep_minutes: number;
  featured: boolean;
  modifier_groups: ModifierGroup[];
};
export type MenuData = {
  restaurant: {
    name: string;
    logo_url: string | null;
    cover_url: string | null;
    primary_color?: string | null;
    background_color?: string | null;
    resellers: {
      brand_name: string;
      logo_url: string | null;
      primary_color: string;
    };
  };
  table: { label: string };
  categories: { id: string; name: string }[];
  items: MenuItem[];
  open: boolean;
  authorized: boolean;
};
export type CartLine = {
  key: string;
  item_id: string;
  quantity: number;
  note: string;
  modifier_ids: string[];
  /** Dividido igualmente com quem está na comanda. */
  shared: boolean;
};
export type CustomerOrder = {
  id: string;
  guest_id: string | null;
  status: string;
  prep_minutes: number;
  total_cents: number;
  created_at: string;
  order_items: {
    id: string;
    name_snapshot: string;
    unit_price_cents: number;
    quantity: number;
    note: string;
    modifiers_snapshot: { name: string }[];
    shared: boolean;
  }[];
};
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export function brandForeground(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    ? "#1E1A16"
    : "#FFFFFF";
}
