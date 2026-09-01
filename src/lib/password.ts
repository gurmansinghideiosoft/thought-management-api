import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with argon2id.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet baseline
 * (~19 MiB memory, 2 iterations). `@node-rs/argon2` ships prebuilt binaries, so
 * there is no native build step.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> => hash(plain, OPTIONS);

/** Never throws — a malformed stored hash simply fails to verify. */
export const verifyPassword = (storedHash: string, plain: string): Promise<boolean> =>
  verify(storedHash, plain).catch(() => false);
