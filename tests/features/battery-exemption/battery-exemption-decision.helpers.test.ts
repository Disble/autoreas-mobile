import { BACKGROUND_SILENCE_THRESHOLD_MS } from '../../../src/features/battery-exemption/battery-exemption-decision.constants';
import {
  shouldShowBatteryPrompt,
  shouldShowBatteryReminder,
} from '../../../src/features/battery-exemption/battery-exemption-decision.helpers';
import type {
  BatteryPromptDecisionInput,
  BatteryReminderDecisionInput,
} from '../../../src/features/battery-exemption/battery-exemption-decision.types';

/** Two hours, written out independently of the production constant. */
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

/** Fixed clock so every window is measured from the same instant. */
const NOW = 1_800_000_000_000;

/** A prompt input that qualifies: available, paired, not exempt, never shown. */
const PROMPT_INPUT: BatteryPromptDecisionInput = {
  isAvailable: true,
  isConfigured: true,
  isExempt: false,
  promptShownAt: null,
};

/** A reminder input that qualifies: prompt shown and background silent for exactly two hours. */
const REMINDER_INPUT: BatteryReminderDecisionInput = {
  isAvailable: true,
  isConfigured: true,
  isExempt: false,
  promptShownAt: NOW - TWO_HOURS_MS,
  reminderShownAt: null,
  lastAttemptAt: NOW - TWO_HOURS_MS,
  now: NOW,
};

describe('BACKGROUND_SILENCE_THRESHOLD_MS', () => {
  it('is two hours', () => {
    expect(BACKGROUND_SILENCE_THRESHOLD_MS).toBe(TWO_HOURS_MS);
  });
});

describe('shouldShowBatteryPrompt', () => {
  it('shows the prompt on an available, configured, non-exempt device that never saw it', () => {
    expect(shouldShowBatteryPrompt(PROMPT_INPUT)).toBe(true);
  });

  it('never shows it when the native module is unavailable', () => {
    expect(shouldShowBatteryPrompt({ ...PROMPT_INPUT, isAvailable: false })).toBe(false);
  });

  it('never shows it before the bridge is configured', () => {
    expect(shouldShowBatteryPrompt({ ...PROMPT_INPUT, isConfigured: false })).toBe(false);
  });

  it('never shows it when the app is already exempt', () => {
    expect(shouldShowBatteryPrompt({ ...PROMPT_INPUT, isExempt: true })).toBe(false);
  });

  it('never shows it a second time', () => {
    expect(shouldShowBatteryPrompt({ ...PROMPT_INPUT, promptShownAt: NOW })).toBe(false);
  });
});

describe('shouldShowBatteryReminder', () => {
  it('shows the reminder once background sync has been silent for the threshold after a declined prompt', () => {
    expect(shouldShowBatteryReminder(REMINDER_INPUT)).toBe(true);
  });

  it('never shows it when the native module is unavailable', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, isAvailable: false })).toBe(false);
  });

  it('never shows it before the bridge is configured', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, isConfigured: false })).toBe(false);
  });

  it('never shows it when the app is exempt', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, isExempt: true })).toBe(false);
  });

  it('never shows it before the first prompt was shown', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, promptShownAt: null })).toBe(false);
  });

  it('never shows it a second time', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, reminderShownAt: NOW - 1 })).toBe(false);
  });

  it('never shows it without any recorded background attempt', () => {
    expect(shouldShowBatteryReminder({ ...REMINDER_INPUT, lastAttemptAt: null })).toBe(false);
  });

  it('stays hidden while the last background attempt is more recent than the threshold', () => {
    expect(
      shouldShowBatteryReminder({ ...REMINDER_INPUT, lastAttemptAt: NOW - TWO_HOURS_MS + 1 }),
    ).toBe(false);
  });

  it('stays hidden right after the first prompt even when background sync is already silent', () => {
    expect(
      shouldShowBatteryReminder({
        ...REMINDER_INPUT,
        promptShownAt: NOW - TWO_HOURS_MS + 1,
        lastAttemptAt: NOW - 3 * TWO_HOURS_MS,
      }),
    ).toBe(false);
  });
});
