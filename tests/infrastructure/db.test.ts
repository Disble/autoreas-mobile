import { countAnimes, insertDummyAnime, withExclusiveWrite } from '../../src/infrastructure/db/client';

jest.mock('drizzle-orm', () => ({
  desc: jest.fn((value) => value),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn((client: { __state?: { animes: Array<Record<string, unknown>> } }) => ({
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        client.__state?.animes.push(value);
      },
    }),
    select: () => ({
      from: () => client.__state?.animes ?? [],
    }),
  })),
}));

jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: jest.fn(),
}));

jest.mock('../../src/infrastructure/db/migrations/migrations', () => ({
  __esModule: true,
  default: {
    journal: { entries: [] },
    migrations: {},
  },
}));

describe('db client tracer helpers', () => {
  it('inserta un dummy anime dentro de una transacción exclusiva y actualiza el count', async () => {
    const state = { animes: [] as Array<Record<string, unknown>> };
    const rawDb = {
      __state: state,
      withExclusiveTransactionAsync: jest.fn(async (task: (tx: unknown) => Promise<void>) => {
        await task(rawDb);
      }),
    };

    const inserted = await insertDummyAnime(rawDb as never);
    const count = await countAnimes(rawDb as never);

    expect(rawDb.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(inserted._id).toContain('dummy-');
    expect(inserted.nombre).toBe('Anime de prueba');
    expect(count).toBe(1);
  });

  it('devuelve el resultado del callback exclusivo', async () => {
    const rawDb = {
      __state: { animes: [] as Array<Record<string, unknown>> },
      withExclusiveTransactionAsync: jest.fn(async (task: (tx: unknown) => Promise<void>) => {
        await task(rawDb);
      }),
    };

    const result = await withExclusiveWrite(rawDb as never, async () => 'ok');

    expect(result).toBe('ok');
    expect(rawDb.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
  });
});
