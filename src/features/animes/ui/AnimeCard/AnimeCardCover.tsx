import { View } from 'react-native';
import { CoverPlaceholderScene } from '../../../../components/cover-placeholder-scene';
import { StyledImage } from './anime-card-cover.constants';
import type { AnimeCardCoverProps } from './anime-card.types';

/**
 * Renders the anime card cover interface: the offline cover image when a local
 * URI is available, otherwise the bridge's night-scene placeholder. Never reads
 * `anime.portada` and never falls back to a network URL, since the cover must stay offline-first.
 */
export function AnimeCardCover({ coverUri }: Readonly<AnimeCardCoverProps>) {
  if (coverUri) {
    return (
      <StyledImage
        source={coverUri}
        contentFit="cover"
        className="w-20 self-stretch rounded-l-3xl"
      />
    );
  }

  // The scene is absolutely positioned so it never contributes height: the card's text column
  // decides the row height, and the art crops to fill it (an in-flow 100%-height Svg stretched
  // the whole card).
  return (
    <View className="w-20 self-stretch overflow-hidden rounded-l-3xl">
      <View className="absolute inset-0">
        <CoverPlaceholderScene />
      </View>
    </View>
  );
}
