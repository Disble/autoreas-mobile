import type { SQLiteDatabase } from 'expo-sqlite';
import type { BatteryReminderDecisionInput } from '../../battery-exemption-decision.types';
import type { BatteryExemptionPreferences } from '../../battery-exemption-preferences.types';

/** Names the two dialog variants: the first prompt and the one-time reminder. */
export type BatteryExemptionPromptVariant = 'prompt' | 'reminder';

/** Holds the user-facing copy of one dialog variant. */
export interface BatteryExemptionPromptCopy {
  readonly title: string;
  readonly description: string;
  readonly allowActionLabel: string;
  readonly dismissActionLabel: string;
}

/** Inputs that resolve which dialog variant, if any, is due right now. */
export interface ResolveBatteryExemptionPromptVariantInput extends BatteryReminderDecisionInput {
  /** False until the pairing row and the stored preferences have both been read. */
  readonly isReady: boolean;
}

/** Describes what the dumb dialog renders and the two answers it can report. */
export interface UseBatteryExemptionPromptResult {
  readonly isOpen: boolean;
  readonly copy: BatteryExemptionPromptCopy | null;
  readonly handleAllow: () => void;
  readonly handleDismiss: () => void;
}

/** Props of the inner dialog content: the copy and the two answers. */
export interface BatteryExemptionPromptContentProps {
  readonly copy: BatteryExemptionPromptCopy;
  readonly onAllow: () => void;
  readonly onDismiss: () => void;
}

/** The prompt inputs that live outside SQLite, refreshed whenever the app returns to the foreground. */
export interface BatteryExemptionForegroundState {
  readonly isExempt: boolean;
  readonly evaluatedAt: number;
}

/** The stored dialog history, the connection it came from, and whether it has loaded yet. */
export interface BatteryExemptionStoredPreferences {
  readonly rawDb: SQLiteDatabase | null;
  readonly preferences: BatteryExemptionPreferences;
  readonly isLoaded: boolean;
}
