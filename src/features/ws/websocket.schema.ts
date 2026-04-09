import { z } from 'zod';

const AnimeChangedEventSchema = z.object({
  type: z.literal('anime_changed'),
  anime_id: z.string(),
});

const AnimeCreatedEventSchema = z.object({
  type: z.literal('anime_created'),
  anime_id: z.string(),
});

const AnimeDeletedEventSchema = z.object({
  type: z.literal('anime_deleted'),
  anime_id: z.string(),
});

const SyncRequiredEventSchema = z.object({
  type: z.literal('sync_required'),
});

export const WsMessageSchema = z.union([
  AnimeChangedEventSchema,
  AnimeCreatedEventSchema,
  AnimeDeletedEventSchema,
  SyncRequiredEventSchema,
]);
