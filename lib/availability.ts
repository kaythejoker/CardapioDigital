// Janela de horário de item e categoria (spec-fase3.md, seção 2). Espelha
// private.within_hours: fuso de São Paulo, fim exclusivo, pode virar a meia-noite.

/** "11:00" ou "11:00:00" em minutos do dia. */
function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function saoPauloMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

export function withinHours(
  from: string | null | undefined,
  until: string | null | undefined,
  now: Date,
) {
  if (!from || !until) return true;
  const n = saoPauloMinutes(now);
  const a = minutes(from);
  const b = minutes(until);
  return a < b ? n >= a && n < b : n >= a || n < b;
}

/** "11:00:00" → "11:00". */
export const shortTime = (time: string | null | undefined) => (time ? time.slice(0, 5) : "");

export type Availability = {
  blocked?: boolean;
  blocked_reason?: string | null;
  available_from?: string | null;
  available_until?: string | null;
};

/** Por que o item não pode ser pedido agora (null = pode). */
export function unavailable(
  item: Availability,
  category: Availability | undefined,
  now: Date,
): { kind: "blocked"; reason: string | null } | { kind: "hours"; from: string; until: string } | null {
  for (const source of [category, item]) {
    if (source?.blocked) return { kind: "blocked", reason: source.blocked_reason ?? null };
  }
  for (const source of [category, item]) {
    if (source && !withinHours(source.available_from, source.available_until, now))
      return {
        kind: "hours",
        from: shortTime(source.available_from),
        until: shortTime(source.available_until),
      };
  }
  return null;
}
