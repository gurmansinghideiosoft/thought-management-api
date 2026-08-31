import type { Schema } from 'mongoose';

/**
 * Makes `toJSON()` emit `id` (a string) instead of `_id`, and drop `__v`.
 * Applied to every schema — including embedded subdocuments — so API responses
 * are consistent.
 */
export const withJsonId = (schema: Schema): void => {
  schema.set('toJSON', {
    versionKey: false,
    transform(_doc, ret: Record<string, unknown>) {
      if (ret._id !== undefined) {
        ret.id = String(ret._id);
        delete ret._id;
      }
      return ret;
    },
  });
};
