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

  it('draws the count at 13 pt in the reading role and the state and the note at 11 pt in muted', () => {
    const { getByText } = render(<AnimeCardInfo {...buildProps()} />);
    const count = getByText('1 capítulo visto').props.className;
    const state = getByText('• Viendo').props.className;
    const note = getByText('• Nota 3/6').props.className;

    expect(count).toEqual(expect.stringContaining('text-[13px]'));
    expect(count).toEqual(expect.stringContaining('text-reading'));
    for (const detail of [state, note]) {
      expect(detail).toEqual(expect.stringContaining('text-[11px]'));
      expect(detail).toEqual(expect.stringContaining('text-muted'));
    }
    for (const span of [count, state, note]) {
      expect(span).toEqual(expect.stringContaining('font-normal'));
    }
  });

  it('keeps the meta line in the title group: 4 pt below the title and no slop past the actions gap', () => {
    const { getByLabelText } = render(<AnimeCardInfo {...buildProps()} />);

    const toggle = getByLabelText(META_LABEL);
    const { bottom } = toggle.props.hitSlop as { bottom: number };

    expect(toggle.props.className).toContain('mt-1');
    // The actions row starts 12 pt below (`gap-3`), so the slop must stop at its edge.
    expect(bottom).toBeLessThanOrEqual(12);
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
