import {
  readSyncDiagnosticsRefusalCode,
  resolveSyncDiagnosticsDeferralMs,
  resolveSyncDiagnosticsDisposition,
  shouldReapSyncDiagnosticsParkedRow,
} from '../../../../src/features/sync/sync-diagnostics-disposition.helpers';
import { flushSyncDiagnosticsOutbox } from '../../../../src/features/sync/sync-diagnostics-flush.helpers';
import { SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS } from '../../../../src/features/sync/sync-diagnostics-flush.constants';
import type {
  SyncDiagnosticsEnvelopeDisposition,
  SyncDiagnosticsFlushResult,
  SyncDiagnosticsPostVerdict,
} from '../../../../src/features/sync/sync-diagnostics-flush.types';
import type {
  SyncDiagnosticsOutboxRecord,
  SyncDiagnosticsOutboxStore,
} from '../../../../src/infrastructure/db/sync-diagnostics-outbox';
import type { BridgeHttpResult } from '../../../../src/infrastructure/api/bridge-client/bridge-client.types';

/**
 * One POST verdict carrying the four fields the ladder reads, defaulting to the shape of an
 * accepted response so each test names only the field it is about.
 */
function verdict(overrides: Partial<SyncDiagnosticsPostVerdict> = {}): SyncDiagnosticsPostVerdict {
  return { ok: true, status: 204, retryAfterMs: null, refusalCode: null, ...overrides };
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

  it('discards a routable candidate on a 413 that declares NO code -- size is a property of the bytes', () => {
    // `413` is permanent ON ITS OWN, code or no code: a body that is too large is too large for
    // every build there will ever be, and no release makes these same bytes smaller. Written as a
    // LITERAL so the status the ladder reads stays load-bearing -- mutating it must fail this test.
    expect(
      resolveSyncDiagnosticsDisposition(
        'routable',
        verdict({ ok: false, status: 413, retryAfterMs: null, refusalCode: null }),
      ),
    ).toBe('discarded');
  });

  it('keeps the row and stops the batch on a 400 that declares NO code -- a version state, not a verdict', () => {
    // CONTRACT CORRECTION, not a weakened assertion: the previous revision asserted that a codeless
    // 400 discarded the row, and THAT is what destroyed a whole episode backlog on first contact
    // with a bridge older than the refusal vocabulary. A shipped 1.14.0 strict-decodes the body
    // into a report that declares no `kind` at all, so it answers the generic
    // `400 {"error":"invalid request body"}` with no `field` and no `code` -- and that build is
    // immutable, so no client-side rule can make it answer differently. Nothing in the response is
    // a judgement about these bytes: it is a statement about the endpoint's version, and a later
    // bridge resolves it. The row is therefore KEPT and the batch STOPS.
    expect(
      resolveSyncDiagnosticsDisposition(
        'routable',
        verdict({ ok: false, status: 400, retryAfterMs: null, refusalCode: null }),
      ),
    ).toBe('stop');
  });

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

  it('keeps the row and stops on a 400 whose refusal declares kind_not_served -- the ONLY recoverable code', () => {
    // The code is written as a LITERAL on purpose. A test that read the same constant the ladder
    // reads would stay green after that constant was changed to any other member -- it would pin
    // nothing. This literal is what makes the constant load-bearing, and it is the contract: this
    // ONE member must survive a status that condemns every other refusal, because the bytes are
    // not wrong -- this build simply does not serve that kind, and a later bridge accepts the same
    // bytes unchanged. Destroying them would lose a backlog nothing else can recover.
    expect(
      resolveSyncDiagnosticsDisposition(
        'routable',
        verdict({ ok: false, status: 400, refusalCode: 'kind_not_served' }),
      ),
    ).toBe('stop');
  });

  it.each([
    { status: 400, refusalCode: 'kind_malformed' },
    { status: 400, refusalCode: 'body_unreadable' },
    { status: 400, refusalCode: 'field_rejected' },
    { status: 413, refusalCode: 'body_too_large' },
  ])(
    'discards on a refusal that declares a NON-recoverable code -- the code names bytes no build accepts (%j)',
    ({ status, refusalCode }) => {
      // NOT one status list per refusal class: the status still owns permanence for every member
      // except the one recoverable one, and each code here is a LITERAL, so a test that only agreed
      // with the constant the ladder reads could not pass. These name a permanent judgement about
      // these exact bytes -- an undecodable body, a discriminator off the closed vocabulary, an
      // off-vocabulary field, an oversize body -- so the row is destroyed.
      expect(
        resolveSyncDiagnosticsDisposition(
          'routable',
          verdict({ ok: false, status, retryAfterMs: null, refusalCode }),
        ),
      ).toBe('discarded');
    },
  );

  it('reads an absent code as no declaration, never as the recoverable one', () => {
    // A missing code must NOT be treated as unclassified (parked) or as kind_not_served (kept):
    // nothing was declared, so the status answers -- and for 401 that answer is retry and destroy
    // nothing, exactly as it answered before the vocabulary existed. A codeless `400` now parks
    // instead, so what the absence of a code means is decided by the STATUS, never by the absence
    // itself: absence never became a recovery.
    expect(
      resolveSyncDiagnosticsDisposition(
        'routable',
        verdict({ ok: false, status: 401, retryAfterMs: null, refusalCode: null }),
      ),
    ).toBe('stop');
  });
});

