/**
 * Every `animes` column `AnimeRow` declares, under the property name the previous drizzle
 * `select()` produced. The three columns whose database name is snake_case are aliased back here
 * rather than renamed after the read, so `parseStoredAnimeRow` keeps receiving exactly one shape
 * and the parsed `Anime` keeps its values, types and nulls.
 */
export const ANIME_ROW_SELECT_SQL =
  'SELECT _id, nombre, estado, nrocapvisto, totalcap, dias, generos, episodes, tipo, activo, ' +
  'primeravez, fechaUltCapVisto, fechaEstreno, fechaCreacion, fechaEliminacion, portada, ' +
  'pagina, carpeta, folder_relative AS folderRelative, estudios, origen, duracion, ' +
  'last_applied_change_ms AS lastAppliedChangeMs, bridge_modified_at AS bridgeModifiedAt, ' +
  'season FROM animes WHERE _id = ? LIMIT 1';

/** The single outbox row a local mutation appends, every column bound by value. */
export const INSERT_OPERATION_SQL =
  'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)';

/**
 * Database column for each field `toLocalAnimeUpdate` can emit. A closed map keeps the generated
 * `SET` list built from identifiers this module owns, never from a caller-supplied value, while
 * still writing only the fields the patch actually carries. `buildAnimeUpdateSql` indexes it with
 * the patch's own keys, so a field without a column here is a compile error rather than a silent
 * omission.
 */
export const UPDATE_COLUMN_BY_FIELD = {
  nrocapvisto: 'nrocapvisto',
  fechaUltCapVisto: 'fechaUltCapVisto',
  estado: 'estado',
  fechaEstreno: 'fechaEstreno',
  primeravez: 'primeravez',
} as const;
