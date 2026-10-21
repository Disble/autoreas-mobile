import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import { AnimeCardCover } from '../../../src/features/animes/ui/AnimeCard/AnimeCardCover';

jest.mock('../../../src/components/cover-placeholder-scene', () => ({
  CoverPlaceholderScene: () => null,
}));

describe('AnimeCardCover', () => {
  it('follows the text column height instead of forcing a minimum on the card', () => {
    const { UNSAFE_getAllByType } = render(<AnimeCardCover coverUri={null} />);
    const column = UNSAFE_getAllByType(View)[0];

    // A minimum height would make a one-line card taller than its content and leave an empty strip
    // under the actions row; the column stretches to whatever height the text column sets.
    expect(column.props.className).not.toMatch(/min-h-/);
    expect(column.props.className).toContain('self-stretch');
    expect(column.props.className).toContain('w-24');
  });
});
