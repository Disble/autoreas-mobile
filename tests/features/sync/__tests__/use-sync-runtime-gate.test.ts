import { renderHook } from '@testing-library/react-native';
import { useSyncRuntime } from '../../../../src/features/sync/use-sync-runtime';
import { useSyncRuntimeGate } from '../../../../src/features/sync/ui/SyncRuntimeGate/use-sync-runtime-gate';

jest.mock('../../../../src/features/sync/use-sync-runtime', () => ({
  useSyncRuntime: jest.fn(),
}));

describe('useSyncRuntimeGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSyncRuntime as jest.Mock).mockReturnValue({});
  });

  it('mounts the root runtime with the bootstrapped flag', () => {
    renderHook(() => useSyncRuntimeGate({ children: null, isBootstrapped: true }));

    expect(useSyncRuntime).toHaveBeenCalledWith({ isBootstrapped: true });
  });

  it('returns children untouched so the gate stays render-only', () => {
    const child = 'slot';
    const { result } = renderHook(() =>
      useSyncRuntimeGate({ children: child, isBootstrapped: true }),
    );

    expect(result.current.children).toBe(child);
  });
});
