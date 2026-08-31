// Ambient augmentation: `requireAuth` attaches the verified token to the request.
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        jti: string;
        /** Access-token expiry (epoch seconds) — used when blacklisting on logout. */
        exp: number;
      };
    }
  }
}

export {};
