import type { ReactNode } from 'react';

/** Defines the shared permissive prop shape used by Jest UI primitive mocks. */
export type MockPrimitiveProps = {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly isDisabled?: boolean;
  readonly isLoading?: boolean;
  readonly testID?: string;
  readonly [property: string]: unknown;
};
