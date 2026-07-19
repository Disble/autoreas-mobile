import type { SeasonRatingQueueRow } from "../../../../src/infrastructure/db/schema";
import { LOCAL_ACTIVE_SEASON_ID } from "../../../../src/features/animes/anime-season.constants";
import {
  buildAnimeSeasonProjection,
  selectLatestSeasonRatingIntent,
} from "../../../../src/features/animes/anime-season.helpers";

function buildQueueRow(overrides: Partial<SeasonRatingQueueRow> = {}): SeasonRatingQueueRow {
  return {
    id: 1,
    seasonId: "season-2026-q3",
    animeId: "anime-1",
    nota: 5,
    ratedAt: 1_752_000_000_000,
    status: "pending",
    createdAt: 1_752_000_100_000,
    updatedAt: 1_752_000_100_000,
    lastAttemptAt: null,
    lastFailureKind: null,
    ...overrides,
  };
}

describe("anime season helpers", () => {
  it("picks the latest local intent for the active candidate", () => {
    const latest = selectLatestSeasonRatingIntent(
      "anime-1",
      ["season-2026-q3", LOCAL_ACTIVE_SEASON_ID],
      [
        buildQueueRow({ id: 1, nota: 3, createdAt: 1_752_000_100_000 }),
        buildQueueRow({ id: 2, nota: 6, createdAt: 1_752_000_200_000, status: "failed", lastFailureKind: "auth_repair" }),
      ],
    );

    expect(latest).toEqual({
      nota: 6,
      ratedAt: 1_752_000_000_000,
      createdAt: 1_752_000_200_000,
      status: "failed",
      failureKind: "auth_repair",
    });
  });

  it("ignores rows outside the provided season lookup ids", () => {
    const latest = selectLatestSeasonRatingIntent(
      "anime-1",
      ["season-2026-q3"],
      [buildQueueRow({ seasonId: "season-2025-q4", nota: 9 })],
    );

    expect(latest).toBeNull();
  });

  it("returns null when there are no matching rows", () => {
    const latest = selectLatestSeasonRatingIntent("anime-1", ["season-2026-q3"], []);

    expect(latest).toBeNull();
  });

  it("builds a bridge candidate projection and omits unrelated animes", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      activeSeasonSnapshot: {
        seasonId: "season-2026-q3",
        candidates: [
          {
            animeId: "anime-1",
            bridgeRating: 4,
            bridgeRatingSource: "bridge",
          },
        ],
        candidatesByAnimeId: {
          "anime-1": {
            animeId: "anime-1",
            bridgeRating: 4,
            bridgeRatingSource: "bridge",
          },
        },
      },
      seasonRatingQueueRows: [buildQueueRow({ nota: 6 })],
    });

    expect(projection).toEqual({
      seasonId: "season-2026-q3",
      bridgeRating: 4,
      bridgeRatingSource: "bridge",
      localIntent: {
        nota: 6,
        ratedAt: 1_752_000_000_000,
        createdAt: 1_752_000_100_000,
        status: "pending",
        failureKind: null,
      },
    });
    expect(
      buildAnimeSeasonProjection({
        animeId: "anime-2",
        activeSeasonSnapshot: {
          seasonId: "season-2026-q3",
          candidates: [],
          candidatesByAnimeId: {},
        },
        seasonRatingQueueRows: [],
      }),
    ).toBeNull();
  });

  it("does not infer a season candidate when the bridge snapshot is unavailable", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      activeSeasonSnapshot: null,
      seasonRatingQueueRows: [],
    });

    expect(projection).toBeNull();
  });

  it("keeps a persisted local intent visible without an active bridge candidate", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      activeSeasonSnapshot: {
        seasonId: "season-2026-q3",
        candidates: [],
        candidatesByAnimeId: {},
      },
      seasonRatingQueueRows: [
        buildQueueRow({
          seasonId: "season-2026-q3",
          animeId: "anime-1",
          nota: 5,
        }),
      ],
    });

    expect(projection).toEqual({
      seasonId: "season-2026-q3",
      bridgeRating: null,
      bridgeRatingSource: null,
      localIntent: {
        nota: 5,
        ratedAt: 1_752_000_000_000,
        createdAt: 1_752_000_100_000,
        status: "pending",
        failureKind: null,
      },
    });
  });
});
