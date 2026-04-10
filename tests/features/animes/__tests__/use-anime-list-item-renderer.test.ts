import { act, renderHook } from "@testing-library/react-native";
import { useAnimeListItemRenderer } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-item-renderer";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

function buildAnime(id: string, overrides: Partial<Anime> = {}): Anime {
  return {
    _id: id,
    nombre: id,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: [],
    generos: [],
    tipo: null,
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: null,
    fechaEstreno: null,
    fechaCreacion: null,
    fechaEliminacion: null,
    portada: null,
    pagina: null,
    carpeta: null,
    estudios: null,
    origen: null,
    duracion: null,
    ...overrides,
  };
}

describe("useAnimeListItemRenderer", () => {
  it("builds AnimeCard props and forwards mutation state", () => {
    const item = buildAnime("anime-1");
    const handleCapMinus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlusHalf = jest.fn().mockResolvedValue(undefined);
    const handleCapMinusHalf = jest.fn().mockResolvedValue(undefined);
    const handleOpenStateSheet = jest.fn();

    const { result } = renderHook(() =>
      useAnimeListItemRenderer(
        { "anime-1": true },
        handleCapMinus,
        handleCapPlus,
        handleCapPlusHalf,
        handleCapMinusHalf,
        handleOpenStateSheet,
      ),
    );

    const cardProps = result.current.getAnimeCardProps(item);

    expect(cardProps.anime).toBe(item);
    expect(cardProps.isMutating).toBe(true);
  });

  it("wires AnimeCard actions to callbacks with the item id", async () => {
    const item = buildAnime("anime-2", { estado: 2 });
    const handleCapMinus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlusHalf = jest.fn().mockResolvedValue(undefined);
    const handleCapMinusHalf = jest.fn().mockResolvedValue(undefined);
    const handleOpenStateSheet = jest.fn();

    const { result } = renderHook(() =>
      useAnimeListItemRenderer(
        {},
        handleCapMinus,
        handleCapPlus,
        handleCapPlusHalf,
        handleCapMinusHalf,
        handleOpenStateSheet,
      ),
    );

    const cardProps = result.current.getAnimeCardProps(item);

    await act(async () => {
      await cardProps.onCapMinus();
      await cardProps.onCapPlus();
      await cardProps.onCapMinusHalf?.();
      await cardProps.onCapPlusHalf?.();
    });

    cardProps.onOpenStateSheet?.("anime-2", 2);

    expect(handleCapMinus).toHaveBeenCalledWith("anime-2");
    expect(handleCapPlus).toHaveBeenCalledWith("anime-2");
    expect(handleCapMinusHalf).toHaveBeenCalledWith("anime-2");
    expect(handleCapPlusHalf).toHaveBeenCalledWith("anime-2");
    expect(handleOpenStateSheet).toHaveBeenCalledWith("anime-2", 2);
  });
});
