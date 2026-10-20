import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guards the `secondary` role, the one colour the app declares that HeroUI Native does not ship.
 *
 * It exists for the draft note ring. `useThemeColor` only accepts the vendor's own colour names, so
 * this role is reachable in JavaScript through `useCSSVariable('--color-secondary')` and in classes
 * through the `@theme inline` alias asserted here. Both halves are needed: a variable without the
 * alias is invisible to Tailwind, and an alias without the variable resolves to nothing.
 */

/** Repository root of the checkout running this test. */
const REPO_ROOT = path.join(__dirname, '..', '..');

/** Reads `global.css` from the repository root. */
function readGlobalCss(): string {
  return readFileSync(path.join(REPO_ROOT, 'global.css'), 'utf8');
}

/** Returns the body of one `@variant <mode> { … }` block, or null when absent. */
function variantBlock(css: string, mode: string): string | null {
  const start = css.indexOf(`@variant ${mode} {`);

  if (start < 0) {
    return null;
  }

  let depth = 0;

  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
      continue;
    }

    if (css[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return css.slice(start, index + 1);
      }
    }
  }

  return null;
}

describe('secondary role', () => {
  it('declares a value for the light and the dark mode', () => {
    const css = readGlobalCss();

    for (const mode of ['light', 'dark']) {
      const block = variantBlock(css, mode);

      expect(block).not.toBeNull();
      expect(block).toMatch(/--secondary:\s*oklch\(/);
    }
  });

  it('gives the two modes different values so a mode switch is visible', () => {
    const css = readGlobalCss();
    const values = ['light', 'dark'].map((mode) => {
      const match = /--secondary:\s*([^;]+);/.exec(variantBlock(css, mode) ?? '');

      return match?.[1]?.trim() ?? '';
    });

    expect(values[0]).not.toBe('');
    expect(values[0]).not.toBe(values[1]);
  });

  it('exposes the Tailwind alias components and hooks resolve', () => {
    const css = readGlobalCss();

    expect(css).toMatch(/--color-secondary:\s*var\(--secondary\)/);
  });
});
