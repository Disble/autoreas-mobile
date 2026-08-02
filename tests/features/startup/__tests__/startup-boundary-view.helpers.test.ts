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
  '../../../../src/features/startup/ui/StartupBoundary/StartupBoundaryFallback',
  () => ({
    StartupBoundaryFallback: ({
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
  resolveStartupBoundaryContent,
  resolveStartupBoundaryScreen,
} from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.helpers';

function expectElement<T>(value: T | null): T {
  expect(value).not.toBeNull();

  if (value === null) {
    throw new Error('Expected a rendered element.');
  }

  return value;
}

describe('resolveStartupBoundaryScreen', () => {
  it('prioritizes the startup failure screen when bootstrap rejected', () => {
    expect(
      resolveStartupBoundaryScreen({
        fontsLoaded: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: true,
        startupFailure: {
          diagnostic: {
            stage: 'database_preparation',
            code: 'SQLITE_ERROR',
            classification: 'sqlite',
          },
          diagnosticMessage: 'Error al preparar la base local durante el inicio.',
          recoveryHint:
            'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
        },
      }),
    ).toBe('startup-failure');
  });

  it('returns the routed content screen only when startup succeeded cleanly', () => {
    expect(
      resolveStartupBoundaryScreen({
        fontsLoaded: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: true,
        startupFailure: null,
      }),
    ).toBe('route-slot');
  });
});

describe('resolveStartupBoundaryContent', () => {
  it('returns the sqlite unavailable screen before providers when SQLite is missing', () => {
    const resolvedContent = resolveStartupBoundaryContent({
      screen: 'sqlite-unavailable',
      startupFailure: null,
    });

    expect(resolvedContent.providerContent).toBeNull();

    const view = render(expectElement(resolvedContent.preProviderContent));

    expect(view.getByText('sqlite-unavailable-screen')).toBeOnTheScreen();
  });

  it('returns the startup fallback content inside providers when bootstrap fails', () => {
    const resolvedContent = resolveStartupBoundaryContent({
      screen: 'startup-failure',
      startupFailure: {
        diagnostic: {
          stage: 'database_preparation',
          code: 'SQLITE_ERROR',
          classification: 'sqlite',
        },
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
    const resolvedContent = resolveStartupBoundaryContent({
      screen: 'route-slot',
      startupFailure: null,
    });

    expect(resolvedContent.preProviderContent).toBeNull();

    const view = render(expectElement(resolvedContent.providerContent));

    expect(view.getByText('mocked-slot')).toBeOnTheScreen();
  });
});
