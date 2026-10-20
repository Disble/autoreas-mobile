import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SeasonRatingSheet } from '../../../../src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet';

describe('SeasonRatingSheet', () => {
  it('names the sheet Nota and does not repeat the anime title under it', () => {
    const { getByTestId, getByText, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
      />,
    );

    expect(getByText('Nota')).toBeTruthy();
    expect(queryByText('Kaiju No. 8')).toBeNull();
    expect(getByTestId('heroui-bottom-sheet-content').props.accessibilityLabel).toBe('Nota');
  });

  it('never renders a season selector', () => {
    const { queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Blue Lock"
        bridgeRating={null}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
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
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
      />,
    );

    expect(queryByText('Cerrar')).toBeNull();
  });

  it('keeps bridge truth and pending local truth separately', () => {
    const { getByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingFailureKind={null}
        pendingRating={5}
        pendingStatus="pending"
      />,
    );

    expect(getByText('Bridge confirmó esta nota')).toBeTruthy();
    expect(getByText('3/6')).toBeTruthy();
    expect(getByText('Pendiente de sync')).toBeTruthy();
    expect(
      getByText('Tu nota queda guardada en este teléfono hasta que el bridge la confirme.'),
    ).toBeTruthy();
  });

  it('compares the saved and the draft number with a prominent arrow when they differ', () => {
    const { getByLabelText, getByTestId } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
      />,
    );

    fireEvent.press(getByLabelText('Calificar 5 de 6'));

    const comparison = getByTestId('season-rating-comparison');

    expect(within(comparison).getByText('3')).toBeTruthy();
    expect(within(comparison).getByText('→')).toBeTruthy();
    expect(within(comparison).getByText('5')).toBeTruthy();
    expect(comparison.props.accessibilityLabel).toBe('Nota guardada 3. Nota nueva 5.');
    expect(comparison.props.accessibilityLiveRegion).toBe('polite');
    expect(within(comparison).getByText('3').props.className).toContain('text-accent');
    expect(getByTestId('season-rating-draft').props.style).toMatchObject({
      borderColor: 'mocked---color-secondary',
    });
  });

  it('shows neither the comparison nor an action while the value is unchanged', () => {
    const { getByLabelText, queryByTestId, queryByText } = render(
      <SeasonRatingSheet
        animeTitle="Kaiju No. 8"
        bridgeRating={3}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
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
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
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
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
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
        pendingFailureKind={null}
        pendingRating={null}
        pendingStatus={null}
      />,
    );

    getByTestId('heroui-bottom-sheet-content').props.onAccessibilityEscape();

    expect(onClose).toHaveBeenCalled();
  });
});
