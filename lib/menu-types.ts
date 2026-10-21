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
  /** Unidades restantes quando o item controla estoque; null quando não controla. */
  stock_left?: number | null;
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
  /** Nula no cardápio para consulta (raiz do domínio próprio). */
  table: { label: string } | null;
  consult?: boolean;
  /** Melhor endereço desta mesa (domínio próprio, da revenda ou padrão). */
  menu_url?: string;
  categories: { id: string; name: string }[];
  items: MenuItem[];
  open: boolean;
  authorized: boolean;
  calls?: ServiceCall[];
  /** Pesquisa de satisfação disponível para este celular (comanda fechada há menos de 24 h). */
  survey?: { guest_name: string; tab_id: string } | null;
  /** Assinatura do restaurante suspensa: só o aviso aparece. */
  suspended?: boolean;
};
export const SURVEY_TAGS = [
  "Rápido",
  "Demorou",
  "Comida ótima",
  "Comida fria",
  "Atendimento nota 10",
  "Pedido veio errado",
  "Ambiente agradável",
  "Preço justo",
] as const;
export type ServiceCallKind = "garcom" | "conta" | "ajuda";
export type ServiceCall = {
  id: string;
  kind: ServiceCallKind;
  created_at: string;
  mine: boolean;
};
export const CALL_LABELS: Record<ServiceCallKind, string> = {
  garcom: "Chamar garçom",
  conta: "Pedir a conta",
  ajuda: "Outro",
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
export type Station = "cozinha" | "bar";
export const STATION_LABELS: Record<Station, string> = {
  cozinha: "Cozinha",
  bar: "Bar",
};
export type CustomerOrder = {
  id: string;
  guest_id: string | null;
  status: string;
  prep_minutes: number;
  total_cents: number;
  created_at: string;
  /** Setor do pedido; envios com pratos e bebidas viram um pedido por setor. */
  station?: Station;
  batch_id?: string | null;
  order_items: {
    id: string;
    name_snapshot: string;
    unit_price_cents: number;
    quantity: number;
    note: string;
    modifiers_snapshot: { name: string }[];
    shared: boolean;
    cancelled_at?: string | null;
    cancel_reason?: string | null;
  }[];
};

const STATUS_RANK = ["recebido", "em_preparo", "pronto", "entregue"];
export type OrderGroup<T extends CustomerOrder> = {
  key: string;
  orders: T[];
  created_at: string;
  total_cents: number;
  /** Status geral: o menos avançado entre os setores ainda ativos. */
  status: string;
  prep_minutes: number;
  items: (T["order_items"][number] & { order_id: string; station?: Station })[];
};

/** Agrupa os pedidos de um envio (mesmo batch_id) para o cliente ver um só. */
export function groupOrders<T extends CustomerOrder>(orders: T[]): OrderGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const order of orders) {
    const key = order.batch_id ?? order.id;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const active = list.filter((o) => o.status !== "cancelado");
    const status = !active.length
      ? "cancelado"
      : active
          .map((o) => o.status)
          .toSorted((a, b) => STATUS_RANK.indexOf(a) - STATUS_RANK.indexOf(b))[0];
    return {
      key,
      orders: list,
      created_at: list.map((o) => o.created_at).toSorted()[0],
      total_cents: active.reduce((sum, o) => sum + o.total_cents, 0),
      status,
      prep_minutes: Math.max(...list.map((o) => o.prep_minutes)),
      items: list.flatMap((o) =>
        o.order_items.map((i) => ({ ...i, order_id: o.id, station: o.station })),
      ),
    };
  });
}

export type PaymentMethod = "pix" | "dinheiro" | "debito" | "credito" | "outro";
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  outro: "Outro",
};
/** Totais da comanda calculados pelo banco (public.tab_totals). */
export type TabTotals = {
  items_cents: number;
  fee_cents: number;
  fee_percent: number;
  fee_waived: boolean;
  discount_cents: number;
  discount_reason: string | null;
  due_cents: number;
  paid_cents: number;
  balance_cents: number;
};

/** Motivos de cancelamento oferecidos ao garçom e ao gestor. */
export const CANCEL_REASONS = [
  "Cliente desistiu",
  "Saiu errado",
  "Item acabou",
  "Outro",
] as const;
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
