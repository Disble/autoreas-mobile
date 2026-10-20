import {
  canDecrease,
  canIncrease,
  composeMetaLine,
  getAnimeCardMetaLabel,
  getAnimeCardMetaSegments,
  getAnimeSeasonStatus,
  getLongEpisodeLabel,
  getNoteSegmentLabel,
  getRestantesLabel,
  getStateChip,
  getWatchedCountLabel,
  isAnimeMutationLocked,
} from "../../../../src/features/animes/ui/AnimeCard/anime-card.helpers";

describe("anime-card helpers", () => {
  it("guards chapter mutations with proper boundaries", () => {
    expect(canDecrease(0)).toBe(false);
    expect(canDecrease(1)).toBe(true);
    expect(canIncrease(5, 5)).toBe(false);
    expect(canIncrease(4, 5)).toBe(true);
    expect(canIncrease(20, null)).toBe(true);
  });

  it("keeps viewing state unlocked and finalizado locked", () => {
    expect(isAnimeMutationLocked(1)).toBe(true);
    expect(isAnimeMutationLocked(0)).toBe(false);
  });

  it("locks mutations for every non-viewing legacy state", () => {
    expect(isAnimeMutationLocked(1)).toBe(true);
    expect(isAnimeMutationLocked(2)).toBe(true);
    expect(isAnimeMutationLocked(3)).toBe(true);
  });

  describe("getStateChip", () => {
    it("maps legacy estado values to chip descriptors", () => {
      expect(getStateChip(0)).toMatchObject({ label: "Viendo", tone: "accent" });
      expect(getStateChip(1)).toMatchObject({
        label: "Finalizado",
        tone: "success",
      });
      expect(getStateChip(3)).toMatchObject({
        label: "En pausa",
        tone: "warning",
      });
      expect(getStateChip(2)).toMatchObject({
        label: "No me gustó",
        tone: "danger",
      });
    });

    it("falls back to viewing for unknown estado", () => {
      expect(getStateChip(99)).toMatchObject({ label: "Viendo" });
    });

    it("flags the default Viendo state so the card can render it implicitly", () => {
      expect(getStateChip(0).isDefault).toBe(true);
      expect(getStateChip(99).isDefault).toBe(true);
    });

    it("does not mark attention-worthy states as default", () => {
      expect(getStateChip(1).isDefault).toBe(false);
      expect(getStateChip(2).isDefault).toBe(false);
      expect(getStateChip(3).isDefault).toBe(false);
    });
  });

  describe("getRestantesLabel", () => {
    it("returns the remaining episodes when totalcap is known", () => {
      expect(getRestantesLabel(5, 12)).toBe("7 restantes");
    });

    it("rounds up partial chapter counts so half-caps count as unfinished", () => {
      expect(getRestantesLabel(5.5, 12)).toBe("7 restantes");
    });

    it("returns null when totalcap is missing", () => {
      expect(getRestantesLabel(5, null)).toBeNull();
      expect(getRestantesLabel(5, undefined)).toBeNull();
    });

    it("returns null when there are no remaining episodes", () => {
      expect(getRestantesLabel(12, 12)).toBeNull();
      expect(getRestantesLabel(13, 12)).toBeNull();
    });
  });
});

describe("getLongEpisodeLabel", () => {
  const EPISODES = [
    { episode: 6, minutes: 24, long: false },
    { episode: 7, minutes: 45, long: true },
  ];

  it("labels the next episode when the bridge marked it long", () => {
    expect(getLongEpisodeLabel(EPISODES, 6)).toBe("Ep. 7 · 45 min");
  });

  it("trusts the bridge's long flag even at 30 minutes", () => {
    expect(getLongEpisodeLabel([{ episode: 7, minutes: 30, long: true }], 6)).toBe(
      "Ep. 7 · 30 min",
    );
  });

  it("shows nothing when the next episode is not long", () => {
    expect(getLongEpisodeLabel(EPISODES, 5)).toBeNull();
  });

  it("shows nothing when only a later episode is long", () => {
    expect(getLongEpisodeLabel(EPISODES, 4)).toBeNull();
  });

  it("shows nothing for a fractional count, which has no next episode", () => {
    expect(getLongEpisodeLabel(EPISODES, 6.5)).toBeNull();
  });

  it("shows nothing when no durations are known", () => {
    expect(getLongEpisodeLabel(null, 6)).toBeNull();
    expect(getLongEpisodeLabel(undefined, 6)).toBeNull();
  });
});

