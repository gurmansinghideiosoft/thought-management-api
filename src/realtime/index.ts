import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';

import config from '../config/index.ts';
import { verifyAccess } from '../lib/jwt.ts';
import { type PublicUser, toPublicUser } from '../lib/publicUser.ts';
import { Conversation } from '../models/conversation.model.ts';
import { User } from '../models/user.model.ts';
import { isBlacklisted } from '../services/auth.service.ts';
import { assertMember } from '../services/conversation.service.ts';

/**
 * The realtime push layer. REST is the source of truth for every write; this
 * only fans changes out to connected clients and relays ephemeral
 * typing / presence signals. `getIo()` is `null` until `initRealtime` runs
 * (it never does under the test harness), so services guard their emits with
 * `getIo()?.…` and stay fully functional without it.
 */

let io: Server | null = null;
// Set while shutting down so late `disconnect` handlers don't touch a closing DB.
let closing = false;

export const getIo = (): Server | null => io;

export const roomForConversation = (id: string): string => `conv:${id}`;
export const roomForUser = (id: string): string => `user:${id}`;

// userId -> live socket ids. Single-process only; a multi-process deployment
// would need the socket.io Redis adapter.
const online = new Map<string, Set<string>>();
const addSocket = (userId: string, socketId: string): void => {
  let set = online.get(userId);
  if (!set) {
    set = new Set();
    online.set(userId, set);
  }
  set.add(socketId);
};
const removeSocket = (userId: string, socketId: string): boolean => {
  const set = online.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    online.delete(userId);
    return true; // that was their last connection
  }
  return false;
};
export const isUserOnline = (userId: string): boolean => online.has(userId);

// In-flight presence queries — `closeRealtime` waits these out so a `disconnect`
// handler can't touch the DB after it has been torn down.
const pendingWork = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>): void => {
  pendingWork.add(p);
  void p.finally(() => pendingWork.delete(p));
};

/** Tell this user's DM partners that they came online / went offline. */
const broadcastPresence = async (userId: string, isOnline: boolean): Promise<void> => {
  if (!io || closing) return;
  const dms = await Conversation.find({ kind: 'dm', memberIds: userId }).select(
    'memberIds',
  );
  const peers = new Set(
    dms.flatMap((c) => c.memberIds.map(String)).filter((id) => id !== userId),
  );
  for (const peerId of peers) {
    io.to(roomForUser(peerId)).emit('presence', { userId, online: isOnline });
  }
};

interface JoinPayload {
  id: string;
}
type Ack = (response: { ok: boolean; error?: string }) => void;

const wireSocket = (socket: Socket, userId: string, self: PublicUser): void => {
  void socket.join(roomForUser(userId));

  socket.on('conversation:join', (payload: JoinPayload, ack?: Ack) => {
    void (async () => {
      try {
        await assertMember(payload.id, userId);
        await socket.join(roomForConversation(payload.id));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'forbidden' });
      }
    })();
  });

  socket.on('conversation:leave', (payload: JoinPayload) => {
    void socket.leave(roomForConversation(payload.id));
  });

  const relayTyping = (payload: JoinPayload, isTyping: boolean): void => {
    const room = roomForConversation(payload.id);
    if (!socket.rooms.has(room)) return; // only members of a joined room
    socket.to(room).emit('typing', {
      conversationId: payload.id,
      user: self,
      isTyping,
    });
  };
  socket.on('typing:start', (payload: JoinPayload) => relayTyping(payload, true));
  socket.on('typing:stop', (payload: JoinPayload) => relayTyping(payload, false));

  socket.on('disconnect', () => {
    if (removeSocket(userId, socket.id)) track(broadcastPresence(userId, false));
  });
};

export const initRealtime = (httpServer: HttpServer): Server => {
  closing = false;
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    void (async () => {
      try {
        const token = socket.handshake.auth?.token as unknown;
        if (typeof token !== 'string') throw new Error('missing token');
        const claims = verifyAccess(token);
        if (await isBlacklisted(claims.jti)) throw new Error('revoked');
        const user = await User.findById(claims.sub);
        if (!user) throw new Error('unknown user');
        socket.data.userId = claims.sub;
        socket.data.user = toPublicUser(user);
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    })();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    const self = socket.data.user as PublicUser;
    const wasOffline = !online.has(userId);
    addSocket(userId, socket.id);
    wireSocket(socket, userId, self);
    if (wasOffline) track(broadcastPresence(userId, true));
  });

  return io;
};

export const closeRealtime = async (): Promise<void> => {
  closing = true;
  if (io) {
    // Drop every socket first so no `disconnect` handler races the close.
    io.disconnectSockets(true);
    await io.close();
    io = null;
  }
  // Let any presence query that already started finish before the DB goes away.
  await Promise.allSettled([...pendingWork]);
  online.clear();
};
