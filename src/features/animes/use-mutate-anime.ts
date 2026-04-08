import { eq } from 'drizzle-orm';
import { useSQLiteContext } from 'expo-sqlite';
import { createDrizzleDb, withExclusiveWrite } from '../../infrastructure/db/client';
import { animes, operationLog } from '../../infrastructure/db/schema';
import { AnimePatchSchema, AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema';

export function useMutateAnime() {
  const rawDb = useSQLiteContext();
  const db = createDrizzleDb(rawDb);

  void db;

  const capPlus = async (input: Anime): Promise<void> => {
    const anime = AnimeSchema.parse(input);
    const now = Date.now();
    const newCap = anime.nrocapvisto + 1;
    
    const isFirstTime = anime.primeravez === 1;
    const isFinished = anime.totalcap != null && anime.totalcap > 0 && newCap === anime.totalcap;

    const patch = {
      nrocapvisto: newCap,
      ...(isFinished ? { estado: 1 } : {}),
    };
    const bridgePatch = AnimePatchSchema.parse(patch);

    await withExclusiveWrite(rawDb, async (txDb) => {
      await txDb
        .update(animes)
        .set({
          nrocapvisto: bridgePatch.nrocapvisto,
          fechaUltCapVisto: now,
          ...(isFirstTime ? { fechaEstreno: now, primeravez: 0 } : {}),
          ...(isFinished ? { estado: 1 } : {}),
        })
        .where(eq(animes._id, anime._id));

      await txDb.insert(operationLog).values({
        animeId: anime._id,
        operation: 'cap_plus',
        payload: JSON.stringify({ nrocapvisto: bridgePatch.nrocapvisto }),
        status: 'pending',
        createdAt: now,
      });

      if (isFinished) {
        await txDb.insert(operationLog).values({
          animeId: anime._id,
          operation: 'estado_change',
          payload: JSON.stringify({ estado: 1 }),
          status: 'pending',
          createdAt: now,
        });
      }
    });
  };

  const capMinus = async (input: Anime): Promise<void> => {
    const anime = AnimeSchema.parse(input);
    const now = Date.now();
    const patch = AnimePatchSchema.parse({
      nrocapvisto: Math.max(0, anime.nrocapvisto - 1),
    });

    await withExclusiveWrite(rawDb, async (txDb) => {
      await txDb
        .update(animes)
        .set({
          nrocapvisto: patch.nrocapvisto,
          fechaUltCapVisto: now,
        })
        .where(eq(animes._id, anime._id));

      await txDb.insert(operationLog).values({
        animeId: anime._id,
        operation: 'cap_minus',
        payload: JSON.stringify(patch),
        status: 'pending',
        createdAt: now,
      });
    });
  };

  return { capPlus, capMinus };
}
