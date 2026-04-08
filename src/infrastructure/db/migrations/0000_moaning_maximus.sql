CREATE TABLE `animes` (
	`_id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`estado` integer DEFAULT 0 NOT NULL,
	`nrocapvisto` real DEFAULT 0 NOT NULL,
	`totalcap` integer,
	`dias` text,
	`generos` text,
	`tipo` integer,
	`activo` integer DEFAULT 1 NOT NULL,
	`primeravez` integer DEFAULT 1 NOT NULL,
	`fechaUltCapVisto` integer,
	`fechaEstreno` integer,
	`fechaCreacion` integer,
	`fechaEliminacion` integer,
	`portada` text,
	`pagina` text,
	`carpeta` text,
	`estudios` text,
	`origen` text,
	`duracion` integer
);
--> statement-breakpoint
CREATE TABLE `bridge_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`ip` text,
	`port` integer,
	`token` text,
	`device_id` text,
	`device_name` text
);
--> statement-breakpoint
CREATE TABLE `operation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
