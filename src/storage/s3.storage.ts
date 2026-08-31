import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  DownloadUrlOptions,
  PutObjectInput,
  StoragePort,
  StoredObjectMeta,
} from './types.ts';

export interface S3StorageOptions {
  region: string;
  bucket: string;
  endpoint?: string | undefined;
  forcePathStyle?: boolean | undefined;
}

const isNotFound = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  ('name' in err ? err.name === 'NotFound' || err.name === 'NoSuchKey' : false);

/** Strip anything that could break the `Content-Disposition` header. */
const safeFilename = (name: string): string =>
  name.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'download';

/**
 * S3-backed {@link StoragePort}. Works with AWS S3 and S3-compatible services
 * (MinIO, Cloudflare R2, …) via `endpoint` + `forcePathStyle`. Credentials come
 * from the standard AWS provider chain (`AWS_*` env vars, shared config, or an
 * instance/task role) — never from our own config.
 */
export class S3Storage implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? false,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async head(key: string): Promise<StoredObjectMeta | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeFilename(options.filename)}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.ttlSeconds });
  }
}
