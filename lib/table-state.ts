// Cor de cada mesa no mapa do salão, pedida pelos sócios para o piloto:
// 🟢 livre • 🔴 ocupada • 🟠 em fechamento (pediu a conta)
// 🔵 ociosa (10 minutos sem fazer pedido).
// "Atrasada" e "Chamando" continuam como selo e anel por cima da cor.
export const IDLE_MINUTES = 10;

export type TableState = "free" | "occupied" | "closing" | "idle";

type Tab = { id: string; opened_at: string };
type Order = { tab_id: string; created_at: string };

/** Momento do último pedido da comanda (ou da abertura, se ainda não pediu). */
export function lastActivity(tab: Tab, orders: Order[]) {
  return orders
    .filter((o) => o.tab_id === tab.id)
    .reduce(
      (latest, o) => Math.max(latest, Date.parse(o.created_at)),
      Date.parse(tab.opened_at),
    );
}

export function tableState(
  tab: Tab | undefined,
  orders: Order[],
  now: number,
  billRequested: boolean,
): TableState {
  if (!tab) return "free";
  if (billRequested) return "closing";
  if (now > 0 && now - lastActivity(tab, orders) >= IDLE_MINUTES * 60_000)
    return "idle";
  return "occupied";
}
