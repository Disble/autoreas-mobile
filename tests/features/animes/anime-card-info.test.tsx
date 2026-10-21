import { fireEvent, render } from '@testing-library/react-native';
import { AnimeCardInfo } from '../../../src/features/animes/ui/AnimeCard/AnimeCardInfo';
import type { AnimeCardInfoProps } from '../../../src/features/animes/ui/AnimeCard/anime-card.types';

/** Accessible label of the composed line, spoken as one string with the text separator. */
const META_LABEL = '1 capítulo visto · Viendo · Nota 3/6';

/** Builds the info column of an anime with a count, a state and a note. */
function buildProps(overrides: Partial<AnimeCardInfoProps> = {}): AnimeCardInfoProps {
  return {
    title: 'Ao Ashi Season 2nd',
    metaSegments: [
      { kind: 'count', text: '1 capítulo visto' },
      { kind: 'state', text: 'Viendo' },
      { kind: 'note', text: 'Nota 3/6' },
    ],
    metaLabel: META_LABEL,
    longEpisodeLabel: null,
    onToggleMeta: jest.fn(),
    ...overrides,
  };
}

describe('AnimeCardInfo meta line', () => {
  it('draws a round dot between segments and keeps the spoken label unchanged', () => {
    const { getByText, getByLabelText } = render(<AnimeCardInfo {...buildProps()} />);

    expect(getByText('1 capítulo visto • Viendo • Nota 3/6')).toBeTruthy();
    expect(getByLabelText(META_LABEL)).toBeTruthy();
  });

  it('never leads with a dot when only one segment is left', () => {
    const { getByText } = render(
      <AnimeCardInfo
        {...buildProps({ metaSegments: [{ kind: 'state', text: 'Viendo' }], metaLabel: 'Viendo' })}
      />,
    );

    expect(getByText('Viendo')).toBeTruthy();
  });

  it('draws the count in the reading role and the state and the note in muted', () => {
    const { getByText } = render(<AnimeCardInfo {...buildProps()} />);

    expect(getByText('1 capítulo visto').props.className).toContain('text-reading');
    expect(getByText('1 capítulo visto').props.className).toContain('text-[13px]');
    expect(getByText('• Viendo').props.className).toContain('text-muted');
    expect(getByText('• Nota 3/6').props.className).toContain('text-muted');
  });

  it('keeps the whole line as the remaining-episodes toggle and gives the note no press of its own', () => {
    const onToggleMeta = jest.fn();
    const { getByLabelText, getAllByRole } = render(
      <AnimeCardInfo {...buildProps({ onToggleMeta })} />,
    );

    fireEvent.press(getByLabelText(META_LABEL));

    expect(onToggleMeta).toHaveBeenCalledTimes(1);
    expect(getAllByRole('button')).toHaveLength(1);
  });
});
