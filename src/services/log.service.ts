import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { todayUtc } from '../lib/day.ts';
import { LogEntry, type LogEntryDocument } from '../models/logEntry.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export const listLog = (
  ownerId: string,
  date: string = todayUtc(),
): Promise<LogEntryDocument[]> =>
  LogEntry.find({ ownerId: owner(ownerId), date })
    .sort({ createdAt: 1, _id: 1 })
    .limit(500);

export const createLog = (
  ownerId: string,
  text: string,
  date: string = todayUtc(),
): Promise<LogEntryDocument> =>
  LogEntry.create({ ownerId: owner(ownerId), text: text.trim(), date });

export const getLogOrThrow = async (
  ownerId: string,
  id: string,
): Promise<LogEntryDocument> => {
  const doc = await LogEntry.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!doc) throw notFoundError('Log entry not found');
  return doc;
};

export const updateLog = async (
  ownerId: string,
  id: string,
  patch: { text?: string; date?: string },
): Promise<LogEntryDocument> => {
  const doc = await getLogOrThrow(ownerId, id);
  if (patch.text !== undefined) doc.text = patch.text.trim();
  if (patch.date !== undefined) doc.date = patch.date;
  await doc.save();
  return doc;
};

export const deleteLog = async (ownerId: string, id: string): Promise<void> => {
  const doc = await getLogOrThrow(ownerId, id);
  await doc.deleteOne();
};
