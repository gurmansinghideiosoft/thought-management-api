/** Task priority: 1 is the most urgent, 5 the least. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: 'No chance to miss',
  2: 'Important',
  3: 'Valuable',
  4: 'Good to do',
  5: 'Can be skipped',
};

export const isPriority = (value: number): value is Priority =>
  (PRIORITIES as readonly number[]).includes(value);
