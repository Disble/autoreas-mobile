import {
  calculateProgress,
  canDecrease,
  canIncrease,
  getIsCompleted,
  getRestantesLabel,
  getStateChip,
  isAnimeMutationLocked,
} from "../../../../src/features/animes/ui/AnimeCard/anime-card.helpers";

describe("anime-card helpers", () => {
  it("calculates progress only when total chapters are valid", () => {
    expect(calculateProgress(6, 12)).toBe(50);
    expect(calculateProgress(3, null)).toBeNull();
    expect(calculateProgress(3, 0)).toBeNull();
  });

  it("flags completed anime when progress reaches 100", () => {
    expect(getIsCompleted(100)).toBe(true);
    expect(getIsCompleted(99)).toBe(false);
    expect(getIsCompleted(null)).toBe(false);
  });

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
