import { AnimeStateSheet } from '../AnimeStateSheet';
import { SeasonRatingSheet } from '../SeasonRatingSheet';
import type { AnimeListScreenSheetsProps } from './anime-list-screen.types';

/** Renders state and season-rating sheets from their current request models. */
export function AnimeListScreenSheets(props: Readonly<AnimeListScreenSheetsProps>) {
  const {
    stateSheetRequest,
    seasonRatingSheetRequest,
    handleCloseSeasonRatingSheet,
    handleCloseStateSheet,
    handleSeasonRatingSubmit,
    handleStateSheetSelect,
  } = props;

  return (
    <>
      <AnimeStateSheet
        visible={stateSheetRequest !== null}
        currentEstado={stateSheetRequest?.currentEstado ?? 0}
        onSelect={(estado) => {
          void handleStateSheetSelect(estado);
        }}
        onClose={handleCloseStateSheet}
      />

      <SeasonRatingSheet
        animeTitle={seasonRatingSheetRequest?.animeTitle ?? ''}
        bridgeRating={seasonRatingSheetRequest?.bridgeRating ?? null}
        isOpen={seasonRatingSheetRequest !== null}
        onClose={handleCloseSeasonRatingSheet}
        onSubmit={(rating) => {
          void handleSeasonRatingSubmit(rating);
        }}
        pendingFailureKind={seasonRatingSheetRequest?.pendingFailureKind ?? null}
        pendingRating={seasonRatingSheetRequest?.pendingRating ?? null}
        pendingStatus={seasonRatingSheetRequest?.pendingStatus ?? null}
      />
    </>
  );
}
