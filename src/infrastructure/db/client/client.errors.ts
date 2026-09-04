import type {
  LocalWriteFailureDiagnostics,
  LocalWriteFailureStage,
} from './client.types';

/** A local SQLite write failure carrying observable diagnostics alongside the original message. */
export class LocalWriteError extends Error implements LocalWriteFailureDiagnostics {
  readonly errcode: number | null;
  readonly elapsedMs: number;
  readonly stage: LocalWriteFailureStage;

  constructor(message: string, diagnostics: LocalWriteFailureDiagnostics) {
    super(message);
    this.name = 'LocalWriteError';
    this.errcode = diagnostics.errcode;
    this.elapsedMs = diagnostics.elapsedMs;
    this.stage = diagnostics.stage;
  }
}
