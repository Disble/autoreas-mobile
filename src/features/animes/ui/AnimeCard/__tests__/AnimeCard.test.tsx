import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AnimeCard } from "../AnimeCard";
import {
  buildAnimeCardAnime,
  buildAnimeCardProps,
} from "./anime-card-test.helpers";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

describe("AnimeCard", () => {
  it("shows no season CTA for non-candidates", () => {
    const { queryByText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    expect(queryByText("Temporada")).toBeNull();
  });

  it("shows confirmed bridge rating for active candidate", () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: "season-2026-q3",
              bridgeRating: 4,
              bridgeRatingSource: "bridge",
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText("Temporada 4/6")).toBeTruthy();
    expect(getByText("Confirmado por bridge")).toBeTruthy();
    expect(getByText("Temporada")).toBeTruthy();
  });

  it("shows pending local truth without claiming bridge confirmation", () => {
    const onOpenSeasonRatingSheet = jest.fn();
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          onOpenSeasonRatingSheet,
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: "season-2026-q3",
              bridgeRating: 2,
              bridgeRatingSource: "bridge",
              localIntent: {
                nota: 6,
                ratedAt: 1_752_500_000_000,
                createdAt: 1_752_500_100_000,
                status: "pending",
                failureKind: null,
              },
            },
          },
        })}
      />,
    );

    expect(getByText("Pendiente 6/6")).toBeTruthy();
    expect(getByText("Esperando confirmación del bridge")).toBeTruthy();

    fireEvent.press(getByText("Temporada"));

    expect(onOpenSeasonRatingSheet).toHaveBeenCalledWith("anime-1");
  });
});
