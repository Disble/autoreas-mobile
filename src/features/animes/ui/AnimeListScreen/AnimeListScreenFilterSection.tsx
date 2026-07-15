import { View } from 'react-native';
import { AnimeFilterRail } from '../AnimeFilterRail';
import type { AnimeListScreenFilterSectionProps } from './anime-list-screen.types';

/** Renders the responsive horizontal or vertical anime filter rail. */
export function AnimeListScreenFilterSection(
  props: Readonly<AnimeListScreenFilterSectionProps>,
) {
  const {
    filterOptions,
    filterCounts,
    selectedFilter,
    today,
    layoutMode,
    handleSelectedFilterChange,
  } = props;

  if (layoutMode === 'tablet-landscape') {
    return (
      <View className="bg-surface-secondary/40 border-border/40 w-60 border-r">
        <AnimeFilterRail
          options={filterOptions}
          counts={filterCounts}
          selected={selectedFilter}
          today={today}
          orientation="vertical"
          onSelect={handleSelectedFilterChange}
        />
      </View>
    );
  }

  return (
    <AnimeFilterRail
      options={filterOptions}
      counts={filterCounts}
      selected={selectedFilter}
      today={today}
      orientation="horizontal"
      onSelect={handleSelectedFilterChange}
    />
  );
}
