import { FOCUSED_TEST_GUARD_MESSAGE } from './focused-test-guard.constants';
import type { FocusedTestGuard } from './focused-test-guard.types';

/** Creates a Jest focused-test replacement that fails the suite before tests are filtered. */
function createFocusedGuard(name: string): FocusedTestGuard {
  return () => {
    throw new Error(`${name} is forbidden. ${FOCUSED_TEST_GUARD_MESSAGE}`);
  };
}

/** Preserves unsupported focused-test variants as explicit failures for consistent Jest behavior. */
// fallow-ignore-next-line complexity
function mirrorFocusedGuardVariants(
  guard: FocusedTestGuard,
  existing: unknown,
  name: string,
): void {
  if (typeof existing !== 'function') {
    return;
  }

  if (typeof Reflect.get(existing, 'each') === 'function') {
    Reflect.set(guard, 'each', createFocusedGuard(`${name}.each`));
  }

  const failing = Reflect.get(existing, 'failing');
  if (typeof failing !== 'function') {
    return;
  }

  const failingGuard = createFocusedGuard(`${name}.failing`);
  if (typeof Reflect.get(failing, 'each') === 'function') {
    Reflect.set(failingGuard, 'each', createFocusedGuard(`${name}.failing.each`));
  }

  Reflect.set(guard, 'failing', failingGuard);
}

/** Replaces a Jest API's focused alias while retaining its supported non-focused methods. */
function replaceFocusedOnly(owner: object | undefined, name: string): void {
  if (!owner) {
    return;
  }

  const existingOnly = Reflect.get(owner, 'only');
  if (typeof existingOnly !== 'function') {
    return;
  }

  const focusedGuard = createFocusedGuard(`${name}.only`);
  mirrorFocusedGuardVariants(focusedGuard, existingOnly, `${name}.only`);
  Reflect.set(owner, 'only', focusedGuard);
}

/** Installs guards for every supported Jest focused-test API. */
// fallow-ignore-next-line complexity
export function installFocusedTestGuard(): void {
  replaceFocusedOnly(globalThis.describe, 'describe');
  replaceFocusedOnly(globalThis.it, 'it');
  replaceFocusedOnly(globalThis.test, 'test');

  const testConcurrent = globalThis.test ? Reflect.get(globalThis.test, 'concurrent') : undefined;
  if (typeof testConcurrent === 'function') {
    replaceFocusedOnly(testConcurrent, 'test.concurrent');
  }

  const itConcurrent = globalThis.it ? Reflect.get(globalThis.it, 'concurrent') : undefined;
  if (typeof itConcurrent === 'function') {
    replaceFocusedOnly(itConcurrent, 'it.concurrent');
  }

  Reflect.set(globalThis, 'fdescribe', createFocusedGuard('fdescribe'));
  Reflect.set(globalThis, 'fit', createFocusedGuard('fit'));
}
