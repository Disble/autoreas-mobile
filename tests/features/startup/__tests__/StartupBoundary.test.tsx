import { render } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { StartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/StartupBoundary.component';
import { useStartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/use-startup-boundary';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => undefined),
  setOptions: jest.fn(),
}));

jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactNative = require('react-native');

  const wrap =
    (Component: typeof ReactNative.View | typeof ReactNative.Text) =>
    ({ children, ...props }: { children: React.ReactNode }) =>
      createElement(Component, props, children);

  const Card = Object.assign(wrap(ReactNative.View), {
    Body: wrap(ReactNative.View),
    Description: wrap(ReactNative.Text),
    Footer: wrap(ReactNative.View),
    Header: wrap(ReactNative.View),
    Title: wrap(ReactNative.Text),
  });

  const Alert = Object.assign(wrap(ReactNative.View), {
    Content: wrap(ReactNative.View),
    Description: wrap(ReactNative.Text),
    Indicator: wrap(ReactNative.View),
    Title: wrap(ReactNative.Text),
  });

  return {
    Alert,
    Card,
    HeroUINativeProvider: ({ children }: { children: React.ReactNode }) => children,
    cn: (...classNames: string[]) => classNames.filter(Boolean).join(' '),
  };
});

jest.mock('expo-router', () => ({
  Slot: jest.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native');

    return <ReactNative.Text>mocked-slot</ReactNative.Text>;
  }),
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../../src/contexts/app-theme-context/app-theme-context', () => ({
  AppThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../../src/features/sync/ui/SyncRuntimeGate/SyncRuntimeGate', () => ({
  SyncRuntimeGate: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../../src/features/startup/ui/StartupBoundary/use-startup-boundary', () => ({
  useStartupBoundary: jest.fn(),
}));

describe('StartupBoundary', () => {
  const MockSQLiteProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  beforeEach(() => {
    jest.clearAllMocks();
    (useStartupBoundary as jest.Mock).mockReturnValue({
      bootState: {
        failure: null,
        initialized: true,
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      fontsLoaded: true,
      handleDatabaseInit: jest.fn(),
      isBootstrapped: true,
      preProviderContent: null,
      providerContent: <Slot />,
      rootContent: <Text>mocked-slot</Text>,
      screen: 'route-slot',
      shouldRenderRouteSlot: true,
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: MockSQLiteProvider,
      SQLiteProvider: MockSQLiteProvider,
      startupFailure: null,
      contentWrapper: jest.fn(),
    });
  });

  it('renders the existing routed content after a successful bootstrap', () => {
    const view = render(<StartupBoundary />);

    expect(view.getByText('mocked-slot')).toBeOnTheScreen();
    expect(useStartupBoundary).toHaveBeenCalledTimes(1);
  });

  it('renders a visible startup fallback instead of blank content when bootstrap fails', () => {
    (useStartupBoundary as jest.Mock).mockReturnValue({
      bootState: {
        failure: {
          diagnosticMessage: 'Error al preparar la base local durante el inicio.',
          recoveryHint:
            'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
        },
        initialized: false,
        target: null,
      },
      databaseName: 'autoreas.db',
      fontsLoaded: true,
      handleDatabaseInit: jest.fn(),
      isBootstrapped: false,
      preProviderContent: null,
      providerContent: (
        <React.Fragment>
          <Text>No pudimos iniciar la app</Text>
          <Text>Error al preparar la base local durante el inicio.</Text>
          <Text>
            Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.
          </Text>
        </React.Fragment>
      ),
      rootContent: (
        <React.Fragment>
          <Text>No pudimos iniciar la app</Text>
          <Text>Error al preparar la base local durante el inicio.</Text>
          <Text>
            Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.
          </Text>
        </React.Fragment>
      ),
      screen: 'startup-failure',
      shouldRenderRouteSlot: false,
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: MockSQLiteProvider,
      SQLiteProvider: MockSQLiteProvider,
      startupFailure: {
        diagnosticMessage: 'Error al preparar la base local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      contentWrapper: jest.fn(),
    });

    const view = render(<StartupBoundary />);

    expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(
      view.getByText(
        'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      ),
    ).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
  });

  it('renders the hook-provided pre-provider content without entering the provider shell', () => {
    (useStartupBoundary as jest.Mock).mockReturnValue({
      bootState: {
        failure: null,
        initialized: false,
        target: null,
      },
      contentWrapper: jest.fn(),
      databaseName: 'autoreas.db',
      fontsLoaded: true,
      handleDatabaseInit: jest.fn(),
      isBootstrapped: false,
      preProviderContent: <Text>sqlite-unavailable-screen</Text>,
      providerContent: null,
      rootContent: <Text>sqlite-unavailable-screen</Text>,
      screen: 'sqlite-unavailable',
      shouldRenderRouteSlot: false,
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: null,
      SQLiteProvider: null,
      startupFailure: null,
    });

    const view = render(<StartupBoundary />);

    expect(view.getByText('sqlite-unavailable-screen')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
  });
});
