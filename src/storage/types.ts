/**
 * Storage abstraction for uploaded files.
 *
 * The rest of the app depends only on this interface. `S3Storage` backs it in
 * production; `MemoryStorage` backs it in tests and in local dev without S3.
 */

export interface StoredObjectMeta {
  size: number;
  contentType: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface DownloadUrlOptions {
  /** Suggested filename for the browser's "Save as" dialog. */
  filename: string;
  ttlSeconds: number;
}

export interface StoragePort {
  put(input: PutObjectInput): Promise<void>;
  head(key: string): Promise<StoredObjectMeta | null>;
  delete(key: string): Promise<void>;
  /** A short-lived URL the client can GET to download the object. */
  getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string>;
}
