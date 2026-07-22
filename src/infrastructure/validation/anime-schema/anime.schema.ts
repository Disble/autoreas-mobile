import { z } from 'zod';

const numericStringPattern = /^-?\d+(\.\d+)?$/;

/** Validates anime day schema payloads at runtime. */

const AnimeDaySchema = z.object({
  dia: z.string(),
  orden: z.number().int(),
});

/** Defines the anime day value shape. */
export type AnimeDay = z.infer<typeof AnimeDaySchema>;

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

const stringArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(z.string())
);

const animeDayArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(AnimeDaySchema)
);

const wireStringArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(z.string())
);

const wireAnimeDayArrayOrEmpty = z.preprocess(
  (value) => (value === '' ? [] : value),
  z.array(WireAnimeDaySchema)
);

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
});

/** Defines the wire anime value shape. */
export type WireAnime = z.infer<typeof WireAnimeSchema>;

/** Validates English anime wire list payloads at runtime. */
export const WireAnimeListSchema = z.array(WireAnimeSchema);
