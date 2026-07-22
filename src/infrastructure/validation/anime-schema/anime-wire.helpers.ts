import type { Anime, WireAnime } from './anime.schema';
import { LOCAL_FIELD_BY_WIRE_FIELD } from './anime-wire.constants';

/**
 * Maps one English bridge anime snapshot into the stable Spanish local/domain shape.
 * This keeps the wire cutover isolated at one anti-corruption seam and avoids DB renames.
 */
export function mapWireAnimeToLegacyAnime(anime: WireAnime): Anime {
  return {
    _id: anime.id, nombre: anime.name, estado: anime.status, nrocapvisto: anime.episodesWatched,
    totalcap: anime.totalEpisodes ?? null,
    dias: anime.days.map((day) => ({ dia: day.day, orden: day.order })),
    generos: anime.genres, tipo: anime.kind ?? null, activo: anime.active, primeravez: anime.firstCycle,
    fechaUltCapVisto: anime.lastWatchedAt ?? null, fechaEstreno: anime.premieredAt ?? null,
    fechaCreacion: anime.createdAt ?? null, fechaEliminacion: anime.deletedAt ?? null,
    portada: anime.cover ?? null, pagina: anime.sourceUrl ?? null, carpeta: anime.folder ?? null,
    estudios: anime.studios ?? null, origen: anime.origin ?? null, duracion: anime.durationMinutes ?? null,
  };
}

/**
 * Normalizes English bridge `changed_fields` into the Spanish local field names once.
 * This centralizes field ownership so merge code consumes only the local vocabulary.
 */
export function normalizeWireAnimeChangedFields(
  changedFields: readonly string[],
): string[] {
  return changedFields.flatMap((field) => {
    const normalizedField = LOCAL_FIELD_BY_WIRE_FIELD[field as keyof typeof LOCAL_FIELD_BY_WIRE_FIELD];

    return normalizedField ? [normalizedField] : [];
  });
}

/**
 * Maps an English bridge anime list into the stable Spanish local/domain shape.
 * This keeps bootstrap, resync, and reconcile snapshot consumers on one normalized contract.
 */
export function mapWireAnimeListToLegacyAnimes(animes: readonly WireAnime[]): Anime[] {
  return animes.map(mapWireAnimeToLegacyAnime);
}
