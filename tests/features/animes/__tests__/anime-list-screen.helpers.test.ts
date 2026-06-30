import {
  buildRefreshFailureFeedback,
  buildContextualHeader,
  buildHeaderLeftRenderer,
  deriveManualSyncEnabled,
  deriveVisibleSyncStatus,
  buildHeaderRightRenderer,
  computeFilterCounts,
  formatTodayLabel,
} from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.helpers";
import { AnimeListScreenHeaderLeft } from "../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderLeft";
import { AnimeListScreenHeaderRight } from "../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenHeaderRight";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

function buildAnime(
  id: string,
  dias: Anime["dias"],
  overrides: Partial<Anime> = {},
): Anime {
  return {
    _id: id,
    nombre: id,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias,
    generos: [],
    tipo: null,
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: null,
    fechaEstreno: null,
    fechaCreacion: null,
    fechaEliminacion: null,
    portada: null,
    pagina: null,
    carpeta: null,
    estudios: null,
    origen: null,
    duracion: null,
    ...overrides,
  };
}

describe("anime-list-screen helpers", () => {
  describe("computeFilterCounts", () => {
    it("counts only animes outside Viendo across matching filters", () => {
      const animes: Anime[] = [
        buildAnime("a", [
          { dia: "Lunes", orden: 0 },
          { dia: "Jueves", orden: 0 },
        ]),
        buildAnime("b", [{ dia: "Jueves", orden: 1 }], { estado: 1 }),
        buildAnime("c", [{ dia: "Visto", orden: 0 }], { estado: 3 }),
      ];

      const counts = computeFilterCounts(animes);

      expect(counts.Lunes).toBe(0);
      expect(counts.Jueves).toBe(1);
      expect(counts.Visto).toBe(1);
      expect(counts.Martes).toBe(0);
    });

    it("ignores animes still in estado Viendo for badge counts", () => {
      const animes: Anime[] = [
        buildAnime("watching", [{ dia: "Lunes", orden: 0 }]),
        buildAnime(
          "completed",
          [
            { dia: "Lunes", orden: 1 },
            { dia: "Visto", orden: 0 },
          ],
          { estado: 1 },
        ),
        buildAnime("paused", [{ dia: "Lunes", orden: 2 }], { estado: 3 }),
      ];

      const counts = computeFilterCounts(animes);

      expect(counts.Lunes).toBe(2);
      expect(counts.Visto).toBe(1);
    });

    it("returns zero counts when there are no animes", () => {
      const counts = computeFilterCounts([]);

      expect(counts.Lunes).toBe(0);
      expect(counts.Visto).toBe(0);
      expect(counts["Sin ver"]).toBe(0);
    });
  });

  describe("buildContextualHeader", () => {
    it("returns a weekday-specific title for a weekday filter", () => {
      // Use a Monday to verify the title with a filter that is NOT today.
      const header = buildContextualHeader(
        "Lunes",
        3,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.title).toBe("Lunes");
      expect(header.subtitle).toBe("3 animes para ver");
    });

    it('marks the current weekday as "hoy"', () => {
      const header = buildContextualHeader(
        "Jueves",
        3,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.isToday).toBe(true);
    });

    it("uses singular copy when there is exactly one anime on a non-today filter", () => {
      const header = buildContextualHeader(
        "Viernes",
        1,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("1 anime para ver");
    });

    it("uses a specific empty-state subtitle when a non-today weekday has zero animes", () => {
      // 2026-04-09 is a Thursday. Saturday is not today, so the copy should name the weekday.
      const header = buildContextualHeader(
        "Sábado",
        0,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("Sin pendientes para Sábado");
    });

    it("celebrates zero animes when the weekday is today", () => {
      // 2026-04-09 is a Thursday → Jueves is today, count=0 should feel like a win.
      const header = buildContextualHeader(
        "Jueves",
        0,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("Al día. Nada pendiente para hoy.");
    });

    it("appends the formatted current date to the subtitle when the weekday filter matches today", () => {
      // 2026-04-09 is Thursday, April 9.
      const header = buildContextualHeader(
        "Jueves",
        3,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("3 animes · Jue 9 abr");
      expect(header.isToday).toBe(true);
    });

    it("uses pseudo-day copy for Ver hoy", () => {
      const header = buildContextualHeader(
        "Ver hoy",
        2,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.title).toBe("Para ver hoy");
      expect(header.subtitle).toBe("2 animes · Jue 9 abr");
    });

    it("celebrates zero animes for Ver hoy", () => {
      const header = buildContextualHeader(
        "Ver hoy",
        0,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("Al día. Nada pendiente para hoy.");
    });

    it("uses pseudo-day copy for Visto", () => {
      const header = buildContextualHeader(
        "Visto",
        5,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.title).toBe("Vistos");
      expect(header.subtitle).toBe("5 animes para ver");
    });

    it("uses a purposeful empty-state subtitle for Visto", () => {
      const header = buildContextualHeader(
        "Visto",
        0,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("Todavía no archivaste ningún anime.");
    });

    it("uses pseudo-day copy for Sin ver", () => {
      const header = buildContextualHeader(
        "Sin ver",
        4,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.title).toBe("Sin ver");
      expect(header.subtitle).toBe("4 animes para ver");
    });

    it("uses a purposeful empty-state subtitle for Sin ver", () => {
      const header = buildContextualHeader(
        "Sin ver",
        0,
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(header.subtitle).toBe("Todo empezado. Bien ahí.");
    });
  });

  describe("deriveVisibleSyncStatus", () => {
    it("returns a neutral local-only state when the bridge is unavailable without backlog", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "offline",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 0,
          syncError: null,
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.tone).toBe("default");
      expect(status.chipLabel).toBe("Catálogo local");
      expect(status.title).toBe("Catálogo local listo");
      expect(status.actionLabel).toBeNull();
    });

    it("returns a more precise healthy state when the bridge is up to date", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "online",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: new Date("2026-04-09T09:58:00.000Z").getTime(),
          pendingOpsCount: 0,
          syncError: null,
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.tone).toBe("success");
      expect(status.chipLabel).toBe("Bridge activo");
      expect(status.title).toBe("Catálogo al día");
      expect(status.description).toContain("Última sincronización");
      expect(status.actionLabel).toBeNull();
    });

    it("surfaces pending local changes while staying in local mode", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "error",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: new Date("2026-04-08T10:00:00.000Z").getTime(),
          pendingOpsCount: 3,
          syncError: "bridge unavailable",
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.tone).toBe("warning");
      expect(status.chipLabel).toBe("Sync pendiente");
      expect(status.title).toBe("3 cambios esperando sync");
      expect(status.actionLabel).toBe("Revisar bridge");
    });

    it("elevates stale backlog after multiple days without sync", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "error",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: new Date("2026-04-03T10:00:00.000Z").getTime(),
          pendingOpsCount: 2,
          syncError: "bridge unavailable",
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.tone).toBe("danger");
      expect(status.title).toBe("2 cambios esperando sync");
      expect(status.description).toContain("Hace 6 días");
      expect(status.actionLabel).toBe("Revisar bridge");
    });

    it("hides the bridge CTA when the phone itself is offline", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "error",
          isBridgeConfigured: true,
          isDeviceOnline: false,
          lastSyncAt: new Date("2026-04-08T10:00:00.000Z").getTime(),
          pendingOpsCount: 2,
          syncError: "bridge unavailable",
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.chipLabel).toBe("Sin conexión");
      expect(status.actionLabel).toBeNull();
    });

    it("switches the CTA to pairing when there is backlog without a configured bridge", () => {
      const status = deriveVisibleSyncStatus(
        {
          connectionStatus: "offline",
          isBridgeConfigured: false,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 2,
          syncError: null,
        },
        new Date("2026-04-09T10:00:00.000Z"),
      );

      expect(status.chipLabel).toBe("Sync pendiente");
      expect(status.actionLabel).toBe("Emparejar bridge");
    });
  });

  describe("buildRefreshFailureFeedback", () => {
    it("returns phone-offline copy when the device has no internet", () => {
      const feedback = buildRefreshFailureFeedback({
        connectionStatus: "error",
        isBridgeConfigured: true,
        isDeviceOnline: false,
        lastSyncAt: null,
        pendingOpsCount: 1,
        syncError: "bridge unavailable",
      });

      expect(feedback.label).toBe("Este teléfono está sin internet.");
      expect(feedback.description).toContain("sync se va a reintentar");
    });

    it("returns bridge-specific copy when the phone is online", () => {
      const feedback = buildRefreshFailureFeedback({
        connectionStatus: "error",
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: null,
        pendingOpsCount: 1,
        syncError: "bridge unavailable",
      });

      expect(feedback.label).toBe("No se pudo sincronizar con el bridge.");
      expect(feedback.description).toBe(
        "Tus cambios siguen guardados en este dispositivo.",
      );
    });
  });

  describe("deriveManualSyncEnabled", () => {
    it("returns false while the screen is already refreshing", () => {
      expect(
        deriveManualSyncEnabled({
          connectionStatus: "error",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          isRefreshing: true,
          lastSyncAt: null,
          pendingOpsCount: 1,
          syncError: "bridge unavailable",
        }),
      ).toBe(false);
    });

    it("returns true when manual sync can still start now", () => {
      expect(
        deriveManualSyncEnabled({
          connectionStatus: "error",
          isBridgeConfigured: true,
          isDeviceOnline: true,
          isRefreshing: false,
          lastSyncAt: null,
          pendingOpsCount: 1,
          syncError: "bridge unavailable",
        }),
      ).toBe(true);
    });
  });

  describe("formatTodayLabel", () => {
    it("formats a weekday with short Spanish names", () => {
      expect(formatTodayLabel(new Date("2026-04-09T10:00:00.000Z"))).toBe(
        "Jue 9 abr",
      );
    });

    it("handles Sunday as the first weekday index", () => {
      expect(formatTodayLabel(new Date("2026-04-12T10:00:00.000Z"))).toBe(
        "Dom 12 abr",
      );
    });

    it("uses two-digit day numbers without leading zero", () => {
      expect(formatTodayLabel(new Date("2026-01-03T10:00:00.000Z"))).toBe(
        "Sáb 3 ene",
      );
    });
  });

  describe("header renderers", () => {
    it("buildHeaderLeftRenderer returns a renderer for the settings header action", () => {
      const handleOpenSettings = jest.fn();
      const renderer = buildHeaderLeftRenderer({
        handleOpenSettings,
        themeColorForeground: "#fff",
      });

      const element = renderer();

      expect(element.type).toBe(AnimeListScreenHeaderLeft);
      expect(element.props).toMatchObject({
        handleOpenSettings,
        themeColorForeground: "#fff",
      });
    });

    it("buildHeaderRightRenderer returns a renderer for the refresh header action", () => {
      const handleRefresh = jest.fn().mockResolvedValue(undefined);
      const renderer = buildHeaderRightRenderer({
        refreshAccessibilityLabel: "Actualizar lista",
        isRefreshing: true,
        isManualSyncEnabled: false,
        themeColorForeground: "#000",
        handleRefresh,
      });

      const element = renderer();

      expect(element.type).toBe(AnimeListScreenHeaderRight);
        expect(element.props).toMatchObject({
          refreshAccessibilityLabel: "Actualizar lista",
          isRefreshing: true,
          isManualSyncEnabled: false,
          themeColorForeground: "#000",
          handleRefresh,
        });
    });
  });
});
