import {
  buildSetupPairParams,
  getSetupFormStateFromPayload,
  getSetupValidationMessage,
  parseSetupDeepLink,
} from '../../../src/features/setup/ui/SetupScreen/setup-screen.helpers';

describe('setup-screen helpers', () => {
  it('accepts the canonical autoreas-mobile pairing contract', () => {
    expect(
      parseSetupDeepLink(
        'autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080&token=abc',
      ),
    ).toEqual({
      version: '1',
      ip: '192.168.1.10',
      port: '8080',
      token: 'abc',
    });
  });

  it('rejects non-canonical scheme, path, version, or missing fields', () => {
    expect(
      parseSetupDeepLink('autoreas://pair?v=1&ip=192.168.1.10&port=8080&token=abc'),
    ).toBeNull();
    expect(
      parseSetupDeepLink(
        'autoreas-mobile://pair/extra?v=1&ip=192.168.1.10&port=8080&token=abc',
      ),
    ).toBeNull();
    expect(
      parseSetupDeepLink(
        'autoreas-mobile://pair?v=2&ip=192.168.1.10&port=8080&token=abc',
      ),
    ).toBeNull();
    expect(
      parseSetupDeepLink('autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080'),
    ).toBeNull();
  });

  it('maps a parsed payload into the shared setup form state and submit params', () => {
    const formState = getSetupFormStateFromPayload({
      version: '1',
      ip: '192.168.1.10',
      port: '8080',
      token: 'abc',
    });

    expect(formState).toEqual({
      ip: '192.168.1.10',
      port: '8080',
      token: 'abc',
    });
    expect(buildSetupPairParams(formState)).toEqual({
      ip: '192.168.1.10',
      port: 8080,
      token: 'abc',
    });
  });

  it('validates missing fields and invalid ports for manual fallback editing', () => {
    expect(
      getSetupValidationMessage({ ip: '', port: '8080', token: 'abc' }),
    ).toBe('Todos los campos son obligatorios.');
    expect(
      getSetupValidationMessage({ ip: '192.168.1.10', port: 'port', token: 'abc' }),
    ).toBe('El puerto debe ser un número válido.');
    expect(
      getSetupValidationMessage({ ip: '192.168.1.10', port: '70000', token: 'abc' }),
    ).toBe('El puerto debe estar entre 1 y 65535.');
  });
});
