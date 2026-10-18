import { View } from 'react-native';
import { CoverPlaceholderScene } from '../../../../components/cover-placeholder-scene';
import { StyledImage } from './anime-card-cover.constants';
import type { AnimeCardCoverProps } from './anime-card.types';

/**
 * Renders the anime card cover interface: the offline cover image when a local
 * URI is available, otherwise the bridge's night-scene placeholder. Never reads
 * `anime.portada` and never falls back to a network URL, since the cover must stay offline-first.
 *
 * The cover column is 96 wide, at least 144 tall (a 2:3 poster), and stretches with the card. The
 * image or placeholder fills the whole column with `cover`, so a taller text column (season status
 * row, long title) crops the poster's edges instead of leaving an empty strip under it. The card's
 * own `overflow-hidden` rounds the corners.
 */
export function AnimeCardCover({ coverUri }: Readonly<AnimeCardCoverProps>) {
  return (
    <View className="min-h-36 w-24 self-stretch">
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
