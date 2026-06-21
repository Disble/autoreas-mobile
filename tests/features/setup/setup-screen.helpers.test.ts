import {
  buildSetupPairParams,
  getSetupFormStateFromPayload,
  getSetupValidationMessage,
  parseSetupDeepLink,
} from '../../../src/features/setup/ui/SetupScreen/setup-screen.helpers';

/**
 * Faithful reproduction of React Native's built-in `URL` polyfill
 * (node_modules/react-native/Libraries/Blob/URL.js). Its `hostname`/`pathname`
 * getters hardcode `^https?:\/\/`, so for the custom `autoreas-mobile://` scheme
 * they return '' / '/'. This is the exact runtime behavior that broke pairing
 * while Node's spec-compliant URL kept the test suite green. Any implementation
 * of `parseSetupDeepLink` that depends on those getters MUST fail under this stub.
 */
class ReactNativeBrokenURL {
  private readonly _url: string;

  constructor(url: string) {
    this._url = url;
  }

  get protocol(): string {
    const match = this._url.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
    return match ? `${match[1]}:` : '';
  }

  get hostname(): string {
    const match = this._url.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/);
    return match ? match[1] : '';
  }

  get pathname(): string {
    const match = this._url.match(/https?:\/\/[^/]+(\/[^?#]*)?/);
    return match ? match[1] || '/' : '/';
  }

  get search(): string {
    const match = this._url.match(/\?([^#]*)/);
    return match ? `?${match[1]}` : '';
  }
}

describe('setup-screen helpers', () => {
  describe('parseSetupDeepLink', () => {
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

    it('accepts a trailing slash before the query string', () => {
      expect(
        parseSetupDeepLink(
          'autoreas-mobile://pair/?v=1&ip=192.168.1.10&port=8080&token=abc',
        ),
      ).toEqual({
        version: '1',
        ip: '192.168.1.10',
        port: '8080',
        token: 'abc',
      });
    });

    it('rejects a non-canonical scheme', () => {
      expect(
        parseSetupDeepLink('autoreas://pair?v=1&ip=192.168.1.10&port=8080&token=abc'),
      ).toBeNull();
    });

    it('rejects a host that only prefixes the canonical one', () => {
      expect(
        parseSetupDeepLink(
          'autoreas-mobile://pairs?v=1&ip=192.168.1.10&port=8080&token=abc',
        ),
      ).toBeNull();
    });

    it('rejects extra path segments after the pair host', () => {
      expect(
        parseSetupDeepLink(
          'autoreas-mobile://pair/extra?v=1&ip=192.168.1.10&port=8080&token=abc',
        ),
      ).toBeNull();
    });

    it('rejects an unsupported contract version', () => {
      expect(
        parseSetupDeepLink(
          'autoreas-mobile://pair?v=2&ip=192.168.1.10&port=8080&token=abc',
        ),
      ).toBeNull();
    });

    it('rejects payloads with missing required fields', () => {
      expect(
        parseSetupDeepLink('autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080'),
      ).toBeNull();
    });

    it('rejects an empty or null input', () => {
      expect(parseSetupDeepLink(null)).toBeNull();
      expect(parseSetupDeepLink('')).toBeNull();
    });

    it('parses the deep link without depending on the global URL host/path getters', () => {
      // Regression guard for the production-only failure: under React Native's URL
      // polyfill, hostname/pathname are empty for custom schemes, so any host/path
      // based parsing returns null and pairing silently fails. Node's URL hid this.
      const RealURL = globalThis.URL;
      // @ts-expect-error -- intentionally swapping in the broken RN implementation.
      globalThis.URL = ReactNativeBrokenURL;

      try {
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
      } finally {
        globalThis.URL = RealURL;
      }
    });
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
