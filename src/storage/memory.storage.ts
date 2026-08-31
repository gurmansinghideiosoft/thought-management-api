import type {
  DownloadUrlOptions,
  PutObjectInput,
  StoragePort,
  StoredObjectMeta,
} from './types.ts';

interface MemoryObject {
  body: Buffer;
  contentType: string;
}

/**
 * In-memory implementation of {@link StoragePort}. Everything lives in a `Map`
 * and is lost on restart. Used by the test suite and by local dev when no S3 is
 * configured. Extra non-interface methods (`clear`, `get`, `size`) exist for
 * tests to seed and inspect.
 */
export class MemoryStorage implements StoragePort {
  private readonly objects = new Map<string, MemoryObject>();

  put({ key, body, contentType }: PutObjectInput): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  head(key: string): Promise<StoredObjectMeta | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object ? { size: object.body.byteLength, contentType: object.contentType } : null,
    );
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    const query = new URLSearchParams({
      filename: options.filename,
      expires: String(options.ttlSeconds),
    });
    return Promise.resolve(`http://memory-storage.local/${key}?${query.toString()}`);
  }

  // --- test helpers ---------------------------------------------------------

  clear(): void {
    this.objects.clear();
  }

  get(key: string): Buffer | undefined {
    return this.objects.get(key)?.body;
  }

  get size(): number {
    return this.objects.size;
  }
}
