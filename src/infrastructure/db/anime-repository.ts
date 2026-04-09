import type { Anime } from "../validation/anime-schema";
import type { AppDatabase } from "./client";
import { animes } from "./schema";

export async function upsertAnime(
  db: AppDatabase,
  anime: Anime,
): Promise<void> {
  const mappedFields = {
    nombre: anime.nombre,
    estado: anime.estado,
    nrocapvisto: anime.nrocapvisto,
    totalcap: anime.totalcap ?? null,
    activo: anime.activo,
    primeravez: anime.primeravez,
    dias: anime.dias ? JSON.stringify(anime.dias) : null,
    generos: anime.generos ? JSON.stringify(anime.generos) : null,
    tipo: anime.tipo ?? null,
    fechaUltCapVisto: anime.fechaUltCapVisto ?? null,
    fechaEstreno: anime.fechaEstreno ?? null,
    fechaCreacion: anime.fechaCreacion ?? null,
    fechaEliminacion: anime.fechaEliminacion ?? null,
    portada: anime.portada ?? null,
    pagina: anime.pagina ?? null,
    carpeta: anime.carpeta ?? null,
    estudios: anime.estudios ?? null,
    origen: anime.origen ?? null,
    duracion: anime.duracion ?? null,
  };

  await db
    .insert(animes)
    .values({
      _id: anime._id,
      ...mappedFields,
    })
    .onConflictDoUpdate({
      target: animes._id,
      set: mappedFields,
    });
}
