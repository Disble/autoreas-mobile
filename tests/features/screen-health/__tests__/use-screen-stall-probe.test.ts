import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { recordScreenStall } from '../../../../src/features/screen-health/screen-stall.helpers';
import { useScreenStallProbe } from '../../../../src/features/screen-health/ui/ScreenStallProbe/use-screen-stall-probe';
import { useBridgeConfig } from '../../../../src/features/settings/use-bridge-config';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'obs-uuid' }));
jest.mock('../../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));
jest.mock('../../../../src/features/screen-health/screen-stall.helpers', () => ({
  ...jest.requireActual('../../../../src/features/screen-health/screen-stall.helpers'),
  recordScreenStall: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 1280, height: 800, scale: 1, fontScale: 1 })),
}));

/** The mocked window size source. */
const useWindowDimensionsMock = jest.requireMock(
  'react-native/Libraries/Utilities/useWindowDimensions',
).default as jest.Mock;
/** The mocked recorder. */
const recordScreenStallMock = recordScreenStall as jest.Mock;
/** The mocked pairing row source. */
const useBridgeConfigMock = useBridgeConfig as jest.Mock;

/** One AppState listener as the hook registers it. */
type Listener = (state?: string) => void;

/** Captures every AppState listener the hook registers, by event type. */
function captureAppStateListeners() {
  const listeners: Record<string, Listener> = {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    listeners[type] = handler as Listener;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  return { emit: (type: string, state?: string) => act(() => listeners[type]?.(state)) };
}

/** The mocked device clock. */
let now = 1_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  useBridgeConfigMock.mockReturnValue({ config: { isSyncTelemetryEnabled: true } });
  useWindowDimensionsMock.mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
});

describe('useScreenStallProbe', () => {
  it('reports a touch whose probe took two seconds or more to paint', () => {
    captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    act(() => result.current.handleTouchStart());
    now += 2500;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock).toHaveBeenCalledTimes(1);
    expect(recordScreenStallMock.mock.calls[0][0]).toMatchObject({
      kind: 'screen_stall',
      observation_id: 'obs-uuid',
      observed_at_ms: 1_000_000,
      duration_ms: 2500,
      trigger: 'touch',
      window_width: 1280,
      window_height: 800,
    });
  });

  it('re-mounts the probe view once per armed probe', () => {
    captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));
    const initialKey = result.current.probeKey;

    act(() => result.current.handleTouchStart());

    expect(result.current.probeKey).toBe(initialKey + 1);
  });

  it('reports nothing when the probe painted quickly', () => {
    captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    act(() => result.current.handleTouchStart());
    now += 40;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock).not.toHaveBeenCalled();
  });

  it('measures from the first unanswered touch and does not re-arm while pending', () => {
    captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    act(() => result.current.handleTouchStart());
    const armedKey = result.current.probeKey;
    now += 30_000;
    act(() => result.current.handleTouchStart());
    now += 60_000;
    act(() => result.current.handleProbeLayout());

    expect(result.current.probeKey).toBe(armedKey);
    expect(recordScreenStallMock.mock.calls[0][0]).toMatchObject({ duration_ms: 90_000 });
  });

  it('ignores the initial layout when no probe is pending', () => {
    captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    now += 10_000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock).not.toHaveBeenCalled();
  });

  it('stays silent while the diagnostics switch is off', () => {
    captureAppStateListeners();
    useBridgeConfigMock.mockReturnValue({ config: { isSyncTelemetryEnabled: false } });
    const { result } = renderHook(() => useScreenStallProbe({}));

    act(() => result.current.handleTouchStart());
    now += 5000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock).not.toHaveBeenCalled();
  });

  it('discards a pending probe when the app goes to the background', () => {
    const appState = captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    act(() => result.current.handleTouchStart());
    appState.emit('change', 'background');
    now += 60_000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock).not.toHaveBeenCalled();
  });

  it('arms on resume and reports the focus state and transitions seen before it', () => {
    const appState = captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    appState.emit('blur');
    now += 100;
    appState.emit('change', 'active');
    now += 3000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock.mock.calls[0][0]).toMatchObject({
      trigger: 'app_active',
      app_state: 'active',
      window_focused: false,
      duration_ms: 3000,
      transitions: [
        { event: 'blur', at_ms: 1_000_000 },
        { event: 'active', at_ms: 1_000_100 },
      ],
    });
  });

  it('arms on window focus', () => {
    const appState = captureAppStateListeners();
    const { result } = renderHook(() => useScreenStallProbe({}));

    appState.emit('focus');
    now += 2000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock.mock.calls[0][0]).toMatchObject({
      trigger: 'focus',
      window_focused: true,
    });
  });

  it('arms on a window resize and records it as a transition', () => {
    captureAppStateListeners();
    const { result, rerender } = renderHook(() => useScreenStallProbe({}));

    useWindowDimensionsMock.mockReturnValue({ width: 640, height: 800, scale: 1, fontScale: 1 });
    rerender({});
    now += 4000;
    act(() => result.current.handleProbeLayout());

    expect(recordScreenStallMock.mock.calls[0][0]).toMatchObject({
      trigger: 'resize',
      window_width: 640,
      transitions: [{ event: 'resize', at_ms: 1_000_000 }],
    });
  });
});
