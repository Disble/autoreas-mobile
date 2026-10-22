import { createAnimeListItemSharer } from "../../../src/features/animes/anime-list.helpers";
import type { AnimeListItem } from "../../../src/features/animes/anime-season.types";
import { buildAnimeListItemFixture } from "./__tests__/use-anime-list-item-renderer.helpers";

/** Builds a list item whose nested data (days, season, projection) is freshly allocated each call. */
function buildItem(id: string, overrides: Partial<AnimeListItem> = {}): AnimeListItem {
  return buildAnimeListItemFixture(id, {
    dias: [{ dia: "Lunes", orden: 1 }],
    generos: ["Acción"],
    seasonProjection: { seasonId: "2026-Q4", bridgeRating: null, localIntent: { nota: 7 } },
    ...overrides,
  } as Partial<AnimeListItem>);
}

describe("createAnimeListItemSharer", () => {
  it("returns the previous item object when a fresh copy carries the same data", () => {
    const share = createAnimeListItemSharer();
    const [first] = share([buildItem("anime-1"), buildItem("anime-2")]);

    const [second] = share([buildItem("anime-1"), buildItem("anime-2", { nrocapvisto: 3 })]);

    expect(second).toBe(first);
  });

  it("returns the new object for an item whose data changed, at any depth", () => {
    const share = createAnimeListItemSharer();
    const [, previous] = share([buildItem("anime-1"), buildItem("anime-2")]);

    const changedField = share([buildItem("anime-1"), buildItem("anime-2", { nrocapvisto: 3 })])[1];
    const changedProjection = share([
      buildItem("anime-1"),
      buildItem("anime-2", {
        seasonProjection: { seasonId: "2026-Q4", bridgeRating: null, localIntent: { nota: 8 } },
      } as Partial<AnimeListItem>),
    ])[1];

    expect(changedField).not.toBe(previous);
    expect(changedField?.nrocapvisto).toBe(3);
    expect(changedProjection?.seasonProjection?.localIntent?.nota).toBe(8);
  });

  it("treats a changed array length or element as a change", () => {
    const share = createAnimeListItemSharer();
    const [previous] = share([buildItem("anime-1")]);

    const [moreDays] = share([
      buildItem("anime-1", { dias: [{ dia: "Lunes", orden: 1 }, { dia: "Martes", orden: 2 }] }),
    ]);
    const [otherGenre] = share([buildItem("anime-1", { generos: ["Drama"] })]);

    expect(moreDays).not.toBe(previous);
    expect(otherGenre).not.toBe(moreDays);
  });

  it("treats a field the previous copy did not have as a change", () => {
    const share = createAnimeListItemSharer();
    const [previous] = share([buildItem("anime-1")]);

    const [withFolder] = share([buildItem("anime-1", { folderRelative: "Bleach" })]);

    expect(withFolder).not.toBe(previous);
    expect(withFolder?.folderRelative).toBe("Bleach");
  });

  it("returns the previous array when every item is unchanged and in the same order", () => {
    const share = createAnimeListItemSharer();
    const previous = share([buildItem("anime-1"), buildItem("anime-2")]);

    expect(share([buildItem("anime-1"), buildItem("anime-2")])).toBe(previous);
  });

  it("returns a new array when items are reordered, added or removed, keeping the item objects", () => {
    const share = createAnimeListItemSharer();
    const previous = share([buildItem("anime-1"), buildItem("anime-2")]);

    const reordered = share([buildItem("anime-2"), buildItem("anime-1")]);
    const shorter = share([buildItem("anime-2")]);

    expect(reordered).not.toBe(previous);
    expect(reordered[0]).toBe(previous[1]);
    expect(reordered[1]).toBe(previous[0]);
    expect(shorter).toHaveLength(1);
    expect(shorter[0]).toBe(previous[1]);
  });

  it("forgets removed items, so one that comes back is the new object", () => {
    const share = createAnimeListItemSharer();
    const [removed] = share([buildItem("anime-1")]);
    share([]);

    const [returned] = share([buildItem("anime-1")]);

    expect(returned).not.toBe(removed);
    expect(returned).toEqual(removed);
  });
});
