import { Directory, File, Paths } from 'expo-file-system';
import {
  COVER_MANIFEST_FILE_NAME,
  COVER_MANIFEST_TEMP_FILE_NAME,
  COVERS_DIRECTORY_NAME,
  EMPTY_COVER_MANIFEST,
} from './cover-files.constants';
import { CoverManifestSchema } from './cover-files.schema';
import type { CoverManifest } from './cover-files.types';

/**
 * Keeps only `[A-Za-z0-9-]` unescaped; every other UTF-16 code unit -- a literal underscore
 * included -- becomes a fixed-width `_XXXX` (exactly 4 lowercase hex digits) escape. Because the
 * passthrough set can never itself contain `_`, every `_` in the output unambiguously starts an
 * escape, so no two distinct ids can ever collide on the same sanitized name (unlike a
 * variable-width escape, or one that lets `_` pass through unescaped).
 */
function sanitizeAnimeIdForFileName(animeId: string): string {
  let sanitized = '';

  for (let i = 0; i < animeId.length; i += 1) {
    const char = animeId[i];

    sanitized += /^[A-Za-z0-9-]$/.test(char)
      ? char
      : `_${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  }

  return sanitized;
}

/** Strips the surrounding quotes off a verbatim quoted ETag and takes its first 16 hex chars. */
function extractEtagToken(etag: string | null, fallbackToken: string): string {
  if (!etag) {
    return fallbackToken;
  }

  const stripped = etag.replace(/^"+|"+$/g, '').trim();

  if (stripped.length === 0) {
    return fallbackToken;
  }

  return stripped.slice(0, 16);
}

/**
 * Builds the on-disk file name for one anime's cover JPEG. The name changes whenever the etag
 * changes (or the caller falls back to `fallbackToken`) because `expo-image` caches by URI, so a
 * stale name would keep serving a stale bitmap after a real cover update.
 */
export function buildCoverFileName(
  animeId: string,
  etag: string | null,
  fallbackToken: string,
): string {
  const sanitizedId = sanitizeAnimeIdForFileName(animeId);
  const etagToken = extractEtagToken(etag, fallbackToken);

  return `${sanitizedId}-${etagToken}.jpg`;
}

/**
 * Normalizes a raw `portada` value into the manifest's `sourceKey` shape, mirroring the bridge's
 * own absent rule: an empty or whitespace-only string, or the literal string `"null"`, counts as
 * no cover, exactly like `null`/`undefined`. Anything else is trimmed and kept verbatim, so the
 * same URL trimmed differently across reads never looks like a source change.
 */
export function normalizeCoverSourceKey(portada: string | null | undefined): string | null {
  if (portada === null || portada === undefined) {
    return null;
  }

  const trimmed = portada.trim();

  if (trimmed.length === 0 || trimmed === 'null') {
    return null;
  }

  return trimmed;
}

/** Parses a persisted cover manifest, returning an empty v1 manifest for missing/invalid/wrong-version input. */
export function parseCoverManifest(raw: unknown): CoverManifest {
  const result = CoverManifestSchema.safeParse(raw);

  if (!result.success) {
    return EMPTY_COVER_MANIFEST;
  }

  return result.data;
}

/** Resolves the `covers/` directory under the app's document directory. */
function getCoversDirectory(): Directory {
  return new Directory(Paths.document, COVERS_DIRECTORY_NAME);
}

/** Creates the `covers/` directory if it does not exist yet, then returns it. */
function ensureCoversDirectory(): Directory {
  const directory = getCoversDirectory();

  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }

  return directory;
}

/** Resolves the manifest `File` handle inside the covers directory. */
function getManifestFile(): File {
  return new File(getCoversDirectory(), COVER_MANIFEST_FILE_NAME);
}

/**
 * Reads the persisted cover manifest from disk. A missing file, unreadable file, or invalid JSON
 * all resolve to an empty v1 manifest rather than throwing, so a corrupt manifest never blocks
 * the sweep from starting fresh.
 */
export async function readCoverManifest(): Promise<CoverManifest> {
  try {
    const file = getManifestFile();

    if (!file.exists) {
      return parseCoverManifest(null);
    }

    const raw = await file.text();

    return parseCoverManifest(JSON.parse(raw));
  } catch {
    return parseCoverManifest(null);
  }
}

/**
 * Persists the cover manifest atomically: writes to a temp file first, then moves it over the
 * real manifest file, so a crash mid-write can never leave a half-written manifest on disk.
 */
export async function writeCoverManifest(manifest: CoverManifest): Promise<void> {
  const directory = ensureCoversDirectory();
  const tempFile = new File(directory, COVER_MANIFEST_TEMP_FILE_NAME);

  if (tempFile.exists) {
    tempFile.delete();
  }

  tempFile.create();
  tempFile.write(JSON.stringify(manifest));

  const targetFile = getManifestFile();

  if (targetFile.exists) {
    targetFile.delete();
  }

  tempFile.move(targetFile);
}

/** Writes one cover JPEG's bytes to disk under `fileName`, returning its local `file://` URI. */
export async function writeCoverImage(fileName: string, bytes: Uint8Array): Promise<string> {
  const directory = ensureCoversDirectory();
  const file = new File(directory, fileName);

  if (!file.exists) {
    file.create();
  }

  file.write(bytes);

  return file.uri;
}

/** Reports whether one cover JPEG exists on disk. */
export async function coverFileExists(fileName: string): Promise<boolean> {
  return new File(getCoversDirectory(), fileName).exists;
}

/** Deletes one cover JPEG from disk. A missing file is a silent no-op, never a failure. */
export async function deleteCoverFile(fileName: string): Promise<void> {
  const file = new File(getCoversDirectory(), fileName);

  if (file.exists) {
    file.delete();
  }
}

/** Lists every cover JPEG file name currently on disk, excluding the manifest and its temp file. */
export async function listCoverFileNames(): Promise<readonly string[]> {
  const directory = getCoversDirectory();

  if (!directory.exists) {
    return [];
  }

  return directory.list().reduce<string[]>((names, entry) => {
    if (entry.name.toLowerCase().endsWith('.jpg')) {
      names.push(entry.name);
    }

    return names;
  }, []);
}

/** Resolves the local `file://` URI for one cover JPEG, without touching disk. */
export function getCoverFileUri(fileName: string): string {
  return new File(getCoversDirectory(), fileName).uri;
}
