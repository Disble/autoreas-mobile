import { AnimeStateSheet } from '../AnimeStateSheet';
import { SeasonRatingSheet } from '../SeasonRatingSheet';
import { SyncStatusSheet } from '../SyncStatusControl/SyncStatusSheet';
import type { AnimeListScreenSheetsProps } from './anime-list-screen.types';

/** Renders the state, season-rating and sync sheets from their current request models. */
export function AnimeListScreenSheets(props: Readonly<AnimeListScreenSheetsProps>) {
  const {
    stateSheetRequest,
    seasonRatingSheetRequest,
    isManualSyncEnabled,
    isSyncSheetOpen,
    syncStatus,
    handleCloseSeasonRatingSheet,
    handleCloseStateSheet,
    handleCloseSyncSheet,
    handleOpenSettings,
    handleRefresh,
    handleSeasonRatingSubmit,
    handleStateSheetSelect,
  } = props;

  return (
    <>
      <AnimeStateSheet
        visible={stateSheetRequest !== null}
        currentEstado={stateSheetRequest?.currentEstado ?? 0}
        onSelect={handleStateSheetSelect}
        onClose={handleCloseStateSheet}
      />

      <SeasonRatingSheet
        animeTitle={seasonRatingSheetRequest?.animeTitle ?? ''}
        bridgeRating={seasonRatingSheetRequest?.bridgeRating ?? null}
        isOpen={seasonRatingSheetRequest !== null}
        onClose={handleCloseSeasonRatingSheet}
        onSubmit={handleSeasonRatingSubmit}
        pendingRating={seasonRatingSheetRequest?.pendingRating ?? null}
      />

      <SyncStatusSheet
        isManualSyncEnabled={isManualSyncEnabled}
        isOpen={isSyncSheetOpen}
        onAction={handleOpenSettings}
        onClose={handleCloseSyncSheet}
        onSyncNow={handleRefresh}
        status={syncStatus}
      />
    </>
  );
}
