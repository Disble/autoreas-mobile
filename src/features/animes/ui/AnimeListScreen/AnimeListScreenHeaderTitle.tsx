import { AppText } from '../../../../components/app-text';
import type { AnimeListScreenHeaderTitleProps } from './anime-list-screen.types';

/** Renders the bar title, truncated to the room between the fixed side columns. */
export function AnimeListScreenHeaderTitle({
  title,
  style,
}: Readonly<AnimeListScreenHeaderTitleProps>) {
  return (
    <AppText
      accessibilityRole="header"
      className="text-foreground text-[17px] font-semibold"
      numberOfLines={1}
      style={style}
    >
      {title}
    </AppText>
  );
}
