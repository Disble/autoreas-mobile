import { render, screen } from '@testing-library/react-native';
import React from 'react';
import HomeScreen from '../../src/app/(home)/index';

jest.mock('../../src/contexts/app-theme-context', () => ({
  useAppTheme: () => ({ isDark: false }),
}));

jest.mock('../../src/components/screen-scroll-view', () => ({
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../../src/components/app-text', () => ({
  AppText: ({ children }: { children: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');

    return <Text>{children}</Text>;
  },
}));

describe('app shell bootstrap', () => {
  it('renders the current Autoreas home shell copy', () => {
    render(<HomeScreen />);

    expect(screen.getByText('Autoreas Mobile')).toBeOnTheScreen();
    expect(screen.getByText('Offline-first anime tracker')).toBeOnTheScreen();
  });
});
