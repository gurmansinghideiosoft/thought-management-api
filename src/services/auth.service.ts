import { AppError, conflict, notFoundError } from '../errors.ts';
import { signAccess, signRefresh, verifyRefresh } from '../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { TokenDenylist } from '../models/tokenDenylist.model.ts';
import { User, type UserDocument } from '../models/user.model.ts';

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
  name?: string;
}): Promise<AuthResult> => {
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) {
    throw conflict('An account with that email already exists');
  }
  const user = await User.create({
    email,
    passwordHash: await hashPassword(input.password),
    name: input.name ?? '',
  });
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
