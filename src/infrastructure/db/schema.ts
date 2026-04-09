import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const animes = sqliteTable("animes", {
  _id: text("_id").primaryKey(),
  nombre: text("nombre").notNull(),
  estado: integer("estado").notNull().default(0),
  nrocapvisto: real("nrocapvisto").notNull().default(0),
  totalcap: integer("totalcap"),
  dias: text("dias"),
  generos: text("generos"),
  tipo: integer("tipo"),
  activo: integer("activo").notNull().default(1),
  primeravez: integer("primeravez").notNull().default(1),
  fechaUltCapVisto: integer("fechaUltCapVisto"),
  fechaEstreno: integer("fechaEstreno"),
  fechaCreacion: integer("fechaCreacion"),
  fechaEliminacion: integer("fechaEliminacion"),
  portada: text("portada"),
  pagina: text("pagina"),
  carpeta: text("carpeta"),
  estudios: text("estudios"),
  origen: text("origen"),
  duracion: integer("duracion"),
});

export const operationLog = sqliteTable("operation_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  animeId: text("anime_id").notNull(),
  operation: text("operation").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const bridgeConfig = sqliteTable("bridge_config", {
  id: integer("id").primaryKey().default(1),
  ip: text("ip"),
  port: integer("port"),
  token: text("token"),
  deviceId: text("device_id"),
  deviceName: text("device_name"),
});

export type AnimeRow = typeof animes.$inferSelect;
export type InsertAnimeRow = typeof animes.$inferInsert;
export type OperationLogRow = typeof operationLog.$inferSelect;
export type InsertOperationLogRow = typeof operationLog.$inferInsert;
export type BridgeConfig = typeof bridgeConfig.$inferSelect;
export type NewBridgeConfig = typeof bridgeConfig.$inferInsert;
