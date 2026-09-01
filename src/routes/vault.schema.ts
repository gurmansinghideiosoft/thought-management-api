import { z } from 'zod';

import { CREDENTIAL_CATEGORIES } from '../models/credential.model.ts';
import { objectId } from '../schemas/common.ts';

/** Standard base64 (with optional `=` padding), size-capped. Opaque to us. */
const b64 = (max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64')
    .max(max);

const kdfParams = z.object({
  m: z.number().int().min(8192).max(262144),
  t: z.number().int().min(1).max(10),
  p: z.number().int().min(1).max(4),
});

export const keystoreBody = z.object({
  kdfSalt: b64(512),
  kdfParams,
  protectedKey: b64(4096),
  verifier: b64(4096),
});

const category = z.enum(CREDENTIAL_CATEGORIES);
const tagList = z.array(z.string().trim().toLowerCase().min(1).max(24)).max(10);
const name = z.string().trim().min(1).max(120);
const cipher = b64(30_000);

export const createCredentialBody = z.object({
  name,
  category: category.default('login'),
  tags: tagList.default([]),
  cipher,
});

export const updateCredentialBody = z
  .object({
    name: name.optional(),
    category: category.optional(),
    tags: tagList.optional(),
    cipher: cipher.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export const credentialParams = z.object({ id: objectId });
