import { useCallback, useEffect, useState } from 'react';
import { useBackgroundSyncStatus } from '../../../settings/use-background-sync-status';
import { useBridgeConfig } from '../../../settings/use-bridge-config';
import { createNativeBatteryOptimizationExemption } from '../../../sync/native-battery-optimization.helpers';
import { BATTERY_EXEMPTION_PROMPT_COPY } from './battery-exemption-prompt.constants';
import {
  recordBatteryExemptionDialogShown,
  resolveBatteryExemptionPromptVariant,
} from './battery-exemption-prompt.helpers';
import type {
  BatteryExemptionPromptVariant,
  UseBatteryExemptionPromptResult,
} from './battery-exemption-prompt.types';
import { useBatteryExemptionForegroundState } from './use-battery-exemption-foreground-state';
import { useBatteryExemptionPreferences } from './use-battery-exemption-preferences';

/**
 * Coordinates the global battery-exemption dialog: the first prompt after pairing and the single
 * reminder after background sync went silent.
 *
 * The dialog LATCHES. Once a variant is due it is stored in state and recorded in SQLite right
 * away, so it is shown exactly once even if the app is killed while it is open, and it stays open
 * until the user answers even though its own record (or a foreground cycle refreshing
 * `lastAttemptAt`) makes the decision false a moment later. One latch per session also means the
 * prompt and the reminder can never both appear in the same session.
 */
export function useBatteryExemptionPrompt(): UseBatteryExemptionPromptResult {
  // 1. Refs

  // 2. State
  const [exemption] = useState(createNativeBatteryOptimizationExemption);
  const [latchedVariant, setLatchedVariant] = useState<BatteryExemptionPromptVariant | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  // 3. Context/3rd Party Hooks
  const { isExempt, evaluatedAt } = useBatteryExemptionForegroundState(exemption);
  const { isConfigured, configStatus } = useBridgeConfig();
  const { snapshot } = useBackgroundSyncStatus();

  // 4. Queries/Mutations
  const { rawDb, preferences, isLoaded } = useBatteryExemptionPreferences();

  // 5. Derived State
  const dueVariant = resolveBatteryExemptionPromptVariant({
    isReady: configStatus === 'loaded' && isLoaded,
    isAvailable: exemption.isAvailable(),
    isConfigured,
    isExempt,
    promptShownAt: preferences.promptShownAt,
    reminderShownAt: preferences.reminderShownAt,
    lastAttemptAt: snapshot.lastAttemptAt,
    now: evaluatedAt,
  });

  // Latching during render (React's "adjust state while rendering" pattern) rather than in an
  // effect keeps the open dialog independent of every later change to the decision inputs.
  if (latchedVariant === null && dueVariant !== null) {
    setLatchedVariant(dueVariant);
  }

  const copy = latchedVariant ? BATTERY_EXEMPTION_PROMPT_COPY[latchedVariant] : null;
  const isOpen = latchedVariant !== null && !isDismissed;

  // 6. Callbacks
  const handleAllow = useCallback(() => {
    // `requestExemption()` only launches the system dialog; the grant is re-read on return.
    exemption.requestExemption();
    setIsDismissed(true);
  }, [exemption]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  // 7. Effects
  useEffect(() => {
    if (latchedVariant && rawDb) {
      void recordBatteryExemptionDialogShown(rawDb, latchedVariant, Date.now());
    }
  }, [latchedVariant, rawDb]);

  return { isOpen, copy, handleAllow, handleDismiss };
}
