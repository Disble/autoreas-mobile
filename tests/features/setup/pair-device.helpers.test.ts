import {
  buildInitialSyncFailureMessage,
  buildPairRequestFailureMessage,
  buildPairResponseValidationFailureMessage,
  extractHttpStatusFromErrorMessage,
  getMissingPairResponseFields,
} from '../../../src/features/setup/pair-device.helpers';

describe('pair-device.helpers', () => {
  it('maps auth request failures to a friendly token guidance message', () => {
    expect(
      buildPairRequestFailureMessage({
        status: 401,
      }),
    ).toBe('No pudimos emparejar el dispositivo. Verificá o regenerá el token del Bridge e intentá de nuevo.');
  });

  it('maps malformed pair responses to a friendly retry message', () => {
    expect(getMissingPairResponseFields({ device_id: 'dev-123' })).toEqual(['auth_token']);
    expect(
      buildPairResponseValidationFailureMessage({
        missingFields: ['auth_token'],
      }),
    ).toBe('El Bridge respondió con datos incompletos. Volvé a generar el token e intentá de nuevo.');
  });

  it('maps 401 initial sync failures to a friendly re-pair guidance message', () => {
    expect(extractHttpStatusFromErrorMessage('GET /api/animes failed: 500')).toBe(500);
    expect(
      buildInitialSyncFailureMessage({
        cause: 'GET /api/animes failed: 401',
      }),
    ).toBe(
      'Se completó el emparejamiento, pero el Bridge rechazó la sincronización inicial. Volvé a generar el token e intentá de nuevo.',
    );
  });
});
