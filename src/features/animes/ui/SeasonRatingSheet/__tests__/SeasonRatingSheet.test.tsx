import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SeasonRatingSheet } from '../SeasonRatingSheet';

describe('SeasonRatingSheet', () => {
  it('renders bridge truth and pending local truth separately', () => {
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
    expect(getByText('Tu nota queda guardada en este teléfono hasta que el bridge la confirme.')).toBeTruthy();
  });

  it('submits selected rating intent', () => {
    const onSubmit = jest.fn();
    const { getByLabelText, getByText } = render(
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

    fireEvent.press(getByLabelText('Calificar 6 de 6'));
    fireEvent.press(getByText('Guardar intención'));

    expect(onSubmit).toHaveBeenCalledWith(6);
  });
});
