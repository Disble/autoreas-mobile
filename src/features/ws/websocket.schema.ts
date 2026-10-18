import { z } from 'zod';

/** An `anime_changed` frame: the bridge changed one anime, so the client pulls. */
const AnimeChangedEventSchema = z.object({
  type: z.literal('anime_changed'),
  anime_id: z.string(),
});

/** An `anime_created` frame: the bridge added one anime, so the client pulls. */
const AnimeCreatedEventSchema = z.object({
  type: z.literal('anime_created'),
  anime_id: z.string(),
});

/** An `anime_deleted` frame: the bridge removed one anime, so the client pulls. */
const AnimeDeletedEventSchema = z.object({
  type: z.literal('anime_deleted'),
  anime_id: z.string(),
});

/** A `sync_required` frame: the bridge has changes the client has not pulled yet. */
const SyncRequiredEventSchema = z.object({
  type: z.literal('sync_required'),
});

/** Validates ws message schema payloads at runtime. */
export const WsMessageSchema = z.union([
  AnimeChangedEventSchema,
  AnimeCreatedEventSchema,
  AnimeDeletedEventSchema,
  SyncRequiredEventSchema,
]);
