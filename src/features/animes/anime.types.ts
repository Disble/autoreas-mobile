export type AnimeWeekdayFilter =
  | 'Lunes'
  | 'Martes'
  | 'Miércoles'
  | 'Jueves'
  | 'Viernes'
  | 'Sábado'
  | 'Domingo';

export type AnimePseudoDayFilter = 'Sin ver' | 'Ver hoy' | 'Visto';

export type AnimeDayFilter = AnimeWeekdayFilter | AnimePseudoDayFilter;

export interface AnimeDayFilterOption {
  readonly value: AnimeDayFilter;
  readonly label: string;
}
