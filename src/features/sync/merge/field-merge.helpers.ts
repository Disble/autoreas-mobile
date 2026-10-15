import type { Anime } from '../../../infrastructure/validation/anime-schema';
import { serializeEpisodeLengths } from '../../../infrastructure/validation/anime-schema/anime-episodes.helpers';
import { MERGEABLE_FIELDS } from './field-merge.constants';
import type { FieldMergeResult } from './merge.types';

/**
 * Whitelist of remote `changed_fields` names mapped to the local `animes` column value,
 * mirroring the field set `upsertAnime` already writes. Serializes `dias`/`generos`/`episodes` to
 * JSON the same way the cold-load writer does, keeping both writers consistent.
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
    case 'episodes':
      // Replaced whole, never merged: an absent array clears the local copy.
      return { value: serializeEpisodeLengths(snapshot.episodes) };
    default:
      return undefined;
  }
}

/**
 * Columns written alongside a known field instead of under their own `changed_fields` name. The
 * bridge sends `folderRelative` only together with `folder` (`carpeta`), so a folder change also
 * replaces the stored path, clearing it when the snapshot carries none.
 */
function mapCoupledColumns(field: string, snapshot: Anime): Record<string, unknown> {
  if (field === 'carpeta') {
    return { folderRelative: snapshot.folderRelative ?? null };
  }

  return {};
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
    Object.assign(columns, mapCoupledColumns(field, snapshot));
  }

  return { columns, skippedFields };
}

/**
 * Derives the changed-field set by diffing a remote snapshot against the current local row.
 * Returns only mergeable fields whose snapshot value differs from the persisted value.
 *
 * Used ONLY by the foreground full resync, a deliberate reconciliation against the bridge's full
 * list. Single remote changes never use it: an update with no known `changed_fields` is rejected
 * by `applyRemoteChanges`, never reconstructed by guessing.
 */
export function deriveChangedFields(
  snapshot: Anime,
  currentRow: Record<string, unknown>,
): string[] {
  const changed: string[] = [];

  for (const field of MERGEABLE_FIELDS) {
    const mapped = mapKnownField(field, snapshot);
    /* istanbul ignore next -- defensive parity guard: MERGEABLE_FIELDS' 20 entries and
     * mapKnownField's 20 switch cases are two separately-maintained lists the module comment
     * documents as mirrored; this `undefined` branch only fires if a future edit adds a field to
     * one without the other. Deleting it would turn that drift into a crash here (destructuring
     * `.value` off `undefined`) instead of a skipped field; unreachable only as long as the two
     * lists are proven in sync, which is exactly the drift this guards against. */
    if (mapped === undefined) {
      continue;
    }

    const coupled = Object.entries(mapCoupledColumns(field, snapshot));
    const isCoupledChanged = coupled.some(([column, value]) => value !== currentRow[column]);

    if (mapped.value !== currentRow[field] || isCoupledChanged) {
      changed.push(field);
    }
  }

  return changed;
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
