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

const PreferencesChangedEventSchema = z.object({
  type: z.literal('preferences_changed'),
  season_mode: z.boolean(),
});

const SeasonChangedEventSchema = z.object({
  type: z.literal('season_changed'),
});

/** Validates ws message schema payloads at runtime. */

export const WsMessageSchema = z.union([
  AnimeChangedEventSchema,
  AnimeCreatedEventSchema,
  AnimeDeletedEventSchema,
  SyncRequiredEventSchema,
  PreferencesChangedEventSchema,
  SeasonChangedEventSchema,
]);
