import { model, Schema, type HydratedDocument } from 'mongoose';

export interface UserAttrs {
  email: string;
  passwordHash: string;
  name: string;
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
