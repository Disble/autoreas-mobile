import type { SeasonRatingQueueRow } from "../../../infrastructure/db/schema";
import { LOCAL_ACTIVE_SEASON_ID } from "../anime-season.constants";
import {
  buildAnimeSeasonProjection,
  selectLatestSeasonRatingIntent,
} from "../anime-season.helpers";

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

  it("builds projection only for bridge-declared candidates", () => {
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
      allowLocalActiveFallback: false,
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
        allowLocalActiveFallback: false,
        seasonRatingQueueRows: [buildQueueRow({ animeId: "anime-2" })],
      }),
    ).toBeNull();
  });

  it("builds a local active fallback projection for Ver hoy without snapshot hydration", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      allowLocalActiveFallback: true,
      activeSeasonSnapshot: null,
      seasonRatingQueueRows: [],
    });

    expect(projection).toEqual({
      seasonId: LOCAL_ACTIVE_SEASON_ID,
      bridgeRating: null,
      bridgeRatingSource: null,
      localIntent: null,
    });
  });

  it("keeps the active season id for fallback projection when snapshot exists but candidate is missing", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      allowLocalActiveFallback: true,
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
