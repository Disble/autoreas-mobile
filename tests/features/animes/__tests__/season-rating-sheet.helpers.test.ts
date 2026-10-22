import {
  buildSeasonRatingComparison,
  buildSeasonRatingSegments,
  getInitialSeasonRatingSelection,
  isSeasonRatingSaveVisible,
} from '../../../../src/features/animes/ui/SeasonRatingSheet/season-rating-sheet.helpers';
import { SEASON_RATING_SHEET_COPY } from '../../../../src/features/animes/ui/SeasonRatingSheet/season-rating-sheet.constants';

describe('buildSeasonRatingSegments', () => {
  /** Reads the six states in rating order. */
  const states = (saved: Parameters<typeof buildSeasonRatingSegments>[0], selected: Parameters<typeof buildSeasonRatingSegments>[1]) =>
    buildSeasonRatingSegments(saved, selected).map((segment) => segment.state);

  it('fills the saved note and rings the draft while they differ, as the approved sheet draws them', () => {
    expect(states(3, 5)).toEqual(['idle', 'idle', 'saved', 'idle', 'draft', 'idle']);
  });

  it('marks only the saved note while nothing changed', () => {
    expect(states(3, 3)).toEqual(['idle', 'idle', 'saved', 'idle', 'idle', 'idle']);
  });

  it('marks nothing for an anime with no note yet', () => {
    expect(states(null, null)).toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle']);
  });

  it('rings a first choice as a draft, since nothing is saved to fill', () => {
    expect(states(null, 4)).toEqual(['idle', 'idle', 'idle', 'draft', 'idle', 'idle']);
  });

  it('lists the six ratings in order', () => {
    expect(buildSeasonRatingSegments(null, null).map((segment) => segment.rating)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('season rating sheet copy', () => {
  it('names the sheet Nota and its action Guardar', () => {
    expect(SEASON_RATING_SHEET_COPY.title).toBe('Tu nota');
    expect(SEASON_RATING_SHEET_COPY.saveButton).toBe('Guardar');
  });

  it('carries no close action and no season picker copy', () => {
    const copy: Record<string, string | undefined> = SEASON_RATING_SHEET_COPY;

    expect(copy.closeButton).toBeUndefined();
    expect(copy.ratingPrompt).toBeUndefined();
    expect(Object.values(copy).join(' ').toLowerCase()).not.toContain('temporada');
  });

  it('carries no sync wording: sync health belongs to the one status card above the list', () => {
    const copy: Record<string, string | undefined> = SEASON_RATING_SHEET_COPY;
    const allCopy = Object.values(copy).join(' ').toLowerCase();

    expect(copy.pendingTitle).toBeUndefined();
    expect(copy.pendingDescription).toBeUndefined();
    expect(copy.failedTitle).toBeUndefined();
    expect(copy.failedDescription).toBeUndefined();
    expect(copy.confirmedTitle).toBeUndefined();
    expect(allCopy).not.toContain('sync');
    expect(allCopy).not.toContain('bridge');
    expect(allCopy).not.toContain('reparaci');
  });
});

describe('season rating sheet helpers', () => {
  it('prefers pending rating over bridge rating for local truth', () => {
    expect(getInitialSeasonRatingSelection(6, 4)).toBe(6);
    expect(getInitialSeasonRatingSelection(null, 4)).toBe(4);
  });
});

describe('buildSeasonRatingComparison', () => {
  it('shows the saved and the draft number only, with a spoken label', () => {
    expect(buildSeasonRatingComparison(3, 5)).toEqual({
      savedValueLabel: '3',
      draftValueLabel: '5',
      accessibilityLabel: 'Nota guardada 3. Nota nueva 5.',
    });
  });

  it('shows nothing while the draft equals the saved note', () => {
    expect(buildSeasonRatingComparison(4, 4)).toBeNull();
    expect(buildSeasonRatingComparison(null, null)).toBeNull();
  });

  it('shows nothing without a saved note to compare against', () => {
    expect(buildSeasonRatingComparison(null, 5)).toBeNull();
  });

  it('shows nothing without a draft value', () => {
    expect(buildSeasonRatingComparison(3, null)).toBeNull();
  });
});

describe('isSeasonRatingSaveVisible', () => {
  it('appears only for a draft that differs from the saved note', () => {
    expect(isSeasonRatingSaveVisible(3, 5)).toBe(true);
    expect(isSeasonRatingSaveVisible(null, 1)).toBe(true);
  });

  it('stays hidden when there is no change to save', () => {
    expect(isSeasonRatingSaveVisible(3, 3)).toBe(false);
    expect(isSeasonRatingSaveVisible(null, null)).toBe(false);
    expect(isSeasonRatingSaveVisible(3, null)).toBe(false);
  });
});
