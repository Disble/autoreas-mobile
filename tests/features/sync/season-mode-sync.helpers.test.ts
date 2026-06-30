import { fetchSeasonModeFromBridge } from '../../../src/features/sync/season-mode-sync.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../src/infrastructure/db/client';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { getStatus: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

const mockGetConfig = getBridgeConfigSnapshot as jest.Mock;
const mockGetStatus = bridgeClient.getStatus as jest.Mock;

describe('fetchSeasonModeFromBridge', () => {
  const rawDb = {} as never;
  const config = { ip: '192.168.1.10', port: 8080, token: 'token123' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the season-mode flag reported by the bridge status', async () => {
    mockGetConfig.mockResolvedValue(config);
    mockGetStatus.mockResolvedValue({ ok: true, data: { status: 'ok', season_mode: true } });

    await expect(fetchSeasonModeFromBridge(rawDb)).resolves.toBe(true);
    expect(mockGetStatus).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });
  });

  it('returns false when the bridge reports season mode off', async () => {
    mockGetConfig.mockResolvedValue(config);
    mockGetStatus.mockResolvedValue({ ok: true, data: { season_mode: false } });

    await expect(fetchSeasonModeFromBridge(rawDb)).resolves.toBe(false);
  });

  it('returns null (does not clobber) when no bridge is paired', async () => {
    mockGetConfig.mockResolvedValue(null);

    await expect(fetchSeasonModeFromBridge(rawDb)).resolves.toBeNull();
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it('returns null on a non-OK status response', async () => {
    mockGetConfig.mockResolvedValue(config);
    mockGetStatus.mockResolvedValue({ ok: false, data: null });

    await expect(fetchSeasonModeFromBridge(rawDb)).resolves.toBeNull();
  });

  it('returns null when the bridge is unreachable', async () => {
    mockGetConfig.mockResolvedValue(config);
    mockGetStatus.mockRejectedValue(new Error('unreachable'));

    await expect(fetchSeasonModeFromBridge(rawDb)).resolves.toBeNull();
  });
});
