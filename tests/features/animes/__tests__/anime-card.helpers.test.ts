import {
  canDecrease,
  canIncrease,
  getLongEpisodeLabel,
  getRestantesLabel,
  getStateChip,
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