describe("getWatchedCountLabel", () => {
  it("keeps the singular for exactly one watched chapter", () => {
    expect(getWatchedCountLabel(1)).toBe("1 capítulo visto");
  });

  it("uses the plural for every other count, including zero", () => {
    expect(getWatchedCountLabel(0)).toBe("0 capítulos vistos");
    expect(getWatchedCountLabel(6)).toBe("6 capítulos vistos");
  });

  it("keeps a fractional count visible instead of rounding it away", () => {
    expect(getWatchedCountLabel(6.5)).toBe("6.5 capítulos vistos");
  });
});

describe("getNoteSegmentLabel", () => {
  it("drops the note segment when the anime has no season candidacy", () => {
    expect(getNoteSegmentLabel(null)).toBeNull();
    expect(getNoteSegmentLabel(undefined)).toBeNull();
  });

  it("labels a confirmed bridge rating as Nota, not Temporada", () => {
    expect(
      getNoteSegmentLabel(
        getAnimeSeasonStatus({ seasonId: "season-2026-q3", bridgeRating: 3, localIntent: null }),
      ),
    ).toBe("Nota 3/6");
  });

  it("shows the newest local choice as the note, with no sync wording", () => {
    expect(
      getNoteSegmentLabel(
        getAnimeSeasonStatus({
          seasonId: "season-2026-q3",
          bridgeRating: 2,
          localIntent: {
            nota: 6,
            ratedAt: 1_752_500_000_000,
            createdAt: 1_752_500_100_000,
            status: "pending",
            failureKind: null,
          },
        }),
      ),
    ).toBe("Nota 6/6");
  });

  it("reads Sin nota for an ungraded candidate", () => {
    expect(
      getNoteSegmentLabel(
        getAnimeSeasonStatus({ seasonId: "season-2026-q3", bridgeRating: null, localIntent: null }),
      ),
    ).toBe("Sin nota");
  });
});

describe("composeMetaLine", () => {
  it("joins the segments with the dot separator", () => {
    expect(composeMetaLine(["1 capítulo visto", "Viendo", "Nota 3/6"])).toBe(
      "1 capítulo visto · Viendo · Nota 3/6",
    );
  });

  it("never leaves a separator alone when a segment is absent", () => {
    expect(composeMetaLine(["3 capítulos vistos", "Viendo", null])).toBe(
      "3 capítulos vistos · Viendo",
    );
    expect(composeMetaLine(["3 capítulos vistos", "Viendo", undefined])).toBe(
      "3 capítulos vistos · Viendo",
    );
    expect(composeMetaLine(["3 capítulos vistos", "Viendo", ""])).toBe(
      "3 capítulos vistos · Viendo",
    );
    expect(composeMetaLine([null, "Viendo"])).toBe("Viendo");
    expect(composeMetaLine(["Viendo", null])).toBe("Viendo");
  });

  it("collapses blank-only and whitespace-only segments so no separator is doubled", () => {
    expect(composeMetaLine(["Viendo", null, "Nota 3/6"])).toBe("Viendo · Nota 3/6");
    expect(composeMetaLine(["Viendo", "   ", "Nota 3/6"])).toBe("Viendo · Nota 3/6");
    expect(composeMetaLine([null, null, null])).toBe("");
  });
});

