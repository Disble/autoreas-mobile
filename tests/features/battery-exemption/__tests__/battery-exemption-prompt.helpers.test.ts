import {
  recordBatteryExemptionDialogShown,
  resolveBatteryExemptionPromptVariant,
} from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/battery-exemption-prompt.helpers';
import * as preferencesHelpers from '../../../../src/features/battery-exemption/battery-exemption-preferences.helpers';
import { withLocalWrite } from '../../../../src/infrastructure/db/client/client.helpers';
import type { ResolveBatteryExemptionPromptVariantInput } from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/battery-exemption-prompt.types';

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  withLocalWrite: jest.fn(
    async (_rawDb: unknown, task: (db: unknown) => Promise<unknown>) => task('write-db'),
  ),
}));

jest.mock('../../../../src/features/battery-exemption/battery-exemption-preferences.helpers', () => ({
  markBatteryPromptShown: jest.fn().mockResolvedValue(undefined),
  markBatteryReminderShown: jest.fn().mockResolvedValue(undefined),
}));

/** Two hours, written out independently of the production constant. */
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

/** Fixed clock so every window is measured from the same instant. */
const NOW = 1_800_000_000_000;

/** Inputs for a device whose stored state has loaded and that never saw either dialog. */
const FRESH_INPUT: ResolveBatteryExemptionPromptVariantInput = {
  isReady: true,
  isAvailable: true,
  isConfigured: true,
  isExempt: false,
  promptShownAt: null,
  reminderShownAt: null,
  lastAttemptAt: null,
  now: NOW,
};

/** Inputs for a device that declined the prompt and whose background sync went silent. */
const SILENT_INPUT: ResolveBatteryExemptionPromptVariantInput = {
  ...FRESH_INPUT,
  promptShownAt: NOW - TWO_HOURS_MS,
  lastAttemptAt: NOW - TWO_HOURS_MS,
};

describe('resolveBatteryExemptionPromptVariant', () => {
  it('resolves the first prompt for a device that never saw it', () => {
    expect(resolveBatteryExemptionPromptVariant(FRESH_INPUT)).toBe('prompt');
  });

  it('resolves the reminder once background sync went silent after a declined prompt', () => {
    expect(resolveBatteryExemptionPromptVariant(SILENT_INPUT)).toBe('reminder');
  });

  it('resolves the prompt, never the reminder, while the prompt was never shown even if background sync is silent', () => {
    expect(
      resolveBatteryExemptionPromptVariant({ ...SILENT_INPUT, promptShownAt: null }),
    ).toBe('prompt');
  });

  it('decides nothing until the stored state has loaded', () => {
    expect(resolveBatteryExemptionPromptVariant({ ...FRESH_INPUT, isReady: false })).toBeNull();
    expect(resolveBatteryExemptionPromptVariant({ ...SILENT_INPUT, isReady: false })).toBeNull();
  });

  it('resolves nothing when neither dialog is due', () => {
    expect(resolveBatteryExemptionPromptVariant({ ...FRESH_INPUT, isExempt: true })).toBeNull();
    expect(
      resolveBatteryExemptionPromptVariant({ ...SILENT_INPUT, reminderShownAt: NOW }),
    ).toBeNull();
  });
});

describe('recordBatteryExemptionDialogShown', () => {
  /** Stand-in connection; the mocked write door never touches it. */
  const rawDb = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the prompt timestamp for the prompt variant', async () => {
    await recordBatteryExemptionDialogShown(rawDb, 'prompt', NOW);

    expect(preferencesHelpers.markBatteryPromptShown).toHaveBeenCalledWith('write-db', NOW);
    expect(preferencesHelpers.markBatteryReminderShown).not.toHaveBeenCalled();
  });

  it('records the reminder timestamp for the reminder variant', async () => {
    await recordBatteryExemptionDialogShown(rawDb, 'reminder', NOW);

    expect(preferencesHelpers.markBatteryReminderShown).toHaveBeenCalledWith('write-db', NOW);
    expect(preferencesHelpers.markBatteryPromptShown).not.toHaveBeenCalled();
  });

  it('resolves instead of rejecting when the local write fails', async () => {
    (withLocalWrite as jest.Mock).mockRejectedValueOnce(new Error('database is locked'));

    await expect(recordBatteryExemptionDialogShown(rawDb, 'prompt', NOW)).resolves.toBeUndefined();
  });
});
