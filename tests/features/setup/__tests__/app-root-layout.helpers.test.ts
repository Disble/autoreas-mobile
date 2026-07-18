jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  Slot: jest.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement } = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native');

    return createElement(ReactNative.Text, null, 'mocked-slot');
  }),
}));

jest.mock('../../../../src/components/sqlite-unavailable-screen', () => ({
  SQLiteUnavailableScreen: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement } = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native');

    return createElement(ReactNative.Text, null, 'sqlite-unavailable-screen');
  },
}));

jest.mock(
  '../../../../src/features/setup/ui/AppRootLayout/AppRootLayoutStartupFallback',
  () => ({
    AppRootLayoutStartupFallback: ({
      failure,
    }: {
      failure: { diagnosticMessage: string; recoveryHint: string };
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createElement } = require('react');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ReactNative = require('react-native');

      return createElement(
        ReactNative.Text,
        null,
        `${failure.diagnosticMessage} / ${failure.recoveryHint}`,
      );
    },
  }),
);

import { render } from '@testing-library/react-native';
import {
  resolveAppRootLayoutContent,
  resolveAppRootLayoutScreen,
} from '../../../../src/features/setup/ui/AppRootLayout/app-root-layout.helpers';

function expectElement<T>(value: T | null): T {
  expect(value).not.toBeNull();

  if (value === null) {
    throw new Error('Expected a rendered element.');
  }

  return value;
}

describe('resolveAppRootLayoutScreen', () => {
  it('prioritizes the startup failure screen when bootstrap rejected', () => {
    expect(
      resolveAppRootLayoutScreen({
        fontsLoaded: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: true,
        startupFailure: {
          diagnosticMessage: 'Error al preparar la base local durante el inicio.',
          recoveryHint:
            'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
        },
      }),
    ).toBe('startup-failure');
  });

  it('returns the routed content screen only when startup succeeded cleanly', () => {
    expect(
      resolveAppRootLayoutScreen({
        fontsLoaded: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: true,
        startupFailure: null,
      }),
    ).toBe('route-slot');
  });
});

describe('resolveAppRootLayoutContent', () => {
  it('returns the sqlite unavailable screen before providers when SQLite is missing', () => {
    const resolvedContent = resolveAppRootLayoutContent({
      screen: 'sqlite-unavailable',
      startupFailure: null,
    });

    expect(resolvedContent.providerContent).toBeNull();

    const view = render(expectElement(resolvedContent.preProviderContent));

    expect(view.getByText('sqlite-unavailable-screen')).toBeOnTheScreen();
  });

  it('returns the startup fallback content inside providers when bootstrap fails', () => {
    const resolvedContent = resolveAppRootLayoutContent({
      screen: 'startup-failure',
      startupFailure: {
        diagnosticMessage: 'Error al preparar la base local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
    });

    expect(resolvedContent.preProviderContent).toBeNull();

    const view = render(expectElement(resolvedContent.providerContent));

    expect(
      view.getByText(
        'Error al preparar la base local durante el inicio. / Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      ),
    ).toBeOnTheScreen();
  });

  it('returns the routed slot content when startup succeeds cleanly', () => {
    const resolvedContent = resolveAppRootLayoutContent({
      screen: 'route-slot',
      startupFailure: null,
    });

    expect(resolvedContent.preProviderContent).toBeNull();

    const view = render(expectElement(resolvedContent.providerContent));

    expect(view.getByText('mocked-slot')).toBeOnTheScreen();
  });
});
