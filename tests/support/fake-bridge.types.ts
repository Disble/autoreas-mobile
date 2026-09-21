/** One request the fake bridge observed, recorded in the order it arrived. */
export interface FakeBridgeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** One response queued to be replayed for the next request the fake bridge receives. */
export interface QueuedBridgeResponse {
  readonly status: number;
  readonly body: unknown;
  /** Headers replayed via a case-insensitive `Response.headers.get` (Decision 8). Optional -- a
   * response queued without any still resolves without throwing. */
  readonly headers?: Record<string, string>;
}

/** Handle returned by `queueDeferredResponse`, letting a test hold one request in flight. */
export interface DeferredBridgeResponse {
  /** Completes the held request with the given queued-shaped response. */
  readonly release: (response: QueuedBridgeResponse) => void;
  /** Fails the held request (transport failure from the request's point of view). */
  readonly reject: (reason: unknown) => void;
}

/** Handle returned by `installFakeBridge`, used to queue, inspect and uninstall. */
export interface FakeBridge {
  readonly requests: readonly FakeBridgeRequest[];
  readonly queueResponse: (response: QueuedBridgeResponse) => void;
  /**
   * Queues a response whose delivery the test controls explicitly: the next request hangs until
   * `release`/`reject` is called. This is how a behaviour test holds a probe or a cycle in
   * flight to prove the one-attempt-at-a-time guard.
   */
  readonly queueDeferredResponse: () => DeferredBridgeResponse;
  readonly restore: () => void;
}
