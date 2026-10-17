import { View } from 'react-native';
import { CoverPlaceholderScene } from '../../../../components/cover-placeholder-scene';
import { StyledImage } from './anime-card-cover.constants';
import type { AnimeCardCoverProps } from './anime-card.types';

/**
 * Renders the anime card cover interface: the offline cover image when a local
 * URI is available, otherwise the bridge's night-scene placeholder. Never reads
 * `anime.portada` and never falls back to a network URL, since the cover must stay offline-first.
 *
 * The cover is a fixed 2:3 poster (96x144) pinned to the top, filled with `cover` so it never
 * shows bars. Its column stretches with the card and sets the card's minimum height, so a taller
 * text column grows the card below the poster instead of stretching and cropping it. The card's
 * own `overflow-hidden` rounds the corners.
 */
export function AnimeCardCover({ coverUri }: Readonly<AnimeCardCoverProps>) {
  return (
    <View className="min-h-36 w-24 self-stretch">
      {coverUri ? (
        <StyledImage source={coverUri} contentFit="cover" className="h-36 w-24" />
      ) : (
        <View className="h-36 w-24 overflow-hidden">
          <CoverPlaceholderScene />
        </View>
      )}
    </View>
  );
}
