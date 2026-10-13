export type QueueOrder = {
  id: string;
  created_at: string;
  prep_minutes: number;
  pinned: boolean;
};

export type QueueSettings = {
  mode: "fifo" | "complexity" | "balanced";
  weight_wait: number;
  weight_complexity: number;
  max_wait_minutes: number;
};

export function waitingMinutes(order: QueueOrder, now: number) {
  return Math.max(0, (now - Date.parse(order.created_at)) / 60_000);
}

export function isLate(order: QueueOrder, now: number) {
  return waitingMinutes(order, now) > order.prep_minutes + 5;
}

/** Pure ordering: pin, maximum wait, chosen rule, oldest, stable ID. */
export function sortQueue<T extends QueueOrder>(
  orders: readonly T[],
  settings: QueueSettings,
  now: number,
): T[] {
  return [...orders].sort((a, b) => {
    const pinned = Number(b.pinned) - Number(a.pinned);
    if (pinned) return pinned;
    const aw = waitingMinutes(a, now);
    const bw = waitingMinutes(b, now);
    const overdue =
      Number(bw > settings.max_wait_minutes) -
      Number(aw > settings.max_wait_minutes);
    if (overdue) return overdue;
    // Among overdue orders, serve the longest wait first.
    if (aw > settings.max_wait_minutes && bw > settings.max_wait_minutes)
      return bw - aw || a.id.localeCompare(b.id);
    if (settings.mode === "complexity" && a.prep_minutes !== b.prep_minutes)
      return b.prep_minutes - a.prep_minutes;
    if (settings.mode === "balanced") {
      const score =
        (bw - aw) * settings.weight_wait +
        (b.prep_minutes - a.prep_minutes) * settings.weight_complexity;
      if (score) return score;
    }
    return (
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id)
    );
  });
}
