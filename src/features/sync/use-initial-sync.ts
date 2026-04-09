import { eq } from "drizzle-orm";
import type { SQLiteDatabase } from "expo-sqlite";
import { z } from "zod";
import { upsertAnime } from "../../infrastructure/db/anime-repository";
import {
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from "../../infrastructure/db/client";
import { animes } from "../../infrastructure/db/schema";
import { AnimeSchema } from "../../infrastructure/validation/anime-schema";

const AnimeListSchema = z.array(AnimeSchema);

export async function initialSync(rawDb: SQLiteDatabase): Promise<number> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error("Bridge config is missing or incomplete");
  }

  const url = `http://${config.ip}:${config.port}/api/animes`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/animes failed: ${response.status}`);
  }

  const raw = await response.json();
  const parsed = AnimeListSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`Invalid anime list from bridge: ${parsed.error.message}`);
  }

  const remoteAnimes = parsed.data;
  if (remoteAnimes.length === 0) return 0;

  await withExclusiveWrite(rawDb, async (db) => {
    for (const anime of remoteAnimes) {
      await upsertAnime(db, anime);
    }
  });

  return remoteAnimes.length;
}

export async function fetchAnimeById(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<z.infer<typeof AnimeSchema> | null> {
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

/**
 * Sync incremental: trae solo los cambios del bridge desde un timestamp dado.
 * Se usa al reconectar el WS (evento sync_required) para no re-descargar todo.
 * Retorna el last_changelog_id recibido para persistirlo si se desea.
 */
export async function incrementalSync(
  rawDb: SQLiteDatabase,
  sinceMs: number = 0,
): Promise<number> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) return 0;

  try {
    const url = `http://${config.ip}:${config.port}/api/animes/changes?since=${sinceMs}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      console.warn(
        `[IncrementalSync] GET /api/animes/changes failed: ${response.status}`,
      );
      return 0;
    }

    const raw = await response.json();

    // Shape: { changes: AnimeChange[], last_changelog_id: number }
    const changes: {
      record_id: string;
      change_type: "create" | "update" | "delete";
      snapshot?: z.infer<typeof AnimeSchema>;
    }[] = raw?.changes ?? [];

    const lastChangelogId: number = raw?.last_changelog_id ?? 0;

    if (changes.length === 0) return lastChangelogId;

    await withExclusiveWrite(rawDb, async (db) => {
      for (const change of changes) {
        if (change.change_type === "delete") {
          await db.delete(animes).where(eq(animes._id, change.record_id));
        } else if (change.snapshot) {
          await upsertAnime(db, change.snapshot);
        }
      }
    });

    return lastChangelogId;
  } catch (err) {
    console.warn("[IncrementalSync] Network error:", err);
    return 0;
  }
}
