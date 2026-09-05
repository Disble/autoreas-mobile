/**
 * Mergeable `animes` columns the merge boundary may write from a remote snapshot, mirroring
 * the field set `upsertAnime` persists (everything except the immutable `_id` and the two
 * sync-internal columns: the `last_applied_change_ms` staleness guard and the
 * `bridge_modified_at` OCC token). Used both to map a `changed_fields` entry to a column value
 * and to derive the changed set when the bridge omits `changed_fields`. `deriveChangedFields`
 * iterates this explicit whitelist, not `Object.keys(row)`, so neither sync-internal column can
 * ever enter the merge path by inference.
 */
export const MERGEABLE_FIELDS = [
  'nombre',
  'estado',
  'nrocapvisto',
  'totalcap',
  'activo',
  'primeravez',
  'dias',
  'generos',
  'tipo',
  'fechaUltCapVisto',
  'fechaEstreno',
  'fechaCreacion',
  'fechaEliminacion',
  'portada',
  'pagina',
  'carpeta',
  'estudios',
  'origen',
  'duracion',
] as const;
