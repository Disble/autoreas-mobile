import type { Anime } from '../../../infrastructure/validation/anime-schema';
import type { FieldMergeResult } from './merge.types';

/**
 * Whitelist of remote `changed_fields` names mapped to the local `animes` column value,
 * mirroring the field set `upsertAnime` already writes. Serializes `dias`/`generos` to JSON
 * the same way the cold-load writer does, keeping both writers consistent.
 */
function mapKnownField(field: string, snapshot: Anime): { value: unknown } | undefined {
  switch (field) {
    case 'nombre':
      return { value: snapshot.nombre };
    case 'estado':
      return { value: snapshot.estado };
    case 'nrocapvisto':
      return { value: snapshot.nrocapvisto };
    case 'totalcap':
      return { value: snapshot.totalcap ?? null };
    case 'activo':
      return { value: snapshot.activo };
    case 'primeravez':
      return { value: snapshot.primeravez };
    case 'dias':
      return { value: snapshot.dias ? JSON.stringify(snapshot.dias) : null };
    case 'generos':
      return { value: snapshot.generos ? JSON.stringify(snapshot.generos) : null };
    case 'tipo':
      return { value: snapshot.tipo ?? null };
    case 'fechaUltCapVisto':
      return { value: snapshot.fechaUltCapVisto ?? null };
    case 'fechaEstreno':
      return { value: snapshot.fechaEstreno ?? null };
    case 'fechaCreacion':
      return { value: snapshot.fechaCreacion ?? null };
    case 'fechaEliminacion':
      return { value: snapshot.fechaEliminacion ?? null };
    case 'portada':
      return { value: snapshot.portada ?? null };
    case 'pagina':
      return { value: snapshot.pagina ?? null };
    case 'carpeta':
      return { value: snapshot.carpeta ?? null };
    case 'estudios':
      return { value: snapshot.estudios ?? null };
    case 'origen':
      return { value: snapshot.origen ?? null };
    case 'duracion':
      return { value: snapshot.duracion ?? null };
    default:
      return undefined;
  }
}

/**
 * Builds a partial column-update map from `changed_fields` + a snapshot. Only the fields
 * named in `changedFields` are included, never the full snapshot row, so untouched local
 * fields (e.g. an optimistic `nrocapvisto`) are never clobbered. Unknown field names are
 * skipped (logged) rather than treated as fatal, per the Field-Level Merge contract.
 */
export function buildPartialUpdate(
  changedFields: readonly string[],
  snapshot: Anime,
): FieldMergeResult {
  const columns: Record<string, unknown> = {};
  const skippedFields: string[] = [];

  for (const field of changedFields) {
    const mapped = mapKnownField(field, snapshot);

    if (mapped === undefined) {
      skippedFields.push(field);
      console.warn('[merge] unknown field in changed_fields, skipping', { field });
      continue;
    }

    columns[field] = mapped.value;
  }

  return { columns, skippedFields };
}

/**
 * Per-anime staleness guard: a remote change is stale when its timestamp is not strictly
 * newer than the row's last-applied guard value. A NULL guard means the row has never had
 * a guarded apply, so it is never stale (first remote change always applies). Equal
 * timestamps are treated as stale (tie favors local / idempotent re-delivery is a no-op).
 */
export function isStale(changeMs: number, lastAppliedMs: number | null): boolean {
  if (lastAppliedMs === null) {
    return false;
  }

  return changeMs <= lastAppliedMs;
}
