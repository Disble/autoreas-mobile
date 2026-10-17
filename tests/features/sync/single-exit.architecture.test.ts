import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The repository root, resolved from this file's location under `tests/features/sync`. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..');

/** Where the native engine's Kotlin sources live. */
const KOTLIN_SOURCE_ROOT = join(REPOSITORY_ROOT, 'modules', 'sync-engine', 'android', 'src', 'main', 'java');

/** Lists every file under `directory` whose name ends with one of `extensions`. */
function listSourceFiles(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listSourceFiles(path, extensions);
    }

    return extensions.some((extension) => entry.endsWith(extension)) ? [path] : [];
  });
}

/** Drops block and line comments, so prose that names a function is never read as a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Lists, as repository-relative posix paths, the files whose code matches `pattern`. */
function filesMatching(files: readonly string[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(REPOSITORY_ROOT, file).split(sep).join('/'))
    .sort();
}

/** A call of `name` that is not its own declaration. */
function callOf(name: string): RegExp {
  return new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`);
}

/** Every TypeScript source of the app. */
const typeScriptSources = listSourceFiles(join(REPOSITORY_ROOT, 'src'), ['.ts', '.tsx']);
/** Every Kotlin source of the native engine. */
const kotlinSources = listSourceFiles(KOTLIN_SOURCE_ROOT, ['.kt']);

describe('one registry, one exit per runtime (ADR 009 R-2)', () => {
  it('lets only the dispatcher cycle run the anime-operation and season-rating drains', () => {
    expect(filesMatching(typeScriptSources, callOf('syncPendingOperations'))).toEqual([
      'src/features/sync/sync-facade.helpers.ts',
    ]);
    expect(filesMatching(typeScriptSources, callOf('drainSeasonRatingQueue'))).toEqual([
      'src/features/sync/sync-facade.helpers.ts',
    ]);
  });

  it('lets diagnostics leave only inside the dispatched anime-operation pass', () => {
    expect(filesMatching(typeScriptSources, callOf('flushSyncDiagnosticsOutbox'))).toEqual([
      'src/features/sync/reconcile.helpers.ts',
    ]);
  });

  it('starts the coordinated cycle only from the registered dispatcher', () => {
    expect(filesMatching(typeScriptSources, callOf('runCoordinatedForegroundSyncCycle'))).toEqual([
      'src/features/sync/sync-facade.helpers.ts',
    ]);
  });

  it('calls each BridgeClient send method from its one registered sender', () => {
    expect(filesMatching(typeScriptSources, /\.reconcile\s*\(/)).toEqual([
      'src/features/sync/reconcile-round.helpers.ts',
    ]);
    expect(filesMatching(typeScriptSources, /\.postActiveSeasonRating\s*\(/)).toEqual([
      'src/features/sync/season-rating-queue.helpers.ts',
    ]);
    expect(filesMatching(typeScriptSources, /\.postSyncDiagnostics\s*\(/)).toEqual([
      'src/features/sync/sync-diagnostics-flush.helpers.ts',
    ]);
  });

  it('opens every native bridge connection through SyncEngineHttp', () => {
    expect(filesMatching(kotlinSources, /\.openConnection\s*\(/)).toEqual([
      'modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncEngineHttp.kt',
    ]);
  });
});
