import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenStallProbe } from '../../../../src/features/screen-health';
import { useScreenStallProbe } from '../../../../src/features/screen-health/ui/ScreenStallProbe/use-screen-stall-probe';

jest.mock('../../../../src/features/screen-health/ui/ScreenStallProbe/use-screen-stall-probe', () => ({
  useScreenStallProbe: jest.fn(),
}));

/** The mocked probe hook. */
const useScreenStallProbeMock = useScreenStallProbe as jest.Mock;

/** Records the touches the wrapper forwards. */
const handleTouchStart = jest.fn();
/** Records the probe view layouts. */
const handleProbeLayout = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useScreenStallProbeMock.mockReturnValue({ probeKey: 0, handleTouchStart, handleProbeLayout });
});

describe('ScreenStallProbe', () => {
  it('renders the app it wraps', () => {
    render(
      <ScreenStallProbe>
        <Text>app content</Text>
      </ScreenStallProbe>,
    );

    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('sees a touch that bubbles up from the app', () => {
    render(
      <ScreenStallProbe>
        <Text>app content</Text>
      </ScreenStallProbe>,
    );

    fireEvent(screen.getByText('app content'), 'touchStart');

    expect(handleTouchStart).toHaveBeenCalledTimes(1);
  });

  it('settles the probe on the probe view layout and never takes touches itself', () => {
    render(<ScreenStallProbe />);
    const probe = screen.getByTestId('screen-stall-probe');

    fireEvent(probe, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1, height: 1 } } });

    expect(handleProbeLayout).toHaveBeenCalledTimes(1);
    expect(probe.props.pointerEvents).toBe('none');
  });
});
