import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { AnimeListScreenListHead } from '../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenListHead';
import type { AnimeListScreenListHeadProps } from '../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types';
import { SeasonRatingSheet } from '../../../../src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet';

jest.mock('../../../../src/features/anime-folders/ui/AnimeFolderBanner', () => ({
  AnimeFolderBanner: () => null,
}));

/** Fixture contextual header for the shared status card, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_CONTEXTUAL_HEADER = {
  title: 'Martes',
  subtitle: '1 anime',
  isToday: true,
};

/** Fixture sync status for the shared status card, hoisted so the prop is not a fresh object per render. */
const STATUS_SECTION_SYNC_STATUS: AnimeListScreenListHeadProps['syncStatus'] = {
  actionLabel: null,
  chipLabel: 'Envío rechazado',
  description: 'La PC respondió, pero rechazó el envío.',
  kind: 'rejected',
  title: 'La PC no aceptó tus cambios',
  tone: 'danger',
};

/** Renders the one shared sync surface that sits above the list. */
function renderStatusSection() {
  return (
    <AnimeListScreenListHead
      contextualHeader={STATUS_SECTION_CONTEXTUAL_HEADER}
      handleOpenSettings={jest.fn()}
      isSeasonMode
      syncStatus={STATUS_SECTION_SYNC_STATUS}
    />
  );
}

describe('SeasonRatingSheet', () => {
  it('names the sheet Nota and does not repeat the anime title under it', () => {
    const { getByTestId, getByText, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    expect(getByText('Tu nota')).toBeTruthy();
    expect(queryByText('Kaiju No. 8')).toBeNull();
    expect(getByTestId('heroui-bottom-sheet-content').props.accessibilityLabel).toBe('Tu nota');
  });

  it('never renders a season selector', () => {
    const { queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={null}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    expect(queryByText(/temporada/i)).toBeNull();
  });

  it('offers no close button', () => {
    const { queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={2}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    expect(queryByText('Cerrar')).toBeNull();
  });

  it('carries no sync wording of its own, for any saved or pending note', () => {
    const { getByTestId } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={5}
      />,
    );

    const sheet = getByTestId('heroui-bottom-sheet-content');

    expect(within(sheet).queryByText(/sync/i)).toBeNull();
    expect(within(sheet).queryByText(/reparación/i)).toBeNull();
    expect(within(sheet).queryByText(/bridge/i)).toBeNull();
    expect(within(sheet).queryByText('Pendiente de sync')).toBeNull();
    expect(within(sheet).queryByText('Requiere reparación')).toBeNull();
    expect(within(sheet).queryByText('Bridge confirmó esta nota')).toBeNull();
  });

  it('renders no status alert while the list-head alert still renders its chip', () => {
    const { getAllByTestId, getByText } = render(
      <>
        {renderStatusSection()}
        <SeasonRatingSheet
          animeTitle="Kaiju No. 8"
          bridgeRating={3}
          isOpen
          onClose={jest.fn()}
          onSubmit={jest.fn()}
          pendingRating={5}
        />
      </>,
    );

    expect(getByText('Envío rechazado')).toBeTruthy();
    expect(getAllByTestId('heroui-alert')).toHaveLength(1);
  });

  it('compares the saved and the draft number on one plain line when they differ', () => {
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    fireEvent.press(getByLabelText('Calificar 5 de 6'));

    const comparison = getByTestId('season-rating-comparison');

    expect(within(comparison).getByText('3')).toBeTruthy();
    expect(within(comparison).getByText('→')).toBeTruthy();
    expect(within(comparison).getByText('5')).toBeTruthy();
    expect(comparison.props.accessibilityLabel).toBe('Nota guardada 3. Nota nueva 5.');
    expect(comparison.props.accessibilityLiveRegion).toBe('polite');
    // The colours live on the rating track (saved filled, draft ringed); the line is plain text.
    expect(within(comparison).getByText('3').props.className).toContain('text-reading');
    expect(within(comparison).getByText('5').props.className).toContain('text-reading');
    expect(within(comparison).getByText('3').props.className).toContain('text-[13px]');
    expect(queryByTestId('season-rating-draft')).toBeNull();
  });

  it('draws the six ratings as one track with no prompt above it', () => {
    const { getByLabelText, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    fireEvent.press(getByLabelText('Calificar 5 de 6'));

    expect(queryByText('Elige una nota')).toBeNull();
    expect(getByLabelText('Calificar 3 de 6').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByLabelText('Calificar 5 de 6').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByLabelText('Calificar 4 de 6').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('shows neither the comparison nor an action while the value is unchanged', () => {
    const { getByLabelText, queryByTestId, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    expect(queryByTestId('season-rating-comparison')).toBeNull();
    expect(queryByText('Guardar')).toBeNull();

    fireEvent.press(getByLabelText('Calificar 3 de 6'));

    expect(queryByTestId('season-rating-comparison')).toBeNull();
    expect(queryByText('Guardar')).toBeNull();
  });

  it('submits a changed rating through an enabled Guardar action', () => {
    const onSubmit = jest.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={null}
        isOpen
        onClose={jest.fn()}
        onSubmit={onSubmit}
        pendingRating={null}
      />,
    );

    expect(queryByText('Guardar')).toBeNull();

    fireEvent.press(getByLabelText('Calificar 6 de 6'));

    const saveButton = getByLabelText('Guardar');

    expect(saveButton.props.disabled).not.toBe(true);
    expect(getByText('Guardar')).toBeTruthy();

    fireEvent.press(saveButton);

    expect(onSubmit).toHaveBeenCalledWith(6);
  });

  it('closes from the backdrop', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={2}
        isOpen
        onClose={onClose}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    fireEvent.press(getByTestId('heroui-bottom-sheet-overlay'));

    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the accessibility escape without a close control', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={2}
        isOpen
        onClose={onClose}
        onSubmit={jest.fn()}
        pendingRating={null}
      />,
    );

    getByTestId('heroui-bottom-sheet-content').props.onAccessibilityEscape();

    expect(onClose).toHaveBeenCalled();
  });
});
