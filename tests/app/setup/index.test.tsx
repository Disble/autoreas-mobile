import { render } from '@testing-library/react-native';
import SetupScreen from '../../../src/app/setup/index';
import { SetupScreen as MockedSetupScreen } from '../../../src/features/setup/ui/SetupScreen';

jest.mock('../../../src/features/setup/ui/SetupScreen', () => ({
  SetupScreen: jest.fn(() => null),
}));

describe('setup route', () => {
  it('keeps src/app/setup as pure composition around the feature screen', () => {
    render(<SetupScreen />);

    expect(MockedSetupScreen).toHaveBeenCalledTimes(1);
    expect(MockedSetupScreen).toHaveBeenCalledWith({}, undefined);
  });
});