describe("getAnimeCardMetaSegments", () => {
  it("returns the count, the state and the note as ordered segments with their kind", () => {
    expect(
      getAnimeCardMetaSegments({
        nrocapvisto: 1,
        stateLabel: "Viendo",
        noteLabel: "Nota 3/6",
      }),
    ).toEqual([
      { kind: "count", text: "1 capítulo visto" },
      { kind: "state", text: "Viendo" },
      { kind: "note", text: "Nota 3/6" },
    ]);
  });

  it("drops the note segment when the anime has no note to show", () => {
    expect(
      getAnimeCardMetaSegments({
        nrocapvisto: 3,
        stateLabel: "Viendo",
        noteLabel: null,
      }),
    ).toEqual([
      { kind: "count", text: "3 capítulos vistos" },
      { kind: "state", text: "Viendo" },
    ]);
  });

  it("keeps the count kind while the toggle swaps its text for the remaining form", () => {
    expect(
      getAnimeCardMetaSegments({
        nrocapvisto: 6,
        stateLabel: "En pausa",
        noteLabel: "Nota 4/6",
        restantesLabel: "6 restantes",
        restantesShown: true,
      }),
    ).toEqual([
      { kind: "count", text: "6 restantes" },
      { kind: "state", text: "En pausa" },
      { kind: "note", text: "Nota 4/6" },
    ]);
  });

  it("drops blank segments so no separator can be drawn with nothing beside it", () => {
    expect(
      getAnimeCardMetaSegments({
        nrocapvisto: 0,
        stateLabel: "   ",
        noteLabel: "",
      }),
    ).toEqual([{ kind: "count", text: "0 capítulos vistos" }]);
  });

  it("composes the accessible label from the same segments the view draws", () => {
    const params = {
      nrocapvisto: 6,
      stateLabel: "En pausa",
      noteLabel: "Nota 4/6",
    };
    const segments = getAnimeCardMetaSegments(params);

    expect(getAnimeCardMetaLabel(params)).toBe(
      composeMetaLine(segments.map((segment) => segment.text)),
    );
    expect(getAnimeCardMetaLabel(params)).toBe(
      "6 capítulos vistos · En pausa · Nota 4/6",
    );
  });
});

describe("getAnimeCardMetaLabel", () => {
  it("renders one watched chapter, the state and the note in one line", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 1,
        stateLabel: "Viendo",
        noteLabel: "Nota 3/6",
      }),
    ).toBe("1 capítulo visto · Viendo · Nota 3/6");
  });

  it("renders several watched chapters while the anime is paused", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 6,
        stateLabel: "En pausa",
        noteLabel: "Nota 4/6",
      }),
    ).toBe("6 capítulos vistos · En pausa · Nota 4/6");
  });

  it("ends at the state when there is no note segment to show", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 3,
        stateLabel: "Viendo",
        noteLabel: null,
      }),
    ).toBe("3 capítulos vistos · Viendo");
  });

  it("renders Sin nota when the note segment exists but holds no rating", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 1,
        stateLabel: "Viendo",
        noteLabel: "Sin nota",
      }),
    ).toBe("1 capítulo visto · Viendo · Sin nota");
  });

  it("swaps only the count segment for the remaining form while the toggle is on", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 6,
        stateLabel: "Viendo",
        noteLabel: "Nota 4/6",
        restantesLabel: "6 restantes",
        restantesShown: true,
      }),
    ).toBe("6 restantes · Viendo · Nota 4/6");
  });

  it("keeps the watched count when the toggle is on but no remaining total exists", () => {
    expect(
      getAnimeCardMetaLabel({
        nrocapvisto: 6,
        stateLabel: "Viendo",
        noteLabel: "Nota 4/6",
        restantesLabel: null,
        restantesShown: true,
      }),
    ).toBe("6 capítulos vistos · Viendo · Nota 4/6");
  });

  it("carries the state label of every persisted estado, paused included", () => {
    const lineFor = (estado: number) =>
      getAnimeCardMetaLabel({
        nrocapvisto: 2,
        stateLabel: getStateChip(estado).label,
        noteLabel: null,
      });

    expect(lineFor(0)).toBe("2 capítulos vistos · Viendo");
    expect(lineFor(1)).toBe("2 capítulos vistos · Finalizado");
    expect(lineFor(2)).toBe("2 capítulos vistos · No me gustó");
    expect(lineFor(3)).toBe("2 capítulos vistos · En pausa");
  });
});
