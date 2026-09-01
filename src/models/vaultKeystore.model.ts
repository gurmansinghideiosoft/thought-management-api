import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

/** Argon2id parameters the client used to derive the master key. Public. */
export interface KdfParams {
  /** Memory cost, KiB. */
  m: number;
  /** Time cost (iterations). */
  t: number;
  /** Parallelism. */
  p: number;
}

/**
 * The per-user vault wrapper. Everything here is opaque to the server: the
 * `kdfSalt` is a plain salt, and `protectedKey` / `verifier` are ciphertext the
 * server can never decrypt. There is no server-held secret.
 */
export interface VaultKeystoreAttrs {
  ownerId: Types.ObjectId;
  /** base64 random salt for the client's Argon2id derivation. */
  kdfSalt: string;
  kdfParams: KdfParams;
  /** base64 `iv‖wrap(vaultKey, masterKey)`. */
  protectedKey: string;
  /** base64 `AES-GCM(vaultKey, "thought-vault")` — an unlock sanity check. */
  verifier: string;
  createdAt: Date;
  updatedAt: Date;
}

export type VaultKeystoreDocument = HydratedDocument<VaultKeystoreAttrs>;

const vaultKeystoreSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    kdfSalt: { type: String, required: true, maxlength: 512 },
    kdfParams: {
      m: { type: Number, required: true },
      t: { type: Number, required: true },
      p: { type: Number, required: true },
    },
    protectedKey: { type: String, required: true, maxlength: 4096 },
    verifier: { type: String, required: true, maxlength: 4096 },
  },
  { timestamps: true, minimize: false },
);

withJsonId(vaultKeystoreSchema);

export const VaultKeystore = model<VaultKeystoreAttrs>(
  'VaultKeystore',
  vaultKeystoreSchema,
);
