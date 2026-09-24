import {
  resolveSyncDiagnosticsDeferralMs,
  resolveSyncDiagnosticsDisposition,
} from '../../../../src/features/sync/sync-diagnostics-disposition.helpers';
import { SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS } from '../../../../src/features/sync/sync-diagnostics-flush.constants';
import type {
  SyncDiagnosticsPostVerdict,
} from '../../../../src/features/sync/sync-diagnostics-flush.types';

/**
 * One POST verdict carrying the three fields the ladder reads, defaulting to the shape of an
 * accepted response so each test names only the field it is about.
 */
function verdict(overrides: Partial<SyncDiagnosticsPostVerdict> = {}): SyncDiagnosticsPostVerdict {
  return { ok: true, status: 204, retryAfterMs: null, ...overrides };
}

/**
 * A focused unit test of the two pure functions extracted from the flush executor. The public-API
 * suite (`sync-diagnostics-flush.helpers.test.ts`) already covers the same ladder end to end
 * through `flushSyncDiagnosticsOutbox`; this file pins the ladder ITSELF, case by case, so a branch
 * this app cannot reach through the executor is still a decision with an asserted answer.
 */
describe('resolveSyncDiagnosticsDisposition', () => {
  it('answers for a non-routable class before it ever looks at a verdict', () => {
    // The classification is the FIRST branch, not a tiebreak: an unclassified row parks and an
    // undeliverable row is destroyed by this build's own declaration, and neither is ever posted,
    // so no verdict exists for them and none could change what happens to them even if one did.
    expect(resolveSyncDiagnosticsDisposition('unclassified', null)).toBe('unclassified');
    expect(resolveSyncDiagnosticsDisposition('undeliverable', null)).toBe('undeliverable');
    expect(
      resolveSyncDiagnosticsDisposition('unclassified', verdict({ ok: false, status: 400 })),
    ).toBe('unclassified');
    expect(
      resolveSyncDiagnosticsDisposition('undeliverable', verdict({ ok: true, status: 204 })),
    ).toBe('undeliverable');
  });

  it('stops when a routable candidate produced no verdict -- the request never reached a verdict', () => {
    // `null` is a transport failure or no post at all: the link or the bridge is down, so the next
    // candidate would fail identically and nothing may be destroyed.
    expect(resolveSyncDiagnosticsDisposition('routable', null)).toBe('stop');
  });

  it('delivers a routable candidate the bridge accepted', () => {
    expect(resolveSyncDiagnosticsDisposition('routable', verdict())).toBe('delivered');
    expect(resolveSyncDiagnosticsDisposition('routable', verdict({ status: 200 }))).toBe(
      'delivered',
    );
  });

  it.each([400, 413])(
    'discards a routable candidate on %d -- the bridge\'s entire permanence declaration',
    (status) => {
      expect(
        resolveSyncDiagnosticsDisposition('routable', verdict({ ok: false, status, retryAfterMs: null })),
      ).toBe('discarded');
    },
  );

  it.each([401, 404, 405, 408, 422, 429, 500, 503])(
    'stops without destroying anything on %d -- the contract declares no permanence for it',
    (status) => {
      // Including 422, which was REMOVED from the permanence set: it was inherited from another
      // endpoint's handler, and an undeclared destructive assumption is exactly what this ladder
      // exists to prevent.
      expect(
        resolveSyncDiagnosticsDisposition('routable', verdict({ ok: false, status, retryAfterMs: null })),
      ).toBe('stop');
    },
  );
});

describe('resolveSyncDiagnosticsDeferralMs', () => {
  it('returns null for a transport failure -- there is no verdict to declare a wait', () => {
    expect(resolveSyncDiagnosticsDeferralMs(null)).toBeNull();
  });

  it('returns the bridge-declared wait for a 503 whose Retry-After never arrived', () => {
    // The bridge has two 503 paths and only the write-budget shed sends the header, so a
    // header-less 503 is the same declaration with the header lost in transit -- the same request
    // for room, answered by the declared amount instead of leaving the gate open.
    expect(
      resolveSyncDiagnosticsDeferralMs(verdict({ ok: false, status: 503, retryAfterMs: null })),
    ).toBe(SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS);
  });

  it('prefers the response\'s own Retry-After over the declared fallback', () => {
    expect(
      resolveSyncDiagnosticsDeferralMs(verdict({ ok: false, status: 503, retryAfterMs: 1_000 })),
    ).toBe(1_000);
    expect(
      resolveSyncDiagnosticsDeferralMs(verdict({ ok: false, status: 429, retryAfterMs: 30_000 })),
    ).toBe(30_000);
  });

  it('honours a declared wait of 0 as a wait, not as absence', () => {
    // The fallback is keyed on `null`, never on falsiness: an explicit `Retry-After: 0` is the
    // bridge's own answer and must not be replaced by the 503 default.
    expect(
      resolveSyncDiagnosticsDeferralMs(verdict({ ok: false, status: 503, retryAfterMs: 0 })),
    ).toBe(0);
  });

  it('invents no wait for any other header-less verdict', () => {
    // Scoped to 503 ALONE: a gate on these would be a backoff this app made up rather than one the
    // bridge asked for -- and the trigger cadence is already the backoff.
    for (const status of [400, 401, 404, 408, 413, 422, 429, 500]) {
      expect(
        resolveSyncDiagnosticsDeferralMs(verdict({ ok: false, status, retryAfterMs: null })),
      ).toBeNull();
    }
  });
});
