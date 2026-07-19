import React from 'react';
import { render } from '@testing-library/react-native';
import { SyncRuntimeGate } from '../../../../src/features/sync/ui/SyncRuntimeGate/SyncRuntimeGate';

jest.mock('../../../../src/features/sync/use-sync-runtime', () => ({
  useSyncRuntime: jest.fn(),
}));

describe('SyncRuntimeGate', () => {
  it('keeps rendering the app shell children while the runtime is mounted', () => {
    // Renders a bare string child (no host `<Text>` wrapper), so `getByText`
    // can't traverse it — assert on the render tree instead.
    const { toJSON } = render(
      <SyncRuntimeGate isBootstrapped>
        <>App shell</>
      </SyncRuntimeGate>,
    );

    expect(toJSON()).toBe('App shell');
  });
});
