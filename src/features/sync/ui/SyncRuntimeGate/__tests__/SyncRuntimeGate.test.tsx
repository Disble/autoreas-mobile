import React from 'react';
import { render } from '@testing-library/react-native';
import { SyncRuntimeGate } from '../SyncRuntimeGate';

describe('SyncRuntimeGate', () => {
  it('keeps rendering the app shell children while the runtime is mounted', () => {
    const { getByText } = render(
      <SyncRuntimeGate isBootstrapped>
        <>App shell</>
      </SyncRuntimeGate>,
    );

    expect(getByText('App shell')).toBeTruthy();
  });
});
