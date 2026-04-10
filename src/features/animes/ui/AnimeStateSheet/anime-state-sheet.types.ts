export type AnimeEstadoValue = 0 | 1 | 2 | 3;

export type AnimeStateSheetTone = 'default' | 'success' | 'warning' | 'danger';

export interface AnimeEstadoDefinition {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tone: AnimeStateSheetTone;
}

export interface AnimeStateSheetOption {
  readonly value: AnimeEstadoValue;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tone: AnimeStateSheetTone;
  readonly isSelected: boolean;
}

export interface AnimeStateSheetProps {
  readonly visible: boolean;
  readonly currentEstado: number;
  readonly onSelect: (estado: number) => void;
  readonly onClose: () => void;
}
