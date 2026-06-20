import { eq } from "drizzle-orm";
import type { SQLiteDatabase } from "expo-sqlite";
import { upsertAnime } from "../../infrastructure/db/anime-repository";
import {
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from "../../infrastructure/db/client";
import { animes } from "../../infrastructure/db/schema";
import { AnimeSchema, type Anime } from "../../infrastructure/validation/anime-schema";
import {
  fetchInitialSyncSnapshot,
  persistInitialSyncSnapshot,
} from './initial-sync.helpers';

export async function initialSync(rawDb: SQLiteDatabase): Promise<number> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error("Bridge config is missing or incomplete");
  }

  const remoteAnimes = await fetchInitialSyncSnapshot({
    ip: config.ip,
    port: config.port,
    token: config.token,
  });

  return persistInitialSyncSnapshot(rawDb, remoteAnimes);
}

export async function fetchAnimeById(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<Anime | null> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) return null;

  const url = `http://${config.ip}:${config.port}/api/animes/${animeId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) return null;

  const raw = await response.json();
  const parsed = AnimeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function upsertAnimeFromBridge(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<void> {
  const anime = await fetchAnimeById(rawDb, animeId);
  if (!anime) return;

  await withExclusiveWrite(rawDb, async (txDb) => {
    await upsertAnime(txDb, anime);
  });
}

export async function deleteAnimeLocally(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<void> {
  await withExclusiveWrite(rawDb, async (db) => {
    await db.delete(animes).where(eq(animes._id, animeId));
  });
}


