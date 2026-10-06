import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useBatteryExemptionPrompt } from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/use-battery-exemption-prompt';
import * as preferencesHelpers from '../../../../src/features/battery-exemption/battery-exemption-preferences.helpers';
import * as batteryOptimization from '../../../../src/features/sync/native-battery-optimization.helpers';
import * as bridgeConfigHook from '../../../../src/features/settings/use-bridge-config';
import * as backgroundSyncStatusHook from '../../../../src/features/settings/use-background-sync-status';
import * as nativeRuntime from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import type { AppPreferencesRow } from '../../../../src/infrastructure/db/schema';

jest.mock('../../../../src/features/sync/native-battery-optimization.helpers', () => ({
  createNativeBatteryOptimizationExemption: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-background-sync-status', () => ({
  useBackgroundSyncStatus: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
  useOptionalLiveQuery: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(() => mockDrizzleDb),
  withLocalWrite: jest.fn(
    async (_rawDb: unknown, task: (db: unknown) => Promise<unknown>) => task(mockDrizzleDb),
  ),
}));

jest.mock('../../../../src/features/battery-exemption/battery-exemption-preferences.helpers', () => ({
  ...jest.requireActual(
    '../../../../src/features/battery-exemption/battery-exemption-preferences.helpers',
  ),
  markBatteryPromptShown: jest.fn().mockResolvedValue(undefined),
  markBatteryReminderShown: jest.fn().mockResolvedValue(undefined),
}));

/** Minimal drizzle stand-in: the hook only builds a select query and hands it to the live query. */
const mockDrizzleDb = {
  select: () => ({ from: () => ({ limit: () => 'app-preferences-query' }) }),
};

/** Two hours, written out independently of the production constant. */
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

/** Fixed clock so every window is measured from the same instant. */
const NOW = 1_800_000_000_000;

/** Mutable world the mocked seams read on every render. */
interface MockWorld {
  isAvailable: boolean;
  isExempt: boolean;
  isConfigured: boolean;
  configStatus: string;
  preferencesStatus: string;
  preferencesRow: AppPreferencesRow | null;
  lastAttemptAt: number | null;
}

/** The state every mocked seam reports; each test edits it before rendering or rerendering. */
let world: MockWorld;
/** The AppState listener the hook registered, so tests can drive foreground transitions. */
let appStateHandler: ((state: AppStateStatus) => void) | null;
/** Records every system exemption request the hook launches. */
const requestExemption = jest.fn(() => true);

/** Installs every mocked seam against the current `world`. */
function installMocks() {
  (batteryOptimization.createNativeBatteryOptimizationExemption as jest.Mock).mockImplementation(
    () => ({
      isAvailable: () => world.isAvailable,
      isExempt: () => world.isExempt,
      requestExemption,
    }),
  );
  (bridgeConfigHook.useBridgeConfig as jest.Mock).mockImplementation(() => ({
    isConfigured: world.isConfigured,
    configStatus: world.configStatus,
  }));
  (backgroundSyncStatusHook.useBackgroundSyncStatus as jest.Mock).mockImplementation(() => ({
    snapshot: { lastAttemptAt: world.lastAttemptAt },
  }));
  (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ raw: true });
  (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockImplementation(() => ({
    data: world.preferencesRow ? [world.preferencesRow] : [],
    status: world.preferencesStatus,
  }));
}

