/** Minimal RFC-4180 CSV writer. */

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/**
 * Render `rows` as CSV with the given `columns` as both the header and the key
 * order. Missing keys become empty cells. Lines are `\r\n`-terminated.
 */
export const toCsv = (rows: Record<string, unknown>[], columns: string[]): string => {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => cell(row[col])).join(','));
  }
  return lines.join('\r\n');
};
