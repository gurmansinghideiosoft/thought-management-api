/**
 * Fixed allow-list for file uploads.
 *
 * Only these MIME types may be stored. The list is deliberately in code, not
 * config — widening what the API accepts is a security decision that belongs in
 * review, not in an env var.
 */

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const ALLOWED_MIME_TYPES: readonly string[] = [
  ...IMAGE_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
];

export type FileCategory = 'image' | 'document';

/** `'image'` / `'document'` for an allowed type, `null` for anything else. */
export const fileCategoryFor = (mimeType: string): FileCategory | null => {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return 'image';
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) return 'document';
  return null;
};

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** Canonical file extension for an allowed MIME type (`''` if unknown). */
export const extensionForMimeType = (mimeType: string): string =>
  EXTENSIONS[mimeType] ?? '';
