import { fireEvent, render } from '@testing-library/react-native';
import { createElement, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppThemeProvider, useAppTheme } from '../../../src/contexts/app-theme-context';

/** Theme name the mocked `useUniwind` reports, standing in for the native runtime. */
let mockTheme = 'light';

/** Spy standing in for the native theme setter the provider delegates to. */
const mockSetTheme = jest.fn();

jest.mock('uniwind', () => {
  const actual = jest.requireActual<typeof import('uniwind')>('uniwind');

  return {
    ...actual,
    Uniwind: {
      ...actual.Uniwind,
      setTheme: (theme: string) => {
        mockSetTheme(theme);
      },
    },
    useUniwind: () => ({ theme: mockTheme }),
  };
});

/** Renders the context value as text and exposes its actions as pressable probes. */
function ThemeProbe(): ReactElement {
  const { currentTheme, isLight, isDark, setTheme, toggleTheme } = useAppTheme();

  return createElement(
    View,
    null,
    createElement(
      Text,
      { testID: 'theme-state' },
      `${currentTheme} light=${isLight} dark=${isDark}`,
    ),
    createElement(Pressable, { testID: 'theme-toggle', onPress: toggleTheme }),
    createElement(Pressable, {
      testID: 'theme-set-dark',
      onPress: () => {
        setTheme('dark');
      },
    }),
  );
}

/** Renders the real provider around the probe, which is the only theme subject. */
function renderProbe() {
  return render(createElement(AppThemeProvider, null, createElement(ThemeProbe)));
}

describe('AppThemeProvider', () => {
  beforeEach(() => {
    mockTheme = 'light';
    mockSetTheme.mockClear();
  });

  it('reports the light theme as light and not dark', () => {
    mockTheme = 'light';

    const view = renderProbe();

    expect(view.getByTestId('theme-state')).toHaveTextContent('light light=true dark=false');
  });

  it('reports the dark theme as dark and not light', () => {
    mockTheme = 'dark';

    const view = renderProbe();

    expect(view.getByTestId('theme-state')).toHaveTextContent('dark light=false dark=true');
  });

  it('reports neither mode for a theme name outside the supported pair', () => {
    mockTheme = 'standalone';

    const view = renderProbe();

    expect(view.getByTestId('theme-state')).toHaveTextContent(
      'standalone light=false dark=false',
    );
  });

  it('toggles from light to dark', () => {
    const view = renderProbe();

    fireEvent.press(view.getByTestId('theme-toggle'));

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('toggles from dark to light', () => {
    mockTheme = 'dark';

    const view = renderProbe();

    fireEvent.press(view.getByTestId('theme-toggle'));

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('forwards an explicit theme choice to the theme runtime', () => {
    const view = renderProbe();

    fireEvent.press(view.getByTestId('theme-set-dark'));

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('rejects use outside the provider with the documented message', () => {
    expect(() => render(createElement(ThemeProbe))).toThrow(
      'useAppTheme must be used within AppThemeProvider',
    );
  });
});
