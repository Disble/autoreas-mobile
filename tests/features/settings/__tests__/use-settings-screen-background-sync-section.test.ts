import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSettingsScreenBackgroundSyncSection } from '../../../../src/features/settings/ui/SettingsScreen/use-settings-screen-background-sync-section';
import { useBackgroundSyncStatus } from '../../../../src/features/settings/use-background-sync-status';
import { useOptionalSQLiteContext } from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { syncDiagnosticsOutboxStore } from '../../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } from '../../../../src/features/sync/sync-runtime-status.constants';
import type { SyncRuntimeStatusSnapshot } from '../../../../src/features/sync/sync-runtime-status.types';

/**
 * N2b hook coverage: the section hook owns reading the outbox store's cumulative capacity-shed
 * counter and threading it into the pure helper. The store's OWN success/absence/error semantics
 * are proven in `tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts`; here we prove
 * HOW the hook reads it. That store access must never run during render -- its first `connect()`
 * creates the outbox schema, so a render-time read is DDL in the render phase -- which means the
 * read is deferred past commit, once per snapshot CONTENT, cancelled when it is superseded or the
 * hook unmounts, and rendered as absent while the read for the live snapshot is still pending.
 */
jest.mock('../../../../src/features/settings/use-background-sync-status', () => ({
  useBackgroundSyncStatus: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock(
  '../../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
  () => ({ syncDiagnosticsOutboxStore: { readShedCount: jest.fn() } }),
);

/** The mocked runtime-status hook this unit test drives directly. */
const mockedUseBackgroundSyncStatus = useBackgroundSyncStatus as jest.Mock;
/** The mocked optional-SQLite availability probe (null models a binary without expo-sqlite). */
const mockedUseOptionalSQLiteContext = useOptionalSQLiteContext as jest.Mock;
/** The mocked shared outbox store, narrowed to the one read the hook is allowed to call. */
const mockedStore = syncDiagnosticsOutboxStore as unknown as {
  readShedCount: jest.Mock;
};

/** A registered snapshot, so the helper renders the configured metric-tile branch. */
const REGISTERED_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  ...DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  registrationStatus: 'registered',
};

/** Extracts the capacity-shed tile id from a section result, or undefined when it was omitted. */
function findCapacityShedTile(section: ReturnType<typeof useSettingsScreenBackgroundSyncSection>) {
  return section.tiles.find((tile) => tile.id === 'diagnosticsCapacityShedCount');
}

/**
 * Drains the microtask the hook defers its store read into. A synchronous `renderHook` flushes
 * effects but NOT microtasks, so a test that wants to observe the deferred read -- or its
 * deliberate absence -- has to drain that microtask itself, and inside `act`, because draining it
 * publishes the read into state.
 */
async function flushDeferredRead() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSettingsScreenBackgroundSyncSection (capacity-shed read)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `mockReset`, not just `clearAllMocks`: a test that leaves an unconsumed `mockReturnValueOnce`
    // queued would otherwise leak into the next one instead of failing its own assertions.
    mockedStore.readShedCount.mockReset();
    mockedUseOptionalSQLiteContext.mockReturnValue({ id: 'raw-db' });
    mockedUseBackgroundSyncStatus.mockReturnValue({ snapshot: REGISTERED_SNAPSHOT });
    mockedStore.readShedCount.mockReturnValue(0);
  });

  it('reads the store at mount and renders its measured count', async () => {
    mockedStore.readShedCount.mockReturnValue(4);

    const { result } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1));
    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '4', tone: 'danger' });
  });

  it('re-reads on every live status snapshot update, so the tile follows the status surface', async () => {
    // No timer and no polling: the store has no change event of its own, so the runtime snapshot
    // is the only refresh trigger. The count therefore lags until the next cycle (or any other
    // status write) lands -- it is NOT a real-time counter, and the tile never claims to be one.
    mockedStore.readShedCount.mockReturnValueOnce(1).mockReturnValueOnce(2);

    const { result, rerender } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1));
    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '1' });

    mockedUseBackgroundSyncStatus.mockReturnValue({
      snapshot: { ...REGISTERED_SNAPSHOT, lastSuccessAt: 1_777 },
    });
    rerender({});

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(2));
    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '2' });
  });

  it('passes null without reading when the optional SQLite context is unavailable', async () => {
    mockedUseOptionalSQLiteContext.mockReturnValue(null);

    const { result } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedUseOptionalSQLiteContext).toHaveBeenCalled());
    expect(mockedStore.readShedCount).not.toHaveBeenCalled();
    expect(findCapacityShedTile(result.current)).toBeUndefined();
  });

  it('renders the tile as absent when the counter read fails, never as a zero', async () => {
    mockedStore.readShedCount.mockReturnValue(null);

    const { result } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1));
    expect(findCapacityShedTile(result.current)).toBeUndefined();
  });

  it('renders a measured zero as a neutral tile', async () => {
    mockedStore.readShedCount.mockReturnValue(0);

    const { result } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1));
    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '0', tone: 'default' });
  });

  it('never reads the store during render -- the read is deferred past commit', async () => {
    renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    // A synchronous `renderHook` has already run the effects by this point, so a read missing here
    // is one that was SCHEDULED rather than performed: the render body never touches the store,
    // and the DDL that the store's first `connect()` runs therefore never runs during render.
    expect(mockedStore.readShedCount).not.toHaveBeenCalled();

    await flushDeferredRead();

    expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1);
  });

  it('blanks the tile while the read for an updated snapshot is pending, never the superseded count', async () => {
    mockedStore.readShedCount.mockReturnValueOnce(1).mockReturnValue(2);

    const { result, rerender } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1));
    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '1' });

    mockedUseBackgroundSyncStatus.mockReturnValue({
      snapshot: { ...REGISTERED_SNAPSHOT, lastSuccessAt: 1_777 },
    });
    rerender({});

    // The render caused by the snapshot update must not keep reporting '1': that count belongs to
    // the superseded snapshot, and the read for the new one has not landed yet.
    expect(findCapacityShedTile(result.current)).toBeUndefined();

    await waitFor(() => expect(findCapacityShedTile(result.current)).toMatchObject({ value: '2' }));
    expect(mockedStore.readShedCount).toHaveBeenCalledTimes(2);
  });

  it('drops a superseded read: an update before the deferred read runs leaves exactly one read', async () => {
    mockedStore.readShedCount.mockReturnValue(5);

    const { result, rerender } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    mockedUseBackgroundSyncStatus.mockReturnValue({
      snapshot: { ...REGISTERED_SNAPSHOT, lastSuccessAt: 2_888 },
    });
    rerender({});

    await flushDeferredRead();

    expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(findCapacityShedTile(result.current)).toMatchObject({ value: '5' }));
  });

  it('reads nothing for an unmounted hook, so no torn-down read is ever published', async () => {
    const { unmount } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    unmount();
    await flushDeferredRead();

    expect(mockedStore.readShedCount).not.toHaveBeenCalled();
  });

  it('keeps the tile and reads once when a re-render repeats equal snapshot content', async () => {
    // The memoization that keeps the snapshot object identity stable across re-renders belongs to
    // the React Compiler, and this Jest pipeline does not run it -- so identity is not a refresh
    // signal the hook may trust: an identity-triggered read would re-read on every render, publish
    // again, and re-render forever. Equal content must mean "no new read, tile still current".
    mockedStore.readShedCount.mockReturnValue(7);
    mockedUseBackgroundSyncStatus.mockImplementation(() => ({
      snapshot: { ...REGISTERED_SNAPSHOT },
    }));

    const { result, rerender } = renderHook(() => useSettingsScreenBackgroundSyncSection(true));

    await waitFor(() => expect(findCapacityShedTile(result.current)).toMatchObject({ value: '7' }));

    rerender({});
    rerender({});
    await flushDeferredRead();

    expect(findCapacityShedTile(result.current)).toMatchObject({ value: '7' });
    expect(mockedStore.readShedCount).toHaveBeenCalledTimes(1);
  });
});
