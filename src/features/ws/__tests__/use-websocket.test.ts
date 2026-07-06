import { renderHook, waitFor } from '@testing-library/react-native';
import { bridgeClient } from '../../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../infrastructure/db/client';
import { useOptionalSQLiteContext } from '../../../infrastructure/db/native-runtime';
import { useWebSocket } from '../use-websocket';

jest.mock('../../../infrastructure/api', () => ({
  bridgeClient: {
    openWebSocket: jest.fn(),
  },
}));

jest.mock('../../../infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useWebSocket', () => {
  it('routes season_changed through the dedicated callback and ignores unknown frames', async () => {
    const close = jest.fn();
    const socket: {
      readyState: number;
      close: jest.Mock;
      onopen: (() => void) | null;
      onmessage: ((event: MessageEvent) => void) | null;
      onclose: (() => void) | null;
      onerror: (() => void) | null;
    } = {
      readyState: 0,
      close,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const onSeasonChanged = jest.fn();

    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (bridgeClient.openWebSocket as jest.Mock).mockReturnValue(socket);

    renderHook(() =>
      useWebSocket({
        enabled: true,
        onSeasonChanged,
      }),
    );

    await waitFor(() => {
      expect(bridgeClient.openWebSocket).toHaveBeenCalled();
    });

    socket.onmessage?.({
      data: JSON.stringify({ type: 'season_changed' }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: 'totally_unknown' }),
    } as MessageEvent);

    expect(onSeasonChanged).toHaveBeenCalledTimes(1);
  });
});
