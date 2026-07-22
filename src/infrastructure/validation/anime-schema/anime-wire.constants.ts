/** Maps bridge wire field names to the stable Spanish local field vocabulary. */
export const LOCAL_FIELD_BY_WIRE_FIELD = {
  id: '_id', name: 'nombre', status: 'estado', episodesWatched: 'nrocapvisto',
  totalEpisodes: 'totalcap', active: 'activo', firstCycle: 'primeravez', days: 'dias',
  genres: 'generos', kind: 'tipo', lastWatchedAt: 'fechaUltCapVisto', premieredAt: 'fechaEstreno',
  createdAt: 'fechaCreacion', deletedAt: 'fechaEliminacion', cover: 'portada', sourceUrl: 'pagina',
  folder: 'carpeta', studios: 'estudios', origin: 'origen', durationMinutes: 'duracion',
} as const;
