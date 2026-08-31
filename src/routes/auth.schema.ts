import { z } from 'zod';

export const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(100).optional(),
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