describe('readSyncDiagnosticsRefusalCode', () => {
  it('reads the code every refusal of this endpoint carries', () => {
    // The exact body the bridge answers an unserved kind with (verified against its handler): the
    // code is the ONE field this build branches on, and it is a top-level member of the body.
    expect(
      readSyncDiagnosticsRefusalCode(
        '{"error":"unknown kind \\"x\\"","code":"kind_not_served","field":"kind"}',
      ),
    ).toBe('kind_not_served');
  });

  it('answers null for a body that declares no code -- a 401 is written by the shared auth layer', () => {
    // `401` does not come from the handler's vocabulary at all, so its body has no code to read.
    // Null here means "no declaration", never "unclassified" and never a recoverable refusal: the
    // status verdict owns the answer.
    expect(readSyncDiagnosticsRefusalCode('{"error":"unauthorized"}')).toBeNull();
  });

  it('answers null for a code that is not a string, instead of coercing one', () => {
    expect(readSyncDiagnosticsRefusalCode('{"code":42}')).toBeNull();
    expect(readSyncDiagnosticsRefusalCode('{"code":null}')).toBeNull();
  });

  it('answers null for unparseable bytes and never throws on them', () => {
    expect(readSyncDiagnosticsRefusalCode('{ not json')).toBeNull();
    expect(readSyncDiagnosticsRefusalCode('')).toBeNull();
  });

  it.each([null, undefined, '[1,2,3]', '"kind_not_served"', 'null'])(
    'answers null for an absent or non-object body (%s)',
    (body) => {
      // A JSON array or a JSON string is not an object, so it declares no readable code even when
      // it contains the recoverable token as its text.
      expect(readSyncDiagnosticsRefusalCode(body)).toBeNull();
    },
  );

  it('answers null for a body that is not a string at all', () => {
    expect(readSyncDiagnosticsRefusalCode({ code: 'kind_not_served' })).toBeNull();
  });

  it('answers null for a BLANK code -- an empty code names nothing, so the refusal parks instead', () => {
    // The premise of "a 400 that declares a code is permanent" is that the code names THESE BYTES
    // refused forever, so a blank field names nothing: read as declared it became a destruction
    // verdict. `null` parks the row, as an absent code does.
    expect(readSyncDiagnosticsRefusalCode('{"code":""}')).toBeNull();
    expect(readSyncDiagnosticsRefusalCode('{"code":"   "}')).toBeNull();
    // NOT widened to unrecognised non-blank codes and NOT trimmed: the declared text is returned
    // untouched, so nothing unnoticed is promoted into the ONE recoverable member.
    expect(readSyncDiagnosticsRefusalCode('{"code":"body_too_large"}')).toBe('body_too_large');
    expect(readSyncDiagnosticsRefusalCode('{"code":" kind_not_served "}')).toBe(' kind_not_served ');
  });
});

/**
 * The age bound's own rule: which kept rows are PARKED (and so bounded by a clock) and which are
 * PENDING (and must never be destroyed by one). Ages are LITERALS, never the declared constant:
 * a fixture reading the same constant as the rule would move with it and pin nothing.
 */
