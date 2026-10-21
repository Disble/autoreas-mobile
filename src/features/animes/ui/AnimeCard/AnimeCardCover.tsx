import { View } from 'react-native';
import { CoverPlaceholderScene } from '../../../../components/cover-placeholder-scene';
import { StyledImage } from './anime-card-cover.constants';
import type { AnimeCardCoverProps } from './anime-card.types';

/**
 * Renders the anime card cover interface: the offline cover image when a local
 * URI is available, otherwise the bridge's night-scene placeholder. Never reads
 * `anime.portada` and never falls back to a network URL, since the cover must stay offline-first.
 *
 * The cover column is 96 wide and takes exactly the height the text column sets: it has no minimum,
 * because a minimum taller than a one-line card would leave an empty strip under the actions row and
 * break the card's 16 pt bottom edge. The image or placeholder fills the column with `cover`, so the
 * poster crops at its edges at any height. The card's own `overflow-hidden` rounds the corners.
 */
export function AnimeCardCover({ coverUri }: Readonly<AnimeCardCoverProps>) {
  return (
    <View className="w-24 self-stretch">
      {coverUri ? (
        <StyledImage source={coverUri} contentFit="cover" className="absolute inset-0" />
      ) : (
        <View className="absolute inset-0 overflow-hidden">
          <CoverPlaceholderScene />
        </View>
      )}
    </View>
  );
}
