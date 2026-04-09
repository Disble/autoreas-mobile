import { render } from '@testing-library/react-native';

describe('sqlite unavailable fallback', () => {
  it('renders a clear fallback instead of crashing the route', () => {
    jest.resetModules();

    jest.doMock('expo-sqlite', () => {
      throw new Error("Cannot find native module 'ExpoSQLite'");
    });

    jest.doMock('drizzle-orm/expo-sqlite', () => {
      throw new Error("Cannot find native module 'ExpoSQLite'");
    });

    jest.doMock('../../src/contexts/app-theme-context', () => ({
      useAppTheme: () => ({ isDark: false }),
    }));

    jest.doMock('../../src/components/app-text', () => ({
      AppText: ({ children }: { children: React.ReactNode }) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Text } = require('react-native');

        return <Text>{children}</Text>;
      },
    }));

    jest.doMock('../../src/components/screen-scroll-view', () => ({
      ScreenScrollView: ({ children }: { children: React.ReactNode }) => children,
    }));

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const HomeScreen = require('../../src/app/(home)/index').default;

      const view = render(React.createElement(HomeScreen));

      expect(view.getByText('SQLite no disponible')).toBeOnTheScreen();
      expect(
        view.getByText(/development build o recompila la app nativa/i)
      ).toBeOnTheScreen();
    });
  });
});
