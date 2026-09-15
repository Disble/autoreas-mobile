/**
 * Exercises the expo-file-system-backed I/O functions against an in-memory fake of the
 * `File`/`Directory`/`Paths` surface. `jest-expo` does not mock `expo-file-system` (confirmed:
 * no mock under `node_modules/jest-expo` and none registered in `jest.setup.ts`), so this file
 * mocks it inline rather than relying on any shared/global double.
 *
 * Everything the factory below touches is declared INSIDE the factory: `jest.mock` factories are
 * hoisted above this file's imports, so a module-scope variable referenced from inside one would
 * be read before its own initializer runs. The store and directory set are exposed back out as
 * `__mockStore` / `__mockCreatedDirectories` so the tests below can seed and reset them.
 */
jest.mock('expo-file-system', () => {
  const store = new Map<string, { content: string | Uint8Array }>();
  const createdDirectories = new Set<string>();

  function joinUri(parent: { uri: string }, segment: string): string {
    return `${parent.uri}/${segment}`;
  }

  class MockFile {
    uri: string;

    constructor(parent: { uri: string }, segment: string) {
      this.uri = joinUri(parent, segment);
    }

    get exists(): boolean {
      return store.has(this.uri);
    }

    get name(): string {
      return this.uri.split('/').pop() as string;
    }

    create(): void {
      if (!store.has(this.uri)) {
        store.set(this.uri, { content: '' });
      }
    }

    write(content: string | Uint8Array): void {
      store.set(this.uri, { content });
    }

    async text(): Promise<string> {
      const entry = store.get(this.uri);
      if (!entry) {
        throw new Error(`MockFile: ${this.uri} does not exist`);
      }
      return typeof entry.content === 'string'
        ? entry.content
        : Buffer.from(entry.content).toString('utf8');
    }

    delete(): void {
      store.delete(this.uri);
    }

    move(destination: MockFile): void {
      const entry = store.get(this.uri);
      if (entry) {
        store.delete(this.uri);
        store.set(destination.uri, entry);
      }
      this.uri = destination.uri;
    }
  }

  class MockDirectory {
    uri: string;

    constructor(parent: { uri: string }, segment?: string) {
      this.uri = segment === undefined ? parent.uri : joinUri(parent, segment);
    }

    get exists(): boolean {
      return createdDirectories.has(this.uri);
    }

    create(): void {
      createdDirectories.add(this.uri);
    }

    list(): MockFile[] {
      const prefix = `${this.uri}/`;
      return Array.from(store.keys())
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => new MockFile({ uri: this.uri }, uri.slice(prefix.length)));
    }
  }

  const documentDirectory = { uri: 'file:///document' };

  return {
    __esModule: true,
    Paths: { document: documentDirectory },
    Directory: MockDirectory,
    File: MockFile,
    __mockStore: store,
    __mockCreatedDirectories: createdDirectories,
  };
});

// eslint-disable-next-line import/first -- the mock above must be registered before these imports resolve.
import * as ExpoFileSystemMock from 'expo-file-system';
// eslint-disable-next-line import/first
import {
  coverFileExists,
  deleteCoverFile,
  getCoverFileUri,
  listCoverFileNames,
  readCoverManifest,
  writeCoverImage,
  writeCoverManifest,
} from '../../../../src/infrastructure/cover-files/cover-files.helpers';

/** Typed view of the mock module's extra exports (the in-memory store and directory set). */
const mockModule = ExpoFileSystemMock as unknown as {
  __mockStore: Map<string, { content: string | Uint8Array }>;
  __mockCreatedDirectories: Set<string>;
};
/** The mocked `expo-file-system`'s in-memory file store, shared across every test in this file. */
const store = mockModule.__mockStore;
/** The mocked `expo-file-system`'s in-memory set of created directories. */
const createdDirectories = mockModule.__mockCreatedDirectories;

describe('cover-files I/O', () => {
  beforeEach(() => {
    store.clear();
    createdDirectories.clear();
  });

  describe('readCoverManifest', () => {
    it('returns an empty manifest when the manifest file does not exist', async () => {
      expect(await readCoverManifest()).toEqual({ version: 1, entries: {} });
    });

    it('reads and parses a previously written manifest', async () => {
      store.set('file:///document/covers/manifest.json', {
        content: JSON.stringify({
          version: 1,
          entries: {
            a1: {
              status: 'image',
              fileName: 'a1-x.jpg',
              etag: '"x"',
              checkedAt: 1,
              nextAttemptAt: 2,
              failureCount: 0,
            },
          },
        }),
      });

      const manifest = await readCoverManifest();

      expect(manifest.entries.a1?.fileName).toBe('a1-x.jpg');
    });

    it('returns an empty manifest for corrupt JSON without throwing', async () => {
      store.set('file:///document/covers/manifest.json', { content: '{not json' });

      await expect(readCoverManifest()).resolves.toEqual({ version: 1, entries: {} });
    });
  });

  describe('writeCoverManifest', () => {
    it('writes via a temp file and moves it over the real manifest, leaving no temp file behind', async () => {
      await writeCoverManifest({ version: 1, entries: {} });

      expect(store.has('file:///document/covers/manifest.json')).toBe(true);
      expect(store.has('file:///document/covers/manifest.json.tmp')).toBe(false);
    });

    it('creates the covers directory if it does not exist yet', async () => {
      expect(createdDirectories.has('file:///document/covers')).toBe(false);

      await writeCoverManifest({ version: 1, entries: {} });

      expect(createdDirectories.has('file:///document/covers')).toBe(true);
    });

    it('overwrites a previously written manifest', async () => {
      await writeCoverManifest({
        version: 1,
        entries: {
          a1: {
            status: 'absent',
            fileName: null,
            etag: null,
            checkedAt: 1,
            nextAttemptAt: 2,
            failureCount: 0,
          },
        },
      });
      await writeCoverManifest({ version: 1, entries: {} });

      expect(await readCoverManifest()).toEqual({ version: 1, entries: {} });
    });
  });

  describe('writeCoverImage / coverFileExists / deleteCoverFile / listCoverFileNames / getCoverFileUri', () => {
    it('writes bytes and returns a file:// URI', async () => {
      const uri = await writeCoverImage('anime-1-abc.jpg', new Uint8Array([1, 2, 3]));

      expect(uri).toBe('file:///document/covers/anime-1-abc.jpg');
      expect(await coverFileExists('anime-1-abc.jpg')).toBe(true);
    });

    it('reports a missing file as not existing', async () => {
      expect(await coverFileExists('does-not-exist.jpg')).toBe(false);
    });

    it('deletes an existing file', async () => {
      await writeCoverImage('anime-1-abc.jpg', new Uint8Array([1]));

      await deleteCoverFile('anime-1-abc.jpg');

      expect(await coverFileExists('anime-1-abc.jpg')).toBe(false);
    });

    it('ignores deleting a file that does not exist', async () => {
      await expect(deleteCoverFile('does-not-exist.jpg')).resolves.toBeUndefined();
    });

    it('lists only JPEG files, never the manifest', async () => {
      await writeCoverImage('anime-1-abc.jpg', new Uint8Array([1]));
      await writeCoverImage('anime-2-def.jpg', new Uint8Array([2]));
      await writeCoverManifest({ version: 1, entries: {} });

      const names = await listCoverFileNames();

      expect(names.slice().sort()).toEqual(['anime-1-abc.jpg', 'anime-2-def.jpg']);
    });

    it('resolves a file URI without touching disk', () => {
      expect(getCoverFileUri('anime-1-abc.jpg')).toBe('file:///document/covers/anime-1-abc.jpg');
    });
  });
});
