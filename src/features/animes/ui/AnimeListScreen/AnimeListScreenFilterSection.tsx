import { View } from 'react-native';
import { AnimeFilterRail } from '../AnimeFilterRail';
import type { AnimeListScreenFilterSectionProps } from './anime-list-screen.types';

/**
 * Renders the responsive filter rail: on a tablet in landscape, a floating panel with the card's
 * radius, surface and 16 pt margin; otherwise the phone's horizontal chip rail.
 */
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
      <View className="bg-surface mb-4 ml-4 mt-1 w-60 overflow-hidden rounded-3xl" testID="anime-filter-panel">
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
