import type { AnimeRow } from "../../infrastructure/db/schema";
import type {
  Anime,
  AnimeDay,
} from "../../infrastructure/validation/anime-schema";
import {
  ANIME_DAY_FILTER_OPTIONS,
  ANIME_PSEUDO_DAY_FILTERS,
  WEEKDAY_INDEX_TO_FILTER,
} from "./anime.constants";
import type { AnimeDayFilter, AnimeDayFilterOption } from "./anime.types";

/**
 * Parses a persisted JSON-text column into an array, degrading to an empty array for a null,
 * empty, or malformed value instead of throwing -- storage corruption in one column must not
 * abort parsing the rest of the row.
 */
function parseJsonArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value) as T[];
  } catch {
    return [];
  }
}

/** Finds the anime's `dias` entry matching the given day/pseudo-day filter, or `null`. */
function getAnimeDayMatch(
  anime: Anime,
  filter: AnimeDayFilter,
): AnimeDay | null {
  return anime.dias.find((day) => day.dia === filter) ?? null;
}

/**
 * Normalizes a persisted SQLite anime row into the validated domain shape used by UI hooks.
 * This keeps JSON parsing in one place so list consumers don't duplicate storage concerns.
 *
 * Built field-by-field ON PURPOSE, never `{...row}`: `AnimeRow` carries sync-internal columns
 * (`lastAppliedChangeMs`, `bridgeModifiedAt`) that must never reach the domain `Anime` shape or
 * any UI-facing list item. A spread leaks them at runtime with the compiler silent -- excess-
 * property checking does not fire on a spread, and a type alias like `Omit<AnimeRow, ...>`
 * cannot close the leak either, since a wider object stays assignable to a narrower one. Listing
 * every field explicitly is what makes the leak unreachable regardless of what any `select()`
 * returns, at any call site, forever.
 */
export function parseAnimeRow(row: AnimeRow): Anime {
  return {
    _id: row._id,
    nombre: row.nombre,
    estado: row.estado,
    nrocapvisto: row.nrocapvisto,
    totalcap: row.totalcap,
    dias: parseJsonArray<AnimeDay>(row.dias),
    generos: parseJsonArray<string>(row.generos),
    tipo: row.tipo,
    activo: row.activo,
    primeravez: row.primeravez,
    fechaUltCapVisto: row.fechaUltCapVisto,
    fechaEstreno: row.fechaEstreno,
    fechaCreacion: row.fechaCreacion,
    fechaEliminacion: row.fechaEliminacion,
    portada: row.portada,
    pagina: row.pagina,
    carpeta: row.carpeta,
    estudios: row.estudios,
    origen: row.origen,
    duracion: row.duracion,
  };
}

/**
 * Resolves the legacy default filter from the current weekday so Mis Animes opens on today's schedule.
 * When the bridge-owned season mode is active, it instead opens on the 'Ver hoy' Estrenos set,
 * mirroring the bridge's season-mode download selection. This preserves the expected day-first UX
 * outside of season mode instead of falling back to status-based tabs.
 */
export function getDefaultAnimeDayFilter(
  now: Date,
  seasonMode = false,
): AnimeDayFilter {
  if (seasonMode) {
    return 'Ver hoy';
  }

  return WEEKDAY_INDEX_TO_FILTER[now.getDay()];
}

/**
 * Returns the persisted legacy order for the selected day or pseudo-day.
 * This lets list consumers sort by Bridge-provided `dias[].orden` instead of activity timestamps.
 */
export function getAnimeOrderForFilter(
  anime: Anime,
  filter: AnimeDayFilter,
): number | null {
  return getAnimeDayMatch(anime, filter)?.orden ?? null;
}

/**
 * Checks whether a filter is one of the Estrenos pseudo-day tabs ('Sin ver', 'Ver hoy', 'Visto').
 * Season-mode surfaces share the same candidate set across these tabs, so callers must not special-case a single one.
 */
export function isAnimePseudoDayFilter(filter: AnimeDayFilter): boolean {
  return ANIME_PSEUDO_DAY_FILTERS.some((pseudoDay) => pseudoDay === filter);
}

/**
 * Checks whether an anime belongs to the active day or pseudo-day filter.
 * This centralizes inclusion rules so hooks and tests share the same filtering semantics.
 */
export function matchesAnimeDayFilter(
  anime: Anime,
  filter: AnimeDayFilter,
): boolean {
  return getAnimeDayMatch(anime, filter) !== null;
}

/**
 * Filters and sorts visible animes for the selected legacy day.
 * It excludes rows without the active `dias` mapping and keeps a deterministic fallback by name and id.
 */
export function sortAnimesBySelectedDay<TAnime extends Anime>(
  animes: readonly TAnime[],
  filter: AnimeDayFilter,
): TAnime[] {
  return animes
    .filter((anime) => matchesAnimeDayFilter(anime, filter))
    .sort((left, right) => {
      const leftOrder =
        getAnimeOrderForFilter(left, filter) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        getAnimeOrderForFilter(right, filter) ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const nameComparison = left.nombre.localeCompare(right.nombre, "es");
      if (nameComparison !== 0) {
        return nameComparison;
      }

      return left._id.localeCompare(right._id, "es");
    });
}

/**
 * Resolves the matching select option for a given filter value.
 * This keeps HeroUI Select wiring consistent between the controlled value and available options.
 */
export function getAnimeDayFilterOption(filter: AnimeDayFilter): AnimeDayFilterOption {
  return (
    ANIME_DAY_FILTER_OPTIONS.find((option) => option.value === filter) ?? {
      value: filter,
      label: filter,
    }
  );
}