describe('useBatteryExemptionPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    appStateHandler = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandler = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
    world = {
      isAvailable: true,
      isExempt: false,
      isConfigured: true,
      configStatus: 'loaded',
      preferencesStatus: 'loaded',
      preferencesRow: null,
      lastAttemptAt: null,
    };
    installMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens the first prompt and records it immediately on a paired, non-exempt device', async () => {
    const { result } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(true);
    expect(result.current.copy?.title).toBe('Mantén la sincronización activa');
    expect(result.current.copy?.dismissActionLabel).toBe('Ahora no');
    expect(preferencesHelpers.markBatteryPromptShown).toHaveBeenCalledWith(mockDrizzleDb, NOW);
    expect(preferencesHelpers.markBatteryReminderShown).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<MockWorld>]>([
    ['the native module is unavailable', { isAvailable: false }],
    ['the app is already exempt', { isExempt: true }],
    ['the bridge is not paired', { isConfigured: false }],
    ['the pairing row has not loaded', { configStatus: 'pending' }],
    ['the stored preferences have not loaded', { preferencesStatus: 'pending' }],
    ['the prompt was already shown', { preferencesRow: { id: 1, batteryPromptShownAt: NOW - 1, batteryReminderShownAt: null } }],
  ])('stays closed and records nothing when %s', async (_label, overrides) => {
    world = { ...world, ...overrides };

    const { result } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(false);
    expect(preferencesHelpers.markBatteryPromptShown).not.toHaveBeenCalled();
    expect(preferencesHelpers.markBatteryReminderShown).not.toHaveBeenCalled();
  });

  it('stays open after its own record lands, and records only once', async () => {
    const { result, rerender } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    world.preferencesRow = { id: 1, batteryPromptShownAt: NOW, batteryReminderShownAt: null };
    rerender({});
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(true);
    expect(preferencesHelpers.markBatteryPromptShown).toHaveBeenCalledTimes(1);
  });

  it('opens the reminder after a silent background window and keeps it open when a foreground cycle refreshes the snapshot', async () => {
    world.preferencesRow = {
      id: 1,
      batteryPromptShownAt: NOW - TWO_HOURS_MS,
      batteryReminderShownAt: null,
    };
    world.lastAttemptAt = NOW - TWO_HOURS_MS;

    const { result, rerender } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(true);
    expect(result.current.copy?.title).toBe('La sincronización en segundo plano se detuvo');
    expect(result.current.copy?.dismissActionLabel).toBe('Cerrar');
    expect(preferencesHelpers.markBatteryReminderShown).toHaveBeenCalledWith(mockDrizzleDb, NOW);

    world.lastAttemptAt = NOW;
    world.preferencesRow = { ...world.preferencesRow, batteryReminderShownAt: NOW };
    rerender({});
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(true);
    expect(preferencesHelpers.markBatteryReminderShown).toHaveBeenCalledTimes(1);
  });

  it('requests the exemption and closes when the user allows it', async () => {
    const { result } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    act(() => {
      result.current.handleAllow();
    });

    expect(requestExemption).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
  });

  it('closes without requesting anything when the user dismisses it', async () => {
    const { result } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    act(() => {
      result.current.handleDismiss();
    });

    expect(requestExemption).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });

  it('never shows the reminder in the same session as the prompt', async () => {
    const { result, rerender } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    act(() => {
      result.current.handleDismiss();
    });

    world.preferencesRow = {
      id: 1,
      batteryPromptShownAt: NOW - TWO_HOURS_MS,
      batteryReminderShownAt: null,
    };
    world.lastAttemptAt = NOW - TWO_HOURS_MS;
    rerender({});
    await act(async () => {
      appStateHandler?.('active');
    });

    expect(result.current.isOpen).toBe(false);
    expect(preferencesHelpers.markBatteryReminderShown).not.toHaveBeenCalled();
  });

  it('re-reads the exemption and the clock when the app returns to the foreground', async () => {
    world.isExempt = true;
    world.preferencesRow = {
      id: 1,
      batteryPromptShownAt: NOW - TWO_HOURS_MS,
      batteryReminderShownAt: null,
    };
    world.lastAttemptAt = NOW - TWO_HOURS_MS + 1;

    const { result } = renderHook(() => useBatteryExemptionPrompt());
    await act(async () => undefined);

    expect(result.current.isOpen).toBe(false);

    // The user revoked the exemption in system settings and an hour passed in the background.
    world.isExempt = false;
    (Date.now as jest.Mock).mockReturnValue(NOW + 1);
    await act(async () => {
      appStateHandler?.('background');
    });
    expect(result.current.isOpen).toBe(false);

    await act(async () => {
      appStateHandler?.('active');
    });

    expect(result.current.isOpen).toBe(true);
    expect(preferencesHelpers.markBatteryReminderShown).toHaveBeenCalledWith(mockDrizzleDb, NOW + 1);
  });
});
