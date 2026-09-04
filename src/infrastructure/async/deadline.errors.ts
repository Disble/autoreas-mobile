/**
 * Raised when a bounded operation does not settle within its budget. Carries the label and the
 * budget so a caller can attribute the stall to a phase without parsing the message.
 */
export class DeadlineExceededError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Deadline exceeded for ${label} after ${timeoutMs}ms`);
    this.name = 'DeadlineExceededError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}
