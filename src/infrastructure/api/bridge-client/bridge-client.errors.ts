/**
 * Raised when the bridge cannot be reached at all (DNS/connection/timeout), as opposed to an
 * HTTP error response. Callers use this to treat the failure as transient (retry) rather than
 * a permanent contract rejection.
 */
export class BridgeUnreachableError extends Error {
  readonly url: string;
  readonly reason: unknown;

  constructor(url: string, reason: unknown) {
    super(`Bridge unreachable at ${url}`);
    this.name = 'BridgeUnreachableError';
    this.url = url;
    this.reason = reason;
  }
}

/**
 * Raised when a bridge request is aborted because it exceeded its budget (R8). It deliberately
 * SUBCLASSES `BridgeUnreachableError`: the two sites that branch on that type -- season-rating
 * delivery classification and the sync connection store -- must keep treating a timeout as
 * transient, and a sibling class would silently reclassify every timeout as a permanent failure.
 * The distinct identity is what lets a caller attribute the stall to transport rather than guess.
 */
export class BridgeTimeoutError extends BridgeUnreachableError {
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(url, new Error(`Bridge request exceeded ${timeoutMs}ms`));
    this.name = 'BridgeTimeoutError';
    this.message = `Bridge request to ${url} exceeded ${timeoutMs}ms`;
    this.timeoutMs = timeoutMs;
  }
}
