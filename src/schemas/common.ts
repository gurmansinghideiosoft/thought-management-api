import { Types } from 'mongoose';
import { z } from 'zod';

/** A string that is a valid Mongo ObjectId. */
export const objectId = z
  .string()
  .refine((value) => Types.ObjectId.isValid(value), { message: 'Invalid id' });

/** Accepts an ISO date or date-time string; yields a `Date`. */
export const dateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date' })
  .transform((value) => new Date(value));

/** `?limit=` — 1..100, default 30. */
export const limitParam = z.coerce.number().int().min(1).max(100).default(30);

/** `?page=` — >= 1, default 1. */
export const pageParam = z.coerce.number().int().min(1).default(1);

/** Turns `"true"`/`"false"` (and real booleans) into a boolean. */
export const booleanParam = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Escape a user string for safe use inside a RegExp. */
export const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
