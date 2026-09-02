import { AppError, conflict, notFoundError } from '../errors.ts';
import { signAccess, signRefresh, verifyRefresh } from '../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { TokenDenylist } from '../models/tokenDenylist.model.ts';
import { User, type UserDocument } from '../models/user.model.ts';
import { bindPendingInvites } from './thoughtShare.service.ts';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export interface AuthResult extends AuthTokens {
  user: UserDocument;
}

const INVALID_CREDENTIALS = new AppError('Invalid email or password', 401);
const INVALID_TOKEN = new AppError('Invalid or expired token', 401);

// A real hash to verify against when the email is unknown, so login takes the
// same time whether or not the account exists (no user-enumeration by timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword('timing-attack-mitigation'));

const issueTokens = (userId: string): AuthTokens => ({
  accessToken: signAccess(userId).token,
  refreshToken: signRefresh(userId).token,
});

// --- denylist -------------------------------------------------------------

const blacklist = async (jti: string, expEpochSeconds: number): Promise<void> => {
  await TokenDenylist.updateOne(
    { jti },
    { $setOnInsert: { jti, expiresAt: new Date(expEpochSeconds * 1000) } },
    { upsert: true },
  );
};

export const isBlacklisted = async (jti: string): Promise<boolean> =>
  (await TokenDenylist.exists({ jti })) !== null;

// --- flows -------------------------------------------------------------

export const register = async (input: {
  email: string;
  password: string;
  username: string;
  name?: string;
}): Promise<AuthResult> => {
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();
  if (await User.exists({ email })) {
    throw conflict('An account with that email already exists');
  }
  if (await User.exists({ username })) {
    throw conflict('That username is taken');
  }

  // A lost race on either unique index surfaces as a 409 via the error handler.
  const user = await User.create({
    email,
    username,
    passwordHash: await hashPassword(input.password),
    name: input.name ?? '',
  });
  // Attach any thought invites that were sent to this email before signup.
  await bindPendingInvites(user);
  return { user, ...issueTokens(String(user._id)) };
};

/** Is this handle free? (Used by the sign-up form's live check.) */
export const isUsernameAvailable = async (username: string): Promise<boolean> =>
  (await User.exists({ username: username.toLowerCase() })) === null;

/** Set or change the caller's profile fields (username, name, banner choices). */
export const updateProfile = async (
  userId: string,
  patch: {
    username?: string;
    name?: string;
    homeBanner?: string | null;
    journalBanner?: string | null;
    currency?: string;
  },
): Promise<UserDocument> => {
  const user = await User.findById(userId);
  if (!user) throw notFoundError('User not found');

  if (patch.username !== undefined) {
    const username = patch.username.toLowerCase();
    if (username !== user.username) {
      if (await User.exists({ username })) throw conflict('That username is taken');
      user.username = username;
    }
  }
  if (patch.name !== undefined) user.name = patch.name;
  if (patch.homeBanner !== undefined) user.homeBanner = patch.homeBanner;
  if (patch.journalBanner !== undefined) user.journalBanner = patch.journalBanner;
  if (patch.currency !== undefined) user.currency = patch.currency;

  await user.save();
  return user;
};

/**
 * Change the caller's password. Returns a fresh token pair so the current
 * device stays signed in; `passwordChangedAt` invalidates every other token.
 */
export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFoundError('User not found');

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError('Current password is incorrect', 400);
  }
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw new AppError('New password must be different from the current one', 400);
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();

  return { user, ...issueTokens(String(user._id)) };
};

export const login = async (input: {
  email: string;
  password: string;
}): Promise<AuthResult> => {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select(
    '+passwordHash',
  );
  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    throw INVALID_CREDENTIALS;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw INVALID_CREDENTIALS;
  }
  return { user, ...issueTokens(String(user._id)) };
};

export const refresh = async (refreshToken: string): Promise<AuthTokens> => {
  const claims = verifyRefresh(refreshToken);
  if (await isBlacklisted(claims.jti)) throw INVALID_TOKEN;

  // Rotation: this refresh token is now spent.
  await blacklist(claims.jti, claims.exp);

  if (!(await User.exists({ _id: claims.sub }))) throw INVALID_TOKEN;
  return issueTokens(claims.sub);
};

export const logout = async (input: {
  accessJti: string;
  accessExp: number;
  refreshToken?: string;
}): Promise<void> => {
  await blacklist(input.accessJti, input.accessExp);
  if (input.refreshToken) {
    try {
      const claims = verifyRefresh(input.refreshToken);
      await blacklist(claims.jti, claims.exp);
    } catch {
      // An already-invalid refresh token needs no blacklisting.
    }
  }
};

export const getMe = async (userId: string): Promise<UserDocument> => {
  const user = await User.findById(userId);
  if (!user) throw notFoundError('User not found');
  return user;
};
