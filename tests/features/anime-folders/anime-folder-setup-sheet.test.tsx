import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AnimeFolderSetupSheet } from '../../../src/features/anime-folders/ui/AnimeFolderSetupSheet/AnimeFolderSetupSheet';

/** Props the mocked bottom sheet primitives accept. */
interface MockSheetProps {
  readonly children?: ReactNode;
  readonly isOpen?: boolean;
}

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

/**
 * `BottomSheet` renders through a portal and `Button` reads animation settings, both from the
 * library provider, so they pass their children through. A closed sheet renders nothing, as the
 * real one does.
 */
jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('heroui-native');
  const pass = ({ children }: MockSheetProps) => React.createElement(RN.View, null, children);
  const BottomSheet = Object.assign(
    ({ children, isOpen }: MockSheetProps) =>
      isOpen ? React.createElement(RN.View, null, children) : null,
    {
      Portal: pass,
      Overlay: () => null,
      Content: pass,
      Title: ({ children }: MockSheetProps) => React.createElement(RN.Text, null, children),
    },
  );

  const Button = Object.assign(
    ({ children, onPress }: MockSheetProps & { readonly onPress?: () => void }) =>
      React.createElement(RN.Pressable, { onPress }, children),
    { Label: ({ children }: MockSheetProps) => React.createElement(RN.Text, null, children) },
  );

  return { ...actual, BottomSheet, Button };
});

/** Renders the sheet open, with spies for its two actions. */
function renderOpenSheet() {
  const onClose = jest.fn();
  const onChoose = jest.fn();
  const screen = render(<AnimeFolderSetupSheet isOpen onClose={onClose} onChoose={onChoose} />);

  return { ...screen, onClose, onChoose };
}

describe('AnimeFolderSetupSheet', () => {
  it('explains the three picker steps with the approved copy', () => {
    const { getByText } = renderOpenSheet();

    expect(getByText('Elige tu carpeta de anime')).toBeTruthy();
    expect(
      getByText(
        'Selecciona la carpeta de esta tablet donde guardas los animes, por ejemplo SD card › Videos › Anime. Autoreas busca dentro la carpeta de cada anime para abrirla con un toque.',
      ),
    ).toBeTruthy();
    expect(getByText('PASO 1')).toBeTruthy();
    expect(getByText('Entra en la carpeta que contiene tus animes')).toBeTruthy();
    expect(getByText('PASO 2')).toBeTruthy();
    expect(getByText('Toca «Usar esta carpeta»')).toBeTruthy();
    expect(getByText('PASO 3')).toBeTruthy();
    expect(getByText('Toca «Permitir» en el aviso de Android')).toBeTruthy();
    expect(
      getByText('Solo lee los nombres de las carpetas. No abre, mueve ni borra tus videos.'),
    ).toBeTruthy();
  });

  it('closes on "Ahora no" and chooses on "Elegir carpeta"', () => {
    const { getByText, onClose, onChoose } = renderOpenSheet();

    fireEvent.press(getByText('Ahora no'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.press(getByText('Elegir carpeta'));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    const { queryByText } = render(
      <AnimeFolderSetupSheet isOpen={false} onClose={jest.fn()} onChoose={jest.fn()} />,
    );

    expect(queryByText('Elige tu carpeta de anime')).toBeNull();
  });
});
