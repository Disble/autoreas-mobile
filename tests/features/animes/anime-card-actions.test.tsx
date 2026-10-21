import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AnimeCardActions } from '../../../src/features/animes/ui/AnimeCard/AnimeCardActions';
import type { AnimeCardActionsProps } from '../../../src/features/animes/ui/AnimeCard/anime-card.types';

/** Props the mocked button primitives accept. */
interface MockButtonProps {
  readonly children?: ReactNode;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
}

/** Props the mocked icon records for each render. */
interface MockIconProps {
  readonly name: string;
  readonly size: number;
}

/** The part of a rendered JSON node the group walk reads. */
interface RenderedNode {
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (RenderedNode | string)[] | null;
}

/** Every icon the mocked `Ionicons` drew in the current test, in drawing order. */
const mockIconCalls: MockIconProps[] = [];

jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: MockIconProps) => {
    mockIconCalls.push({ name: props.name, size: props.size });
    return null;
  },
}));

/** `Button` reads animation settings from the library provider, so it passes its children through. */
jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('heroui-native');
  const Button = Object.assign(
    ({ children, accessibilityLabel, onPress }: MockButtonProps) =>
      React.createElement(RN.Pressable, { accessibilityLabel, onPress }, children),
    { Label: ({ children }: MockButtonProps) => React.createElement(RN.Text, null, children) },
  );

  return { ...actual, Button };
});

/** Accessibility label of the page shortcut. */
const PAGE = 'Abrir página del anime';
/** Accessibility label of the folder shortcut. */
const FOLDER = 'Abrir carpeta del anime';
/** Accessibility label of the note star. */
const STAR = 'Abrir la calificación de la nota';
/** Accessibility label of the decrease button. */
const MINUS = 'Restar un capítulo visto';
/** Accessibility label of the increase button. */
const PLUS = 'Sumar un capítulo visto';
/** Accessibility label of the `Reanudar` button. */
const RESUME = 'Reanudar anime';

/** Builds the props of an unlocked anime with a page, a folder and a note to give. */
function buildProps(overrides: Partial<AnimeCardActionsProps> = {}): AnimeCardActionsProps {
  return {
    seasonStatus: { showRatingCta: true } as AnimeCardActionsProps['seasonStatus'],
    isMutationLocked: false,
    disableDecrease: false,
    disableIncrease: false,
    onOpenSeasonRatingSheet: jest.fn(),
    hasPageLink: true,
    hasFolder: true,
    onOpenPage: jest.fn(),
    onOpenFolder: jest.fn(),
    onReanudarPress: jest.fn(),
    onCapMinusPress: jest.fn(),
    onCapPlusPress: jest.fn(),
    onCapMinusLongPress: jest.fn(),
    onCapPlusLongPress: jest.fn(),
    ...overrides,
  };
}

/** Collects every accessibility label inside a rendered subtree, in drawing order. */
function collectLabels(node: RenderedNode | string): string[] {
  if (typeof node === 'string') {
    return [];
  }
  const own = typeof node.props.accessibilityLabel === 'string' ? [node.props.accessibilityLabel] : [];
  return [...own, ...(node.children ?? []).flatMap(collectLabels)];
}

/** Renders the row and returns the labels of each top-level group, skipping label-less spacers. */
function renderGroups(props: AnimeCardActionsProps) {
  const screen = render(<AnimeCardActions {...props} />);
  const root = screen.toJSON() as RenderedNode;
  const groups = (root.children ?? [])
    .map(collectLabels)
    .filter((labels) => labels.length > 0);

  return { ...screen, groups };
}

beforeEach(() => {
  mockIconCalls.length = 0;
});

describe('AnimeCardActions', () => {
  it('groups the page, folder and star on the left and the stepper on the right', () => {
    const { groups } = renderGroups(buildProps());

    expect(groups).toEqual([[PAGE, FOLDER, STAR], [MINUS, PLUS]]);
  });

  it('draws no chapter number between the stepper buttons', () => {
    // The count used to arrive as a prop; it is passed anyway so a row that draws it again fails here.
    const legacyCount: object = { nrocapvisto: 7 };
    const { queryByText } = render(<AnimeCardActions {...buildProps()} {...legacyCount} />);

    expect(queryByText(/\d/)).toBeNull();
  });

  it('hides the star when the anime has no note to give', () => {
    const { groups } = renderGroups(buildProps({ seasonStatus: null }));

    expect(groups).toEqual([[PAGE, FOLDER], [MINUS, PLUS]]);
  });

  it('replaces the stepper with Reanudar when the anime is locked', () => {
    const { groups, getByText } = renderGroups(buildProps({ isMutationLocked: true }));

    expect(groups).toEqual([[PAGE, FOLDER, STAR], [RESUME]]);
    expect(getByText('Reanudar')).toBeTruthy();
  });

  it('draws every row icon at 20 pt in its outline variant', () => {
    render(<AnimeCardActions {...buildProps()} />);

    expect(mockIconCalls).toEqual([
      { name: 'link-outline', size: 20 },
      { name: 'folder-outline', size: 20 },
      { name: 'star-outline', size: 20 },
      { name: 'remove-outline', size: 20 },
      { name: 'add-outline', size: 20 },
    ]);
  });
});
