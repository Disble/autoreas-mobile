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
}

/** Handle returned by `installFakeBridge`, used to queue, inspect and uninstall. */
export interface FakeBridge {
  readonly requests: readonly FakeBridgeRequest[];
  readonly queueResponse: (response: QueuedBridgeResponse) => void;
  readonly restore: () => void;
}
