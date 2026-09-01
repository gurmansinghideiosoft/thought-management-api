import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const CREDENTIAL_CATEGORIES = ['login', 'api', 'note', 'other'] as const;
export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

/**
 * One saved credential. Only `name` / `category` / `tags` are plaintext — enough
 * to list and filter without unlocking. Everything sensitive (usernames,
 * passwords, keys, tokens, URL, notes) lives inside `cipher`, which is
 * `AES-GCM(vaultKey, JSON.stringify(payload))` produced in the browser and
 * never read by the server.
 */
export interface CredentialAttrs {
  ownerId: Types.ObjectId;
  name: string;
  category: CredentialCategory;
  tags: string[];
  /** base64 `iv‖ciphertext`. Opaque. */
  cipher: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CredentialDocument = HydratedDocument<CredentialAttrs>;

const credentialSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    category: { type: String, enum: CREDENTIAL_CATEGORIES, default: 'login' },
    tags: { type: [String], default: [] },
    // ~20 KB of plaintext ≈ 27 KB base64; allow headroom.
    cipher: { type: String, required: true, maxlength: 30_000 },
  },
  { timestamps: true },
);

withJsonId(credentialSchema);

credentialSchema.index({ ownerId: 1, name: 1 });
credentialSchema.index({ ownerId: 1, updatedAt: -1 });

export const Credential = model<CredentialAttrs>('Credential', credentialSchema);
