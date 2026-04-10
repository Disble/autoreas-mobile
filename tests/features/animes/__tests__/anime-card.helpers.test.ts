import {
  calculateProgress,
  canDecrease,
  canIncrease,
  getIsCompleted,
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
});
