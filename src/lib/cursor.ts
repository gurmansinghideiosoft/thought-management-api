import { AppError } from '../errors.ts';

/**
 * Opaque pagination cursors for keyset (a.k.a. "seek") pagination.
 *
 * A cursor points at one row by its `(createdAt, _id)` pair — `_id` breaks ties
 * when two rows share a millisecond. Keyset pagination stays correct while rows
 * are inserted/removed, unlike `skip`/`offset`. This is what makes the
 * "scroll up to load older messages" timeline reliable.
 */

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export const encodeCursor = (createdAt: Date, id: string): string => {
  const json = JSON.stringify({ t: createdAt.toISOString(), i: id });
  return Buffer.from(json, 'utf8').toString('base64url');
};

export const decodeCursor = (raw: string): CursorPosition => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid pagination cursor', 400);
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new AppError('Invalid pagination cursor', 400);
  }
  const { t, i } = parsed as Record<string, unknown>;
  const createdAt = typeof t === 'string' ? new Date(t) : new Date(Number.NaN);
  if (typeof i !== 'string' || Number.isNaN(createdAt.getTime())) {
    throw new AppError('Invalid pagination cursor', 400);
  }
  return { createdAt, id: i };
};

type Direction = 'before' | 'after';

/**
 * A MongoDB filter clause selecting rows strictly older (`before`) or newer
 * (`after`) than `pos`, under `(createdAt, _id)` ordering. `id` is passed
 * through verbatim so the caller can hand in an `ObjectId`.
 */
export const keysetClause = (
  direction: Direction,
  pos: { createdAt: Date; id: unknown },
): Record<string, unknown> => {
  const op = direction === 'before' ? '$lt' : '$gt';
  return {
    $or: [
      { createdAt: { [op]: pos.createdAt } },
      { createdAt: pos.createdAt, _id: { [op]: pos.id } },
    ],
  };
};

/** Sort spec matching `keysetClause` for the given direction. */
export const keysetSort = (direction: Direction): Record<string, 1 | -1> =>
  direction === 'before' ? { createdAt: -1, _id: -1 } : { createdAt: 1, _id: 1 };
