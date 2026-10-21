// Períodos dos relatórios, do histórico e da satisfação (fuso America/Sao_Paulo).
// Compartilhado entre o painel (botões) e as rotas (validação e limite de 12 meses).

export const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Mês atual" },
  { key: "last_month", label: "Mês anterior" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

/** Data civil de São Paulo (AAAA-MM-DD) para um instante. */
export function saoPauloDate(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Início do dia civil (00:00 em São Paulo) como instante ISO. */
export function dayStart(day: string) {
  return `${day}T00:00:00-03:00`;
}

export function addDays(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

/** Intervalo [from, to) em dias civis para um período ou para datas livres. */
export function periodRange(period: string, from?: string, to?: string, now = new Date()) {
  const today = saoPauloDate(now);
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevMonthStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  switch (period) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "month":
      return { from: monthStart, to: addDays(today, 1) };
    case "last_month":
      return { from: prevMonthStart, to: monthStart };
    default: {
      const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today;
      const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? addDays(to, 1) : addDays(start, 1);
      return { from: start, to: end > start ? end : addDays(start, 1) };
    }
  }
}

export const DAY_LABEL = (day: string) =>
  new Date(dayStart(day)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