describe('shouldReapSyncDiagnosticsParkedRow', () => {
  const YOUNG_MS = 6 * 24 * 60 * 60 * 1_000;
  const AT_BOUND_MS = 7 * 24 * 60 * 60 * 1_000;
  const STALE_MS = 8 * 24 * 60 * 60 * 1_000;
  /** The ONE `stop` verdict that IS a park: a `400` that declared no code at all. */
  const CODELESS_400 = verdict({ ok: false, status: 400, refusalCode: null });

  /** Runs the rule for one disposition and the verdict its POST produced, at `ageMs`. */
  function at(d: SyncDiagnosticsEnvelopeDisposition, v: SyncDiagnosticsPostVerdict | null, ageMs: number): boolean {
    return shouldReapSyncDiagnosticsParkedRow(d, v, ageMs);
  }

  it('keeps a park until the bound is EXCEEDED, not merely reached, then reaps BOTH park kinds', () => {
    // `>` and not `>=`: an age exactly at the declared one is still inside the wait, so mutating
    // the bound either way fails this case. Both park kinds share that ONE bound: the unknown kind
    // (never posted, so no build here can name it) and the routable row the bridge answered with a
    // codeless `400` (posted, and refused for the bridge's own VERSION rather than for its bytes).
    for (const ageMs of [YOUNG_MS, AT_BOUND_MS]) {
      expect(at('unclassified', null, ageMs)).toBe(false);
      expect(at('stop', CODELESS_400, ageMs)).toBe(false);
    }

    expect(at('unclassified', null, STALE_MS)).toBe(true);
    expect(at('stop', CODELESS_400, STALE_MS)).toBe(true);
  });

  it('never reaps a PENDING stop, however old the row is', () => {
    // PENDING, not parked: the bridge did not answer about these bytes, or answered "come back".
    // Destroying them by age would lose a backlog on nothing worse than a long outage.
    expect(at('stop', null, STALE_MS)).toBe(false);
    expect(at('stop', verdict({ ok: false, status: 400, refusalCode: 'kind_not_served' }), STALE_MS)).toBe(false);
    for (const status of [401, 404, 405, 408, 422, 429, 500, 503]) {
      expect(at('stop', verdict({ ok: false, status, refusalCode: null }), STALE_MS)).toBe(false);
    }
  });

  it('never reaps a row that was not kept as a park, however old it is', () => {
    // A destruction and a delivery remove the row for their own reason, so the clock must not touch
    // them -- or `reaped` would stop separating "we gave up waiting" from "the bridge condemned".
    expect(at('undeliverable', null, STALE_MS)).toBe(false);
    expect(at('delivered', verdict(), STALE_MS)).toBe(false);
    expect(at('failed_removal', verdict(), STALE_MS)).toBe(false);
    expect(at('discarded', verdict({ ok: false, status: 413, refusalCode: null }), STALE_MS)).toBe(false);
    expect(at('discarded', verdict({ ok: false, status: 400, refusalCode: 'field_rejected' }), STALE_MS)).toBe(false);
  });
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

/**
 * The integration half of the rule, pinned HERE because the executor's own suite is at its 500-line
 * ceiling: the ladder above cannot fail if the code is never actually read off the response the
 * client returned, and `rawBody` is the one field that read touches. Each case asserts the single
 * disposition this rule decides -- nothing about the executor is re-tested.
 */
describe('the refusal code through flushSyncDiagnosticsOutbox', () => {
  const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

  /** A pass that performed nothing, plus whichever counters the case moved. */
  function tally(overrides: Partial<SyncDiagnosticsFlushResult> = {}): SyncDiagnosticsFlushResult {
    return {
      attempted: 0,
      delivered: 0,
      discarded: 0,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 0,
      reaped: 0,
      ...overrides,
    };
  }

  /**
   * The instant every pass here runs at: 6 days after each row's `created_at`, i.e. INSIDE the
   * declared reap bound. Explicit because the bound is now a real decision -- without it these rows
   * would be as old as the epoch and every park case below would reap instead of pinning the park.
   */
  const PASS_NOW_MS = 1_000 + 6 * 24 * 60 * 60 * 1_000;

  /** One stored, POSTable body: no `kind` key at all is the frozen legacy cycle envelope. */
  function storedRecord(cycleId: string): SyncDiagnosticsOutboxRecord {
    return {
      cycleId,
      payload: JSON.stringify({ cycle_id: cycleId, recent_events: [] }),
      createdAt: 1_000,
    };
  }

  /** One bridge response double; `rawBody` is the field the rule reads. */
  function response(overrides: Partial<BridgeHttpResult> = {}): BridgeHttpResult {
    return {
      ok: false,
      status: 400,
      data: null,
      rawBody: null,
      url: 'http://192.168.0.10:8080/api/sync/diagnostics',
      retryAfterMs: null,
      ...overrides,
    };
  }

  /** Runs one pass over `records`, answering each POST with the next queued response. */
  async function flush(
    records: readonly SyncDiagnosticsOutboxRecord[],
    responses: readonly BridgeHttpResult[],
  ) {
    const store = {
      readFlushCandidates: jest.fn().mockReturnValue([...records]),
      remove: jest.fn().mockReturnValue('removed'),
      deferUntil: jest.fn(),
    } as unknown as SyncDiagnosticsOutboxStore;
    const postSyncDiagnostics = jest.fn().mockRejectedValue(new Error('unexpected POST'));

    for (const entry of responses) {
      postSyncDiagnostics.mockResolvedValueOnce(entry);
    }

    const result = await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client: { postSyncDiagnostics },
      now: () => PASS_NOW_MS,
    });

    return { store, postSyncDiagnostics, result };
  }

  it('keeps the row, stops the batch and destroys nothing on a 400 that declares kind_not_served', async () => {
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [
        response({
          status: 400,
          rawBody: '{"error":"unknown kind \\"x\\"","code":"kind_not_served","field":"kind"}',
        }),
      ],
    );

    // The row is KEPT (no removal), nothing is deferred, and the batch stops: the next row would be
    // refused identically, and every row kept here is one a later bridge accepts unchanged.
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('still destroys the row and continues on a 400 that declares field_rejected', async () => {
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [
        response({
          status: 400,
          rawBody:
            '{"error":"not a member of the closed vocabulary","code":"field_rejected","field":"degraded"}',
        }),
        response({ ok: true, status: 204 }),
      ],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 2, delivered: 1, discarded: 1 }));
  });

  it('keeps the row and stops the batch on a 400 whose body carries no readable code', async () => {
    // CONTRACT CORRECTION: this case used to assert a DISCARD. Unparseable bytes declare no code,
    // and a codeless `400` is a version state rather than a verdict about the bytes -- exactly the
    // shape an un-upgraded bridge answers. The row is KEPT (no removal), the batch STOPS, nothing is
    // deferred (a `400` declares no wait) and the discard counter stays 0: the outbox is the only
    // copy, so a bridge that cannot speak the vocabulary must never be able to destroy it.
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [response({ status: 400, rawBody: '{ not json' })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it.each(['{ not json', 'null', '"kind_not_served"', null])(
    'parks every unreadable 400 body shape (%s): unreadable bytes never become a verdict',
    async (rawBody) => {
      // The best-effort read answers `null` for all of these -- an ABSENT body, a body that is not
      // JSON, a JSON `null`, and a JSON string that merely CONTAINS the recoverable token as its
      // text. Each one is the state that parks, and the parked row is counted as neither
      // `unclassified` (it WAS posted, and its `kind` was routable) nor `discarded` (nothing was
      // destroyed).
      const { store, result } = await flush(
        [storedRecord('cycle-1'), storedRecord('cycle-2')],
        [response({ status: 400, rawBody })],
      );

      expect(store.remove).not.toHaveBeenCalled();
      expect(result).toEqual(tally({ attempted: 1 }));
    },
  );

  it('keeps the row and stops the batch on a 400 that declares only BLANK whitespace as its code', async () => {
    // CONTRACT CHANGE: this exact body used to DISCARD the row, because `""` reads as a declared
    // code and a 400 that declares a code was read as permanent. An empty code names nothing, so
    // nothing was declared about these bytes and the row parks -- the same fate as a body with no
    // code at all. It still cost a request, so `attempted` moves and nothing else does.
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [response({ status: 400, rawBody: '{"code":"   "}' })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('still destroys the row and continues on a 413 whose body carries no readable code', async () => {
    // The one status that stays permanent WITHOUT a code: a body too large is too large for every
    // build there will ever be, and no release makes these same bytes smaller. So the row goes, and
    // the batch carries on -- unlike the codeless `400` above.
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [response({ status: 413, rawBody: '{ not json' }), response({ ok: true, status: 204 })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 2, delivered: 1, discarded: 1 }));
  });

  it('leaves a 401 with no code exactly as it was -- retry and destroy nothing', async () => {
    // `401` carries no code because the shared authentication layer writes that refusal, not the
    // handler. Nothing was declared, so the status answers: the row stays queued and the batch
    // stops, with no removal and no invented deferral.
    const { store, postSyncDiagnostics, result } = await flush(
      [storedRecord('cycle-1'), storedRecord('cycle-2')],
      [response({ status: 401, rawBody: '{"error":"unauthorized"}' })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });
});
