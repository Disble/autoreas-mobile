import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo, useState } from 'react';
import { useAppTheme } from '../../../../contexts/app-theme-context';
import { useMutateAnime } from '../../use-mutate-anime';
import type {
  AnimeListScreenProps,
  AnimeListScreenViewModel,
} from './anime-list-screen.types';
import type { AnimeTab } from '../../anime.types';
import { useAnimeList } from '../../use-anime-list';
import { useIncrementalSyncHandler } from '../../../sync/use-incremental-sync-handler';
import { useWebSocket } from '../../../ws/use-websocket';

export function useAnimeListScreen(
  _props: AnimeListScreenProps,
): AnimeListScreenViewModel {
  // 1. Refs

  // 2. State
  const [tab, setTab] = useState<AnimeTab>('viendo');
  const [isMutatingAnimeById, setIsMutatingAnimeById] = useState<Record<string, boolean>>({});

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { isDark } = useAppTheme();
  const [themeColorForeground] = useThemeColor(['foreground']);
  const { handleSyncRequired } = useIncrementalSyncHandler();

  // 4. Queries/Mutations
  const { data: animes } = useAnimeList(tab);
  const { capPlus, capMinus } = useMutateAnime();

  // 5. Derived State (useMemo)
  const isEmpty = useMemo(() => animes.length === 0, [animes]);
  const settingsHref = useMemo(() => '/(tabs)/settings' as Href, []);

  // 6. Callbacks (useCallback calling pure helpers)
  const handleTabChange = useCallback((value: string) => {
    setTab(value as AnimeTab);
  }, []);

  const handleCapPlus = useCallback(
    async (animeId: string) => {
      if (isMutatingAnimeById[animeId]) {
        return;
      }

      setIsMutatingAnimeById((current) => ({
        ...current,
        [animeId]: true,
      }));

      try {
        await capPlus(animeId);
      } finally {
        setIsMutatingAnimeById((current) => {
          const nextState = { ...current };
          delete nextState[animeId];
          return nextState;
        });
      }
    },
    [capPlus, isMutatingAnimeById],
  );

  const handleCapMinus = useCallback(
    async (animeId: string) => {
      if (isMutatingAnimeById[animeId]) {
        return;
      }

      setIsMutatingAnimeById((current) => ({
        ...current,
        [animeId]: true,
      }));

      try {
        await capMinus(animeId);
      } finally {
        setIsMutatingAnimeById((current) => {
          const nextState = { ...current };
          delete nextState[animeId];
          return nextState;
        });
      }
    },
    [capMinus, isMutatingAnimeById],
  );

  const handleOpenSettings = useCallback(() => {
    router.push(settingsHref);
  }, [router, settingsHref]);

  // 7. Effects
  useWebSocket({ onSyncRequired: handleSyncRequired });

  return {
    animes,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    settingsHref,
    tab,
    themeColorForeground,
    handleCapMinus,
    handleCapPlus,
    handleOpenSettings,
    handleTabChange,
  };
}
