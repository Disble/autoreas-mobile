/** Defines the anime weekday filter value shape. */
export type AnimeWeekdayFilter =
  | 'Lunes'
  | 'Martes'
  | 'Miércoles'
  | 'Jueves'
  | 'Viernes'
  | 'Sábado'
  | 'Domingo';

/** Defines the anime pseudo day filter value shape. */
export type AnimePseudoDayFilter = 'Sin ver' | 'Ver hoy' | 'Visto';

/** Defines the anime day filter value shape. */
export type AnimeDayFilter = AnimeWeekdayFilter | AnimePseudoDayFilter;

/** Defines the data contract for anime day filter option. */
export interface AnimeDayFilterOption {
  readonly value: AnimeDayFilter;
  readonly label: string;
}
