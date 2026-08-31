import type { RequestHandler } from 'express';
import multer from 'multer';

import config from '../config/index.ts';
import { badRequest } from '../errors.ts';
import { ALLOWED_MIME_TYPES } from '../lib/mime.ts';

/**
 * Parses a single `file` field from a `multipart/form-data` request into
 * `req.file` (held in memory as a Buffer). Rejects anything outside the MIME
 * allow-list, and anything larger than `config.uploads.maxBytes` (multer raises
 * `LIMIT_FILE_SIZE`, which the error handler turns into a 413).
 */
export const uploadSingleFile: RequestHandler = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1,
    fields: 20,
    fieldSize: 64 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(badRequest(`Unsupported file type: ${file.mimetype}`));
    }
  },
}).single('file');
