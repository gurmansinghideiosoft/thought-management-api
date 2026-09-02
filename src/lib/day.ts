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

/** The `YYYY-MM` month a `YYYY-MM-DD` day belongs to. */
export const monthKey = (day: string): string => day.slice(0, 7);

/** Monday…Sunday bounds of the week that contains `day`. */
export const weekBounds = (day: string): { from: string; to: string } => {
  const dow = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const from = addDays(day, -dow);
  return { from, to: addDays(from, 6) };
};

/** ISO-8601 week key for `day`, e.g. `2026-W36`. The ISO week-numbering year
 * can differ from the calendar year around New Year, so it's derived here too. */
export const isoWeekKey = (day: string): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  // Shift to the Thursday of this week — its calendar year is the ISO year.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
};
