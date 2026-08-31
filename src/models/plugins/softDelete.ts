import type { Query, Schema } from 'mongoose';

/**
 * Soft-delete plugin.
 *
 * Adds `deletedAt` / `deletedReason` to a schema and makes every read query
 * (`find*`, `countDocuments`) transparently exclude soft-deleted documents.
 *
 * To include them (trash views, restore), build the query then call
 * `.setOptions({ withDeleted: true })`.
 *
 * Note: aggregation pipelines are NOT filtered — add
 * `{ $match: { deletedAt: null } }` as the first stage yourself.
 *
 * The actual delete/restore writes live in the services as explicit
 * `updateMany` calls, so the lifecycle is visible where it happens.
 */
export const softDeletePlugin = (schema: Schema): void => {
  schema.add({
    deletedAt: { type: Date, default: null },
    deletedReason: {
      type: String,
      enum: ['direct', 'cascade'],
      default: null,
    },
  });

  schema.index({ deletedAt: 1 });

  function excludeDeleted(this: Query<unknown, unknown>): void {
    const options = this.getOptions() as { withDeleted?: boolean };
    if (options.withDeleted === true) return;
    if (!('deletedAt' in this.getFilter())) {
      this.where({ deletedAt: null });
    }
  }

  schema.pre(/^find/, excludeDeleted);
  schema.pre('countDocuments', excludeDeleted);
};
