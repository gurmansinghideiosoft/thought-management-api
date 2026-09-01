import { model, Schema, type HydratedDocument } from 'mongoose';

export interface UserAttrs {
  email: string;
  passwordHash: string;
  name: string;
  /**
   * Unique public handle (`a-z0-9_`, 3–30). Nullable only for accounts created
   * before usernames existed — the client forces them to pick one on next load.
   */
  username: string | null;
  /** Chosen hero-banner id (from the frontend's fixed list); `null` = default. */
  homeBanner: string | null;
  journalBanner: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttrs>;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // Never selected by default — callers that need it must `.select('+passwordHash')`.
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, trim: true, maxlength: 100, default: '' },
    username: {
      type: String,
      // `sparse` so the many legacy `null` usernames don't collide on the index.
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
      default: null,
    },
    homeBanner: { type: String, maxlength: 64, default: null },
    journalBanner: { type: String, maxlength: 64, default: null },
  },
  { timestamps: true },
);

// `id` instead of `_id`, no `__v`, and the hash never leaves the process.
userSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret: Record<string, unknown>) {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.passwordHash;
    return ret;
  },
});

export const User = model<UserAttrs>('User', userSchema);
