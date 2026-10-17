import { act, renderHook } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

/** Builds a WebSocket test double whose handlers start null so a test can fire them by hand. */
function buildWsMock() {
  return {
    onopen: null as ((e: Event) => void) | null,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onclose: null as ((e: CloseEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    close: jest.fn(),
    readyState: WebSocket.CONNECTING as number,
  };
}

/** Lets the config read and the connect resolve. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Fires the pending reconnect timer and lets the next connect build its socket. */
async function fireReconnectTimer(): Promise<void> {
  await act(async () => {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWebSocket disconnect (ADR 009 R-9): a drop of an open socket asks the runtime to re-check', () => {
  const rawDb = { name: 'raw-db' };
  const mockConfig = { ip: '192.168.1.10', port: 9876, token: 'token123' };
  let sockets: ReturnType<typeof buildWsMock>[];

  /** The socket the hook built last. */
  const current = () => sockets[sockets.length - 1];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sockets = [];

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(mockConfig);

    global.WebSocket = jest.fn().mockImplementation(() => {
      const socket = buildWsMock();
      sockets.push(socket);
      return socket;
    }) as unknown as typeof WebSocket;
    (global.WebSocket as typeof WebSocket & { OPEN: number; CONNECTING: number }).OPEN = 1;
    (global.WebSocket as typeof WebSocket & { OPEN: number; CONNECTING: number }).CONNECTING = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('D1 reports the close of a socket that opened, and still schedules the reconnect', async () => {
    const onDisconnected = jest.fn();
    renderHook(() => useWebSocket({ enabled: true, onDisconnected }));
    await flush();
    act(() => { current().onopen?.({} as Event); });

    act(() => { current().onclose?.({} as CloseEvent); });

    expect(onDisconnected).toHaveBeenCalledTimes(1);
    await fireReconnectTimer();
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('D2 does not report the close of a socket that never opened', async () => {
    const onDisconnected = jest.fn();
    renderHook(() => useWebSocket({ enabled: true, onDisconnected }));
    await flush();

    act(() => { current().onclose?.({} as CloseEvent); });
    await fireReconnectTimer();
    act(() => { current().onclose?.({} as CloseEvent); });

    expect(onDisconnected).not.toHaveBeenCalled();
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('D3 does not report the close the unmount cleanup causes', async () => {
    const onDisconnected = jest.fn();
    const { unmount } = renderHook(() => useWebSocket({ enabled: true, onDisconnected }));
    await flush();
    const socket = current();
    act(() => { socket.onopen?.({} as Event); });

    unmount();
    act(() => { socket.onclose?.({} as CloseEvent); });

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('D4 does not report the close the runtime causes by disabling the socket (backgrounding)', async () => {
    const onDisconnected = jest.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWebSocket({ enabled, onDisconnected }),
      { initialProps: { enabled: true } },
    );
    await flush();
    const socket = current();
    act(() => { socket.onopen?.({} as Event); });

    rerender({ enabled: false });
    act(() => { socket.onclose?.({} as CloseEvent); });

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('D5 reports each drop of a flapping socket once and keeps reporting reconnects', async () => {
    const onDisconnected = jest.fn();
    const onReconnected = jest.fn();
    renderHook(() => useWebSocket({ enabled: true, onDisconnected, onReconnected }));
    await flush();

    for (let drop = 0; drop < 3; drop += 1) {
      act(() => { current().onopen?.({} as Event); });
      act(() => { current().onclose?.({} as CloseEvent); });
      await fireReconnectTimer();
    }

    expect(onDisconnected).toHaveBeenCalledTimes(3);
    expect(onReconnected).toHaveBeenCalledTimes(2);
    expect(global.WebSocket).toHaveBeenCalledTimes(4);
  });
});
