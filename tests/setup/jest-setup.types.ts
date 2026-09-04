import type { ReactNode } from 'react';

/**
 * Prop shape for the mocked Switch primitive.
 *
 * Declared as a NAMED type rather than an inline `as` assertion inside the mock factory on
 * purpose: babel-plugin-jest-hoist scans the factory body for out-of-scope identifiers and
 * flags the parameter name inside an inline function-type assertion, which fails every suite.
 * An imported type is erased before that scan, so this is the shape that actually compiles.
 */
export type MockSwitchProps = MockPrimitiveProps & {
  readonly isSelected?: boolean;
  readonly onSelectedChange?: (nextSelected: boolean) => void;
};

/** Defines the shared permissive prop shape used by Jest UI primitive mocks. */
export type MockPrimitiveProps = {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly isDisabled?: boolean;
  readonly isLoading?: boolean;
  readonly testID?: string;
  readonly [property: string]: unknown;
};
