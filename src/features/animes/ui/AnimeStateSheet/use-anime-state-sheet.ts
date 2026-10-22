import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo, useState } from 'react';
import {
  buildAnimeStateSheetOptions,
  buildAnimeStateSheetSessionKey,
} from './anime-state-sheet.helpers';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';

/**
 * Coordinates anime state sheet state and actions.
 * Tapping an option only moves a draft; the confirm action applies it. The draft is tied to the sheet
 * session, so closing without confirming, reopening, or switching anime always starts from the saved
 * state again.
 */
export function useAnimeStateSheet(props: AnimeStateSheetProps) {
  // 1. Refs
  // 2. State
  const sessionKey = buildAnimeStateSheetSessionKey(
    props.visible,
    props.animeTitle,
    props.currentEstado,
  );
  const [draft, setDraft] = useState({ sessionKey, estado: props.currentEstado });
  if (draft.sessionKey !== sessionKey) {
    setDraft({ sessionKey, estado: props.currentEstado });
  }

  // 3. Context/3rd Party Hooks
  const [checkColor] = useThemeColor(['accent']);

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const draftEstado = draft.sessionKey === sessionKey ? draft.estado : props.currentEstado;
  const options = useMemo(() => buildAnimeStateSheetOptions(draftEstado), [draftEstado]);

  // 6. Callbacks
  const handleSelect = useCallback(
    (estado: number) => {
      setDraft({ sessionKey, estado });
    },
    [sessionKey],
  );

  const handleConfirm = useCallback(() => {
    if (draftEstado !== props.currentEstado) {
      props.onSelect(draftEstado);
    }
    props.onClose();
  }, [draftEstado, props]);

  const handleClose = useCallback(() => {
    props.onClose();
  }, [props]);

  // 7. Effects

  return {
    isOpen: props.visible,
    animeTitle: props.animeTitle,
    options,
    checkColor,
    handleSelect,
    handleConfirm,
    handleClose,
  };
}
