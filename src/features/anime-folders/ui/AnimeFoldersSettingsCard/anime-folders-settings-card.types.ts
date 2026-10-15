import type { AnimeFoldersIndexStatus, FolderIndexSummary } from '../../anime-folders.types';

/** Inputs of the "Carpetas de anime" Settings card copy. */
export interface AnimeFoldersSettingsCardInput {
  readonly status: AnimeFoldersIndexStatus;
  readonly rootLabel: string | null;
  readonly summary: FolderIndexSummary | null;
  readonly indexedAt: number | null;
  readonly now: Date;
}

/** Copy of the "Carpetas de anime" Settings card. */
export interface AnimeFoldersSettingsCardView {
  /** False before a folder is chosen: only "Elegir carpeta" is offered. */
  readonly hasRoot: boolean;
  readonly rootLabel: string;
  readonly foundLabel: string;
  readonly reviewedLabel: string;
  /** "1 carpeta sin anime" row leading to the detail; `null` while there is no summary. */
  readonly unmatchedLabel: string | null;
}

/** Defines the data contract for the dumb "Carpetas de anime" Settings card. */
export interface AnimeFoldersSettingsCardContentProps {
  readonly view: AnimeFoldersSettingsCardView;
  readonly onOpenDetail: () => void;
  readonly onReindex: () => void;
  readonly onChooseRoot: () => void;
}

/** A folder picked from the card; `id` tells two picks of the same folder apart. */
export interface AnimeFoldersConfirmationRequest {
  readonly rootUri: string;
  readonly id: number;
}
