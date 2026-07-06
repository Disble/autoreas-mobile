import { renderHook } from "@testing-library/react-native";
import { useActiveSeasonStore } from "../../../infrastructure/store/active-season-store";
import { enqueueSeasonRatingIntent } from "../../../features/sync/season-rating-queue.helpers";
import { useSeasonRatingIntent } from "../use-season-rating-intent";
import { createMockRawDb } from "./use-season-rating-intent.helpers";

jest.mock("../../../infrastructure/db/native-runtime", () => ({
  getExpoSQLiteUnavailableError: () => new Error("sqlite unavailable"),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock("../../../features/sync/season-rating-queue.helpers", () => ({
  enqueueSeasonRatingIntent: jest.fn(),
}));

describe("useSeasonRatingIntent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    const { useOptionalSQLiteContext } = jest.requireMock(
      "../../../infrastructure/db/native-runtime",
    );
    useOptionalSQLiteContext.mockReturnValue(createMockRawDb());
  });

  it("enqueues durable intent for the active season", async () => {
    useActiveSeasonStore.setState({
      activeSeasonSnapshot: {
        seasonId: "season-2026-q3",
        candidates: [],
        candidatesByAnimeId: {},
      },
    });
    (enqueueSeasonRatingIntent as jest.Mock).mockResolvedValue(undefined);

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_752_400_000_000);
    const { result } = renderHook(() => useSeasonRatingIntent());

    await result.current.submitSeasonRatingIntent("anime-1", 6);

    expect(enqueueSeasonRatingIntent).toHaveBeenCalledWith(
      createMockRawDb(),
      {
        seasonId: "season-2026-q3",
        animeId: "anime-1",
        nota: 6,
        ratedAt: 1_752_400_000_000,
      },
    );

    nowSpy.mockRestore();
  });

  it("does nothing when there is no active season snapshot", async () => {
    const { result } = renderHook(() => useSeasonRatingIntent());

    await result.current.submitSeasonRatingIntent("anime-1", 4);

    expect(enqueueSeasonRatingIntent).not.toHaveBeenCalled();
  });
});
