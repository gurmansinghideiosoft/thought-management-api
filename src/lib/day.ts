/** Day-string (`YYYY-MM-DD`) helpers. All comparisons are lexical. */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Server's current UTC day. Used as the past/future boundary when the client
 * doesn't supply its own `today`. */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Add `n` days to a `YYYY-MM-DD` string (n may be negative). */
export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Every day in `[from, to]` inclusive. Guards against absurd ranges. */
export const eachDay = (from: string, to: string): string[] => {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i += 1) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
};

/** First / last day of a `YYYY-MM` month. */
export const monthBounds = (month: string): { from: string; to: string } => {
  const from = `${month}-01`;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { from, to: end.toISOString().slice(0, 10) };
};
