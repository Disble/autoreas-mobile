import {
  createStartupRecoveryCause,
  hasTerminalStartupFailure,
  shouldArmFontLoadDeadline,
  shouldArmProviderReadinessDeadline,
  shouldNavigateAfterStartup,
  shouldReleaseSplashScreenWithoutProvider,
} from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.helpers';
import type {
  StartupFailure,
  StartupFailureClassification,
} from '../../../../src/features/startup/startup.types';

/** Defines the props the mocked keyboard-controller primitives accept. */
interface MockKeyboardProps {
  readonly children?: React.ReactNode;
}

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: MockKeyboardProps) => children,
  KeyboardProvider: ({ children }: MockKeyboardProps) => children,
}));


/** Builds a terminal startup failure for one classification, so the decisions read real input. */
function createDatabaseFailure(classification: StartupFailureClassification): StartupFailure {
  return {
    diagnostic: { classification, code: null, stage: 'database_preparation' },
    diagnosticMessage: 'Error al preparar la base local durante el inicio.',
    recoveryHint:
      'Cierra y vuelve a abrir la app. Si vuelve a pasar, avisa que falló el inicio local.',
  };
}

describe('startup boundary effect decisions', () => {
  it('arms the font-load deadline only while fonts may still arrive', () => {
    expect(shouldArmFontLoadDeadline(false, null)).toBe(true);
    expect(shouldArmFontLoadDeadline(true, null)).toBe(false);
    expect(shouldArmFontLoadDeadline(false, new Error('font loading exploded'))).toBe(false);
    expect(shouldArmFontLoadDeadline(true, new Error('font loading exploded'))).toBe(false);
  });

  it('arms the provider-readiness deadline only on an unfailed, loaded, provider-mounted startup', () => {
    const failure = createDatabaseFailure('corruption');

    expect(
      shouldArmProviderReadinessDeadline({
        existingStartupFailure: null,
        fontsLoaded: true,
        hasSQLiteProvider: true,
        isReady: false,
      }),
    ).toBe(true);
    // Every blocker keeps the deadline disarmed so normal startup stays uninterrupted.
    expect(
      shouldArmProviderReadinessDeadline({
        existingStartupFailure: failure,
        fontsLoaded: true,
        hasSQLiteProvider: true,
        isReady: false,
      }),
    ).toBe(false);
    expect(
      shouldArmProviderReadinessDeadline({
        existingStartupFailure: null,
        fontsLoaded: false,
        hasSQLiteProvider: true,
        isReady: false,
      }),
    ).toBe(false);
    expect(
      shouldArmProviderReadinessDeadline({
        existingStartupFailure: null,
        fontsLoaded: true,
        hasSQLiteProvider: false,
        isReady: false,
      }),
    ).toBe(false);
    expect(
      shouldArmProviderReadinessDeadline({
        existingStartupFailure: null,
        fontsLoaded: true,
        hasSQLiteProvider: true,
        isReady: true,
      }),
    ).toBe(false);
  });

  it('releases the splash without a provider only after fonts settle on a failed boundary', () => {
    expect(shouldReleaseSplashScreenWithoutProvider(true, false)).toBe(true);
    expect(shouldReleaseSplashScreenWithoutProvider(true, true)).toBe(false);
    expect(shouldReleaseSplashScreenWithoutProvider(false, false)).toBe(false);
  });

  it('reports a terminal startup failure exactly when one exists', () => {
    expect(hasTerminalStartupFailure(null)).toBe(false);
    expect(hasTerminalStartupFailure(createDatabaseFailure('busy'))).toBe(true);
  });

  it('navigates only for a loaded, ready, unfailed startup with a route target', () => {
    const failure = createDatabaseFailure('corruption');

    expect(
      shouldNavigateAfterStartup({
        fontsLoaded: true,
        isReady: true,
        startupFailure: null,
        target: '/setup',
      }),
    ).toBe(true);
    expect(
      shouldNavigateAfterStartup({
        fontsLoaded: true,
        isReady: true,
        startupFailure: failure,
        target: '/setup',
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterStartup({
        fontsLoaded: false,
        isReady: true,
        startupFailure: null,
        target: '/setup',
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterStartup({
        fontsLoaded: true,
        isReady: false,
        startupFailure: null,
        target: '/setup',
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterStartup({
        fontsLoaded: true,
        isReady: true,
        startupFailure: null,
        target: null,
      }),
    ).toBe(false);
  });

  it('builds a recovery cause from the startup-state classification and never from null', () => {
    expect(createStartupRecoveryCause(null)).toBeNull();
    expect(createStartupRecoveryCause('corruption')).toEqual({
      classification: 'corruption',
      kind: 'startup_failure',
    });
  });
});
