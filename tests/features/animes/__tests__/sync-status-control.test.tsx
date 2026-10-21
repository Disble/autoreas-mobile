import React from 'react';
import { fireEvent, render, renderHook } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { SyncStatusSheet } from '../../../../src/features/animes/ui/SyncStatusControl';
import {
  deriveSyncStatusIndicator,
  deriveSyncStatusSecondLine,
  shouldShowSyncStatusAlert,
} from '../../../../src/features/animes/ui/SyncStatusControl/sync-status-control.helpers';
import { useSyncStatusDot } from '../../../../src/features/animes/ui/SyncStatusControl/use-sync-status-dot';
import type { AnimeListScreenVisibleSyncStatus } from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types';
import type { SyncVisibleStatusKind } from '../../../../src/features/sync/sync-visible-status.types';

/** Builds a visible sync status of the given kind, overriding any field. */
function buildStatus(
  kind: SyncVisibleStatusKind,
  overrides: Partial<AnimeListScreenVisibleSyncStatus> = {},
): AnimeListScreenVisibleSyncStatus {
  return {
    actionLabel: null,
    chipLabel: 'Al día',
    description: 'Último sync hace un momento.',
    kind,
    title: 'Al día',
    tone: 'success',
    ...overrides,
  };
}

/** Renders the sync sheet open with the given status and manual-sync gate. */
function renderSheet(
  status: AnimeListScreenVisibleSyncStatus,
  overrides: Partial<React.ComponentProps<typeof SyncStatusSheet>> = {},
) {
  const props = {
    isManualSyncEnabled: true,
    isOpen: true,
    onAction: jest.fn(),
    onClose: jest.fn(),
    onSyncNow: jest.fn().mockResolvedValue(undefined),
    status,
    ...overrides,
  };
  return { props, ...render(<SyncStatusSheet {...props} />) };
}

describe('sync status indicator', () => {
  it.each([
    ['synced', 'dot', 'success'],
    ['syncing', 'dot', 'accent'],
    ['queued', 'dot', 'accent'],
    ['waiting', 'dot', 'warning'],
    ['stale', 'dot', 'warning'],
    ['rejected', 'dot', 'danger'],
    ['offline', 'wifi-off', 'muted'],
    ['local', 'device', 'muted'],
  ] as const)('draws %s as a %s in %s', (kind, glyph, color) => {
    expect(deriveSyncStatusIndicator({ kind })).toEqual(expect.objectContaining({ glyph, color }));
  });

  it('breathes only while a sync runs', () => {
    expect(deriveSyncStatusIndicator({ kind: 'syncing' }).isBreathing).toBe(true);
    expect(deriveSyncStatusIndicator({ kind: 'queued' }).isBreathing).toBe(false);
  });

  it('raises the alert only for a rejected send or a backlog stale past 72 h', () => {
    expect(shouldShowSyncStatusAlert({ kind: 'rejected' })).toBe(true);
    expect(shouldShowSyncStatusAlert({ kind: 'stale' })).toBe(true);
    expect(shouldShowSyncStatusAlert({ kind: 'waiting' })).toBe(false);
    expect(shouldShowSyncStatusAlert({ kind: 'synced' })).toBe(false);
  });
});

describe('useSyncStatusDot', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts the breath while syncing', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const withRepeat = jest.spyOn(Reanimated, 'withRepeat');

    renderHook(() => useSyncStatusDot('#00ff00', true));

    expect(withRepeat).toHaveBeenCalledWith(expect.anything(), -1, true);
  });

  it('keeps the dot still when reduce motion is on', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const withRepeat = jest.spyOn(Reanimated, 'withRepeat');

    renderHook(() => useSyncStatusDot('#00ff00', true));

    expect(withRepeat).not.toHaveBeenCalled();
  });
});

describe('SyncStatusSheet', () => {
  it('names the state once when the title repeats the chip, with the description below', () => {
    const { getAllByText, getByText } = renderSheet(buildStatus('synced'));

    expect(getByText('Sincronización')).toBeTruthy();
    expect(getAllByText('Al día')).toHaveLength(1);
    expect(getByText('Último sync hace un momento.')).toBeTruthy();
    expect(deriveSyncStatusSecondLine(buildStatus('synced'))).toBeNull();
  });

  it('adds the title as a second line when it says something new', () => {
    const { getByText } = renderSheet(
      buildStatus('queued', { chipLabel: 'Por enviar', title: 'Bridge conectado', tone: 'default' }),
    );

    expect(getByText('Por enviar')).toBeTruthy();
    expect(getByText('Bridge conectado')).toBeTruthy();
  });

  it('splits two full-width actions equally, the state action first as primary', () => {
    const { getByText, props } = renderSheet(
      buildStatus('queued', { actionLabel: 'Revisar conexión', chipLabel: 'Por enviar' }),
    );

    const action = getByText('Revisar conexión');
    const syncNow = getByText('Sincronizar ahora');
    fireEvent.press(action);
    fireEvent.press(syncNow);

    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onAction).toHaveBeenCalledTimes(1);
    expect(props.onSyncNow).toHaveBeenCalledTimes(1);
  });

  it('leaves out "Sincronizar ahora" while a sync runs or when no manual sync is possible', () => {
    expect(renderSheet(buildStatus('syncing')).queryByText('Sincronizar ahora')).toBeNull();
    expect(
      renderSheet(buildStatus('offline'), { isManualSyncEnabled: false }).queryByText(
        'Sincronizar ahora',
      ),
    ).toBeNull();
  });

  it('has no close button', () => {
    const { queryByText } = renderSheet(buildStatus('synced'));

    expect(queryByText('Cerrar')).toBeNull();
  });
});
