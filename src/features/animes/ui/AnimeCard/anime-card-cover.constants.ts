import { Image } from 'expo-image';
import { withUniwind } from 'uniwind';

/**
 * Provides the Uniwind-enabled expo-image component used by the anime card cover.
 * Kept in its own file so `anime-card.helpers.ts` and `use-anime-card.ts` (and their
 * Jest suites) never transitively import expo-image.
 */
export const StyledImage = withUniwind(Image);
