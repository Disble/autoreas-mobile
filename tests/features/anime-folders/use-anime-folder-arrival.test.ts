import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { probeAnimeFolders } from '../../../src/features/anime-folders/anime-folders.store';
import type { AnimeFolderArrivalSource } from '../../../src/features/anime-folders/anime-folders.types';
import { useAnimeFolderArrival } from '../../../src/features/anime-folders/use-anime-folder-arrival';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(() => ({ raw: true })),
  useOptionalLiveQuery: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(() => ({
    select: () => ({ from: () => 'arrival-query' }),
  })),
}));

jest.mock('../../../src/features/anime-folders/anime-folders.store', () => ({
  probeAnimeFolders: jest.fn(async () => undefined),
}));

/** Anime row as the arrival query reads it. */
function row(id: string, lastAppliedChangeMs: number | null): AnimeFolderArrivalSource {
  return { id, carpeta: null, folderRelative: id, activo: 1, lastAppliedChangeMs };
}

/** Makes the live query return `rows` with `status`. */
function givenRows(rows: readonly AnimeFolderArrivalSource[], status: 'pending' | 'loaded' = 'loaded') {
  jest.mocked(nativeRuntime.useOptionalLiveQuery).mockReturnValue({ data: rows, status });
}

/** Captures the AppState listener the hook registers. */
function captureAppStateListener() {
  const remove = jest.fn();
  let listener: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove };
  });

  return { emit: (state: AppStateStatus) => listener?.(state), remove };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAnimeFolderArrival', () => {
  it('checks nothing on the first read: the initial walk covers every anime', () => {
    captureAppStateListener();
    givenRows([], 'pending');
    const { rerender } = renderHook(() => useAnimeFolderArrival());
    givenRows([row('ranma', 1)]);

    rerender({});

    expect(probeAnimeFolders).not.toHaveBeenCalled();
  });

  it('checks only the animes that got an incoming event, at that moment', () => {
    captureAppStateListener();
    givenRows([row('ranma', 1), row('bleach', 1)]);
    const { rerender } = renderHook(() => useAnimeFolderArrival());
    givenRows([row('ranma', 2), row('bleach', 1)]);

    rerender({});

    expect(probeAnimeFolders).toHaveBeenCalledTimes(1);
    expect(probeAnimeFolders).toHaveBeenCalledWith([row('ranma', 2)]);
  });

  it('checks every anime when the app returns to the foreground, and stops listening on unmount', () => {
    const appState = captureAppStateListener();
    givenRows([row('ranma', 1), row('bleach', 1)]);
    const { unmount } = renderHook(() => useAnimeFolderArrival());

    appState.emit('background');
    appState.emit('active');
    unmount();

    expect(probeAnimeFolders).toHaveBeenCalledTimes(1);
    expect(probeAnimeFolders).toHaveBeenCalledWith([row('ranma', 1), row('bleach', 1)]);
    expect(appState.remove).toHaveBeenCalled();
  });
});
