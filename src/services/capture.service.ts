import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import {
  Capture,
  type CaptureDocument,
  type CaptureStatus,
} from '../models/capture.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export const listCaptures = (
  ownerId: string,
  status: CaptureStatus = 'open',
): Promise<CaptureDocument[]> =>
  Capture.find({ ownerId: owner(ownerId), status })
    .sort({ createdAt: -1, _id: -1 })
    .limit(500);

export const createCapture = (ownerId: string, text: string): Promise<CaptureDocument> =>
  Capture.create({ ownerId: owner(ownerId), text: text.trim() });

export const getCaptureOrThrow = async (
  ownerId: string,
  id: string,
): Promise<CaptureDocument> => {
  const doc = await Capture.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!doc) throw notFoundError('Capture not found');
  return doc;
};

export const updateCapture = async (
  ownerId: string,
  id: string,
  patch: { text?: string; status?: CaptureStatus },
): Promise<CaptureDocument> => {
  const doc = await getCaptureOrThrow(ownerId, id);
  if (patch.text !== undefined) doc.text = patch.text.trim();
  if (patch.status !== undefined) doc.status = patch.status;
  await doc.save();
  return doc;
};

export const deleteCapture = async (ownerId: string, id: string): Promise<void> => {
  const doc = await getCaptureOrThrow(ownerId, id);
  await doc.deleteOne();
};
