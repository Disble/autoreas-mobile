import type { SeasonRatingIntent } from "../../../../src/features/sync/season-rating-event.types";
import {
  buildAnimeSeasonProjection,
  selectLatestSeasonRatingIntent,
} from "../../../../src/features/animes/anime-season.helpers";

/** Builds one queued season-rating intent with every field defaulted, so each test states only what it varies. */
function buildQueueRow(overrides: Partial<SeasonRatingIntent> = {}): SeasonRatingIntent {
  return {
    id: 1,
    seasonId: "season-2026-q3",
    animeId: "anime-1",
    nota: 5,
    ratedAt: 1_752_000_000_000,
    status: "pending",
    createdAt: 1_752_000_100_000,
    failureKind: null,
    ...overrides,
  };
}

describe("anime season helpers", () => {
  it("picks the latest local intent of the anime for the season", () => {
    const latest = selectLatestSeasonRatingIntent(
      "anime-1",
      "season-2026-q3",
      [
        buildQueueRow({ id: 1, nota: 3, createdAt: 1_752_000_100_000 }),
        buildQueueRow({ id: 2, nota: 6, createdAt: 1_752_000_200_000, status: "failed", failureKind: "auth_repair" }),
        buildQueueRow({ id: 3, nota: 1, createdAt: 1_752_000_300_000, animeId: "anime-2" }),
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

  it("ignores rows of another season", () => {
    const latest = selectLatestSeasonRatingIntent(
      "anime-1",
      "season-2026-q3",
      [buildQueueRow({ seasonId: "season-2025-q4", nota: 6 })],
    );

    expect(latest).toBeNull();
  });

  it("returns null when there are no matching rows", () => {
    expect(selectLatestSeasonRatingIntent("anime-1", "season-2026-q3", [])).toBeNull();
  });

  it("builds the projection from the anime's own candidacy, its grade as the bridge rating", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      season: { seasonId: "season-2026-q3", grade: 4 },
      seasonRatingIntents: [buildQueueRow({ nota: 6 })],
    });

    expect(projection).toEqual({
      seasonId: "season-2026-q3",
      bridgeRating: 4,
      localIntent: {
        nota: 6,
        ratedAt: 1_752_000_000_000,
        createdAt: 1_752_000_100_000,
        status: "pending",
        failureKind: null,
      },
    });
  });

  it("keeps an ungraded candidate with no local intent rateable", () => {
    expect(
      buildAnimeSeasonProjection({
        animeId: "anime-1",
        season: { seasonId: "season-2026-q3", grade: null },
        seasonRatingIntents: [],
      }),
    ).toEqual({ seasonId: "season-2026-q3", bridgeRating: null, localIntent: null });
  });

  it.each([null, undefined])("has no projection when the anime is not a candidate (%s), even with a queued intent", (season) => {
    expect(
      buildAnimeSeasonProjection({
        animeId: "anime-1",
        season,
        seasonRatingIntents: [buildQueueRow({ nota: 5 })],
      }),
    ).toBeNull();
  });

  it("counts only the intents queued for the season the anime is a candidate of", () => {
    const projection = buildAnimeSeasonProjection({
      animeId: "anime-1",
      season: { seasonId: "season-2026-q4", grade: 2 },
      seasonRatingIntents: [buildQueueRow({ seasonId: "season-2026-q3", nota: 6 })],
    });

    expect(projection).toEqual({ seasonId: "season-2026-q4", bridgeRating: 2, localIntent: null });
  });
});
