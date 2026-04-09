import type { BridgeConfig } from '../../../../infrastructure/db/schema';

export type SettingsScreenProps = Record<never, never>;

export interface SettingsScreenViewModel {
  readonly config: BridgeConfig | null;
  readonly error: string | null;
  readonly isConfigured: boolean;
  readonly isUnpairing: boolean;
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
}
