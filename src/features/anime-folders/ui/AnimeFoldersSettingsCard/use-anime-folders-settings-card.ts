import { type Href, useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimeFolderResolution } from '../../use-anime-folder-resolution';
import { useAnimeFolders } from '../../use-anime-folders';
import { ANIME_FOLDERS_DETAIL_HREF } from './anime-folders-settings-card.constants';
import {
  buildAnimeFoldersSettingsCardView,
  formatAnimeFoldersConfirmation,
} from './anime-folders-settings-card.helpers';
import type { AnimeFoldersConfirmationRequest } from './anime-folders-settings-card.types';

/**
 * Wires the "Carpetas de anime" Settings card: its copy, reindex, choosing a folder, and the
 * confirmation once the chosen folder is indexed. `view` stays `null` until the saved folder is
 * loaded, so the card never flashes the no-folder state on the way in.
 */
export function useAnimeFoldersSettingsCard() {
  // 1. Refs
  /** Id of the last confirmation request already answered (shown, or dropped on lost access). */
  const settledRequestIdRef = useRef(0);

  // 2. State
  /** Root picked from this card whose confirmation is owed once its index is ready. */
  const [confirmation, setConfirmation] = useState<AnimeFoldersConfirmationRequest | null>(null);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { toast } = useToast();
  const { rootUri, status, rootLabel, indexedAt, isLoaded, reindex, chooseRoot } = useAnimeFolders();
  const resolution = useAnimeFolderResolution();

  // 4. Queries/Mutations

  // 5. Derived State
  const summary = resolution?.summary ?? null;
  const view = useMemo(
    () =>
      isLoaded
        ? buildAnimeFoldersSettingsCardView({ status, rootLabel, summary, indexedAt, now: new Date() })
        : null,
    [isLoaded, status, rootLabel, summary, indexedAt],
  );

  // 6. Callbacks
  const handleOpenDetail = useCallback(() => {
    router.push(ANIME_FOLDERS_DETAIL_HREF as Href);
  }, [router]);

  const handleChooseRoot = useCallback(() => {
    void chooseRoot().then((pickedUri) => {
      if (pickedUri) {
        setConfirmation((previous) => ({ rootUri: pickedUri, id: (previous?.id ?? 0) + 1 }));
      }
    });
  }, [chooseRoot]);

  // 7. Effects
  useEffect(() => {
    const isOwed =
      confirmation !== null &&
      confirmation.id !== settledRequestIdRef.current &&
      confirmation.rootUri === rootUri;

    if (!isOwed) {
      return;
    }

    if (status === 'lost') {
      settledRequestIdRef.current = confirmation.id;
      return;
    }

    if (status === 'ready' && summary) {
      settledRequestIdRef.current = confirmation.id;
      toast.show({
        variant: 'success',
        label: formatAnimeFoldersConfirmation(summary.animesWithFolder),
      });
    }
  }, [confirmation, rootUri, status, summary, toast]);

  return { view, handleOpenDetail, handleReindex: reindex, handleChooseRoot };
}
