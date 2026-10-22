/** Defines the anime estado value value shape. */
export type AnimeEstadoValue = 0 | 1 | 2 | 3;

/** Defines the anime state sheet tone value shape. */
export type AnimeStateSheetTone = 'accent' | 'success' | 'warning' | 'danger';

/** Defines the data contract for anime estado definition. */
export interface AnimeEstadoDefinition {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly tone: AnimeStateSheetTone;
}

/** Defines the data contract for anime state sheet option. */
export interface AnimeStateSheetOption {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly tone: AnimeStateSheetTone;
  readonly isSelected: boolean;
}

/** Defines the data contract for anime state sheet props. */
export interface AnimeStateSheetProps {
  readonly visible: boolean;
  readonly currentEstado: number;
  /** The anime the state applies to, shown under the title. */
  readonly animeTitle: string;
  readonly onSelect: (estado: number) => void;
  readonly onClose: () => void;
}

/** Defines the data contract for one option row of the anime state sheet. */
export interface AnimeStateSheetOptionRowProps {
  readonly option: AnimeStateSheetOption;
  readonly checkColor: string;
  readonly onSelect: (estado: number) => void;
}
