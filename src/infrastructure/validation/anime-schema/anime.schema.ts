import { z } from 'zod';

const numericStringPattern = /^-?\d+(\.\d+)?$/;

/** Validates anime day schema payloads at runtime. */

const AnimeDaySchema = z.object({
  dia: z.string(),
  orden: z.number().int(),
});

/** Defines the anime day value shape. */
export type AnimeDay = z.infer<typeof AnimeDaySchema>;

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
