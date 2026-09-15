import { View } from 'react-native';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { StyledImage } from './anime-card-cover.constants';
import type { AnimeCardCoverProps } from './anime-card.types';

/**
 * Renders the anime card cover interface: the offline cover image when a local
 * URI is available, otherwise a placeholder icon. Never reads `anime.portada`
 * and never falls back to a network URL, since the cover must stay offline-first.
 */
export function AnimeCardCover({ coverUri }: Readonly<AnimeCardCoverProps>) {
  if (coverUri) {
    return (
      <StyledImage
        source={coverUri}
        contentFit="cover"
        className="w-16 self-stretch rounded-l-3xl"
      />
    );
  }

  return (
    <View className="bg-surface-tertiary w-16 items-center justify-center self-stretch rounded-l-3xl">
      <StyledIonicons className="text-muted" name="image-outline" size={24} />
    </View>
  );
}
