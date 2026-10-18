/** Identifies a reachable bridge response that cannot produce trustworthy active-season truth. */
export class ActiveSeasonSyncError extends Error {
  readonly status: number;
  readonly responseBody: string | null;

  constructor(message: string, status: number, responseBody: string | null) {
    super(message);
    this.name = 'ActiveSeasonSyncError';
    this.status = status;
    this.responseBody = responseBody;
  }
}
