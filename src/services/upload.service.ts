import { randomUUID } from 'node:crypto';

import config from '../config/index.ts';
import { badRequest } from '../errors.ts';
import { extensionForMimeType, fileCategoryFor } from '../lib/mime.ts';
import type { EntryFile } from '../models/entry.model.ts';
import { storage } from '../storage/index.ts';

/** How long a generated download URL stays valid. */
const DOWNLOAD_TTL_SECONDS = 5 * 60;

export interface IncomingFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * Validates an uploaded file, writes it to the storage backend, and returns the
 * `file` subdocument to embed on an entry. The object key is random — the
 * client-supplied name is never used to build a path.
 */
export const storeUpload = async (
  thoughtId: string,
  file: IncomingFile,
): Promise<EntryFile> => {
  const category = fileCategoryFor(file.mimeType);
  if (category === null) {
    throw badRequest(`Unsupported file type: ${file.mimeType}`);
  }

  const key = `${config.uploads.keyPrefix}${thoughtId}/${randomUUID()}${extensionForMimeType(
    file.mimeType,
  )}`;
  const bucket = config.storage.s3?.bucket ?? 'memory';

  await storage.put({ key, body: file.buffer, contentType: file.mimeType });

  return {
    key,
    bucket,
    originalName: file.originalName,
    contentType: file.mimeType,
    size: file.size,
    category,
  };
};

/** A short-lived URL the client can use to download a stored file. */
export const downloadUrlFor = (file: EntryFile): Promise<string> =>
  storage.getDownloadUrl(file.key, {
    filename: file.originalName,
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
  });
