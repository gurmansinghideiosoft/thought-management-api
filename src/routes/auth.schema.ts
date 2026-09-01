import { z } from 'zod';

/** Public handle: 3–30 chars, lowercase letters / digits / underscore. */
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, 'Use 3–30 letters, digits or underscores');

export const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
  username,
  name: z.string().trim().max(100).optional(),
});

export const updateMeBody = z
  .object({
    username: username.optional(),
    name: z.string().trim().max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export const loginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(10),
});

export const logoutBody = z.object({
  refreshToken: z.string().min(10).optional(),
});
