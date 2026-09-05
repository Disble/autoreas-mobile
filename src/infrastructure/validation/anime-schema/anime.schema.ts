import { z } from 'zod';

/** Matches a legacy numeric timestamp stored as a string, so `dateLike` can coerce it. */
const numericStringPattern = /^-?\d+(\.\d+)?$/;

/** Validates anime day schema payloads at runtime. */

const AnimeDaySchema = z.object({
  dia: z.string(),
  orden: z.number().int(),
});

/** Defines the anime day value shape. */
export type AnimeDay = z.infer<typeof AnimeDaySchema>;

/** Validates one English bridge day-of-week entry (`{ day, order }`). */
const WireAnimeDaySchema = z.object({
  day: z.string(),
  order: z.number().int(),
});

/** Defines the wire anime day value shape. */

/** Provides the shared date like value. */

const dateLike = z.preprocess((value) => {
  if (value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && numericStringPattern.test(value.trim())) {
    return Number(value);
  }

  if (
    value &&
    typeof value === 'object' &&
    '$$date' in value &&
    typeof value.$$date === 'number'
  ) {
    return value.$$date;
  }

  return value;
}, z.number().nullable());

/** Coerces the legacy empty-string sentinel to an empty array before validating a string list. */
const stringArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(z.string())
);

/** Coerces the legacy empty-string sentinel to an empty array before validating a day list. */
const animeDayArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(AnimeDaySchema)
);

/** Wire-shape counterpart of `stringArrayOrEmpty`. */
const wireStringArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(z.string())
);

/** Wire-shape counterpart of `animeDayArrayOrEmpty`. */
const wireAnimeDayArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(WireAnimeDaySchema)
);

/** Optional nullable numeric timestamp shared by every wire date field. */
const numericDate = z.number().nullable().optional();

/** Validates anime schema payloads at runtime. */

export const AnimeSchema = z.object({
  _id: z.string(),
  nombre: z.string(),
  estado: z.number().int().min(0).max(3),
  nrocapvisto: z.number(),
  totalcap: z.number().int().nullable().optional(),
  dias: animeDayArrayOrEmpty.optional().default([]),
  generos: stringArrayOrEmpty.optional().default([]),
  tipo: z.number().int().nullable().optional(),
  activo: z.number().int().min(0).max(1),
  primeravez: z.number().int().min(0).max(1),
  fechaUltCapVisto: dateLike.optional(),
  fechaEstreno: dateLike.optional(),
  fechaCreacion: dateLike.optional(),
  fechaEliminacion: dateLike.optional(),
  portada: z.string().nullable().optional(),
  pagina: z.string().nullable().optional(),
  carpeta: z.string().nullable().optional(),
  estudios: z.string().nullable().optional(),
  origen: z.string().nullable().optional(),
  duracion: z.number().int().nullable().optional(),
});

/** Defines the anime value shape. */
export type Anime = z.infer<typeof AnimeSchema>;

/** Validates English anime wire payloads at runtime. */
export const WireAnimeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number().int().min(0).max(3),
  episodesWatched: z.number(),
  totalEpisodes: z.number().int().nullable().optional(),
  days: wireAnimeDayArrayOrEmpty.optional().default([]),
  genres: wireStringArrayOrEmpty.optional().default([]),
  kind: z.number().int().nullable().optional(),
  active: z.number().int().min(0).max(1),
  firstCycle: z.number().int().min(0).max(1),
  lastWatchedAt: numericDate,
  premieredAt: numericDate,
  createdAt: numericDate,
  deletedAt: numericDate,
  cover: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  studios: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  // Bridge-authored optimistic-concurrency token. REQUIRED, not optional: the bridge sends
  // `*int64` with `omitempty` on the Go side, so a pointer to 0 still serializes as
  // `"modified_at":0` and only a nil pointer omits the key -- measured on a live listAnimes
  // response, 135/143 records carried exactly 0. `0` is therefore a real token, never a
  // sentinel for "absent". This field belongs ONLY on the wire shape: it must never be added
  // to `AnimeSchema`/`Anime` (see `parseAnimeRow` in `anime.helpers.ts` for the runtime barrier
  // that keeps it off every domain and UI-facing type).
  modified_at: z.number().int(),
});

/** Defines the wire anime value shape. */
export type WireAnime = z.infer<typeof WireAnimeSchema>;

/** Validates English anime wire list payloads at runtime. */
export const WireAnimeListSchema = z.array(WireAnimeSchema);
