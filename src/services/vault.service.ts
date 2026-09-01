import { Types } from 'mongoose';

import { conflict, notFoundError } from '../errors.ts';
import {
  Credential,
  type CredentialCategory,
  type CredentialDocument,
} from '../models/credential.model.ts';
import {
  VaultKeystore,
  type KdfParams,
  type VaultKeystoreDocument,
} from '../models/vaultKeystore.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

// --- keystore ---------------------------------------------------------

export interface KeystoreInput {
  kdfSalt: string;
  kdfParams: KdfParams;
  protectedKey: string;
  verifier: string;
}

export const getKeystore = (ownerId: string): Promise<VaultKeystoreDocument | null> =>
  VaultKeystore.findOne({ ownerId: owner(ownerId) });

export const setupVault = async (
  ownerId: string,
  input: KeystoreInput,
): Promise<VaultKeystoreDocument> => {
  if (await VaultKeystore.exists({ ownerId: owner(ownerId) })) {
    throw conflict('A vault already exists for this account');
  }
  return VaultKeystore.create({ ownerId: owner(ownerId), ...input });
};

/** Replace the wrapper — used when the master password changes. */
export const rekeyVault = async (
  ownerId: string,
  input: KeystoreInput,
): Promise<VaultKeystoreDocument> => {
  const keystore = await VaultKeystore.findOneAndUpdate(
    { ownerId: owner(ownerId) },
    { $set: input },
    { new: true },
  );
  if (!keystore) throw notFoundError('No vault to re-key');
  return keystore;
};

/** The "I forgot my master password" escape hatch — wipes everything. */
export const resetVault = async (ownerId: string): Promise<void> => {
  const oid = owner(ownerId);
  await Promise.all([
    VaultKeystore.deleteOne({ ownerId: oid }),
    Credential.deleteMany({ ownerId: oid }),
  ]);
};

// --- credentials -----------------------------------------------------

export interface CredentialMeta {
  id: string;
  name: string;
  category: CredentialCategory;
  tags: string[];
  updatedAt: string;
}

const toMeta = (doc: CredentialDocument): CredentialMeta => ({
  id: String(doc._id),
  name: doc.name,
  category: doc.category,
  tags: doc.tags,
  updatedAt: doc.updatedAt.toISOString(),
});

export const listCredentials = async (ownerId: string): Promise<CredentialMeta[]> => {
  const docs = await Credential.find({ ownerId: owner(ownerId) })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 });
  return docs.map(toMeta);
};

export const getCredentialOrThrow = async (
  ownerId: string,
  id: string,
): Promise<CredentialDocument> => {
  const doc = await Credential.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!doc) throw notFoundError('Credential not found');
  return doc;
};

export interface CredentialInput {
  name: string;
  category: CredentialCategory;
  tags: string[];
  cipher: string;
}

export const createCredential = (
  ownerId: string,
  input: CredentialInput,
): Promise<CredentialDocument> =>
  Credential.create({ ownerId: owner(ownerId), ...input });

export const updateCredential = async (
  ownerId: string,
  id: string,
  patch: Partial<CredentialInput>,
): Promise<CredentialDocument> => {
  const doc = await getCredentialOrThrow(ownerId, id);
  if (patch.name !== undefined) doc.name = patch.name;
  if (patch.category !== undefined) doc.category = patch.category;
  if (patch.tags !== undefined) doc.tags = patch.tags;
  if (patch.cipher !== undefined) doc.cipher = patch.cipher;
  await doc.save();
  return doc;
};

export const deleteCredential = async (ownerId: string, id: string): Promise<void> => {
  const doc = await getCredentialOrThrow(ownerId, id);
  await doc.deleteOne();
};
