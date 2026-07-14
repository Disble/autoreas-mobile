/** Defines the anime estado value value shape. */
export type AnimeEstadoValue = 0 | 1 | 2 | 3;

/** Defines the anime state sheet tone value shape. */
export type AnimeStateSheetTone = 'default' | 'success' | 'warning' | 'danger';

/** Defines the data contract for anime estado definition. */
export interface AnimeEstadoDefinition {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tone: AnimeStateSheetTone;
}

/** Defines the data contract for anime state sheet option. */
export interface AnimeStateSheetOption {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tone: AnimeStateSheetTone;
  readonly isSelected: boolean;
}

/** Defines the data contract for anime state sheet props. */
export interface AnimeStateSheetProps {
  readonly visible: boolean;
  readonly currentEstado: number;
  readonly onSelect: (estado: number) => void;
  readonly onClose: () => void;
}
