import type { Types } from 'mongoose';

import type { UserDocument } from '../models/user.model.ts';

/** The only user fields other people are allowed to see. */
export interface PublicUser {
  id: string;
  username: string | null;
  name: string;
}

type UserLike = Pick<UserDocument, 'username' | 'name'> & {
  _id: Types.ObjectId | string;
};

export const toPublicUser = (user: UserLike): PublicUser => ({
  id: String(user._id),
  username: user.username ?? null,
  name: user.name,
});
