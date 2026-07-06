import {
  buildSeasonRatingBridgeSummary,
  buildSeasonRatingSheetStatus,
  getInitialSeasonRatingSelection,
} from '../season-rating-sheet.helpers';

describe('season rating sheet helpers', () => {
  it('prefers pending rating over bridge rating for local truth', () => {
    expect(getInitialSeasonRatingSelection(6, 4)).toBe(6);
    expect(getInitialSeasonRatingSelection(null, 4)).toBe(4);
  });

  it('formats confirmed bridge summary and missing summary', () => {
    expect(buildSeasonRatingBridgeSummary(5)).toEqual({
      title: 'Bridge confirmó esta nota',
      valueLabel: '5/6',
    });
    expect(buildSeasonRatingBridgeSummary(null)).toEqual({
      title: 'Nota actual del bridge',
      valueLabel: 'Sin nota confirmada todavía',
    });
  });

  it('builds pending and failed status copy without claiming bridge confirmation', () => {
    expect(
      buildSeasonRatingSheetStatus({
        pendingStatus: 'pending',
        pendingFailureKind: null,
      }),
    ).toEqual({
      kind: 'pending',
      label: 'Pendiente de sync',
      description:
        'Tu nota queda guardada en este teléfono hasta que el bridge la confirme.',
    });

    expect(
      buildSeasonRatingSheetStatus({
        pendingStatus: 'failed',
        pendingFailureKind: 'auth_repair',
      }),
    ).toEqual({
      kind: 'failed',
      label: 'Requiere reparación',
      description:
        'La nota quedó guardada. Revisá el bridge para reintentar sin perder la intención.',
    });
  });
});
