import { model, Schema } from 'mongoose';

export interface TokenDenylistAttrs {
  /** The `jti` claim of a revoked access or refresh token. */
  jti: string;
  /** The token's own expiry — after this, the entry is pointless. */
  expiresAt: Date;
}

const tokenDenylistSchema = new Schema<TokenDenylistAttrs>(
  {
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL index: MongoDB removes each entry shortly after its `expiresAt` passes,
// so the collection self-cleans and never needs pruning.
tokenDenylistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TokenDenylist = model<TokenDenylistAttrs>(
  'TokenDenylist',
  tokenDenylistSchema,
);
