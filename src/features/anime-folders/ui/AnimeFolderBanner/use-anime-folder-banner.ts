import { useCallback, useMemo, useState } from 'react';
import { useAnimeFolders } from '../../use-anime-folders';
import { getAnimeFolderBannerKind } from './anime-folder-banner.helpers';

/** Decides which anime folder banner to show and wires its actions and the setup sheet. */
export function useAnimeFolderBanner() {
  // 1. Refs

  // 2. State
  const [isSetupSheetOpen, setSetupSheetOpen] = useState(false);

  // 3. Context/3rd Party Hooks
  const { isLoaded, status, rootLabel, hintDismissedAt, chooseRoot, dismissHint } =
    useAnimeFolders();

  // 4. Queries/Mutations

  // 5. Derived State
  const kind = useMemo(
    () =>
      getAnimeFolderBannerKind({ isLoaded, status, hasRoot: rootLabel !== null, hintDismissedAt }),
    [isLoaded, status, rootLabel, hintDismissedAt],
  );

  // 6. Callbacks
  const handleOpenSetupSheet = useCallback(() => setSetupSheetOpen(true), []);
  const handleCloseSetupSheet = useCallback(() => setSetupSheetOpen(false), []);
  const handleChooseFromSheet = useCallback(() => {
    setSetupSheetOpen(false);
    void chooseRoot();
  }, [chooseRoot]);
  const handleChooseAgain = useCallback(() => {
    void chooseRoot();
  }, [chooseRoot]);

  // 7. Effects

  return {
    kind,
    isSetupSheetOpen,
    handleDismiss: dismissHint,
    handleOpenSetupSheet,
    handleCloseSetupSheet,
    handleChooseFromSheet,
    handleChooseAgain,
  };
}
