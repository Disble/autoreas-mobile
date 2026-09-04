/**
 * A non-2xx reconcile response, carrying the status and the raw body the bridge actually answered.
 * The status is what lets the cycle tell a permanent client fault (4xx, dead-letter the batch) from
 * a retriable one (5xx/transport, requeue it), and the body is usually the only place the bridge
 * says WHICH operation it rejected.
 */
export class ReconcileHttpError extends Error {
  readonly status: number;
  readonly responseBody: string | null;

  constructor(status: number, responseBody: string | null) {
    super(`Reconcile failed: ${status}`);
    this.name = 'ReconcileHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}
