/**
 * Executable typography contract for the design system
 * (`docs/design/foundations/typography.md`).
 *
 * The app binds four weight roles to four Inter faces in `global.css`. That binding only holds if
 * each `--font-*` value is a family name that really exists inside a shipped font file. History of
 * this repository shows the two ways it drifts: a family nobody ships (`Saira`, `SNPro`,
 * `SpaceGrotesk` came from the deleted themes) and a `useFonts` registration key used as a family
 * (`Inter_400Regular`, which is a registration key, not a PostScript name).
 *
 * The registration side is checked too, and it is the reason this contract is not cosmetic:
 * `expo-font` registers a custom family under the JS key on Android and aliases that key to the
 * PostScript name on iOS. With keys like `Inter_400Regular` and CSS values like `Inter-Regular`, no
 * single string is a valid family everywhere, so the hook registers each face under its PostScript
 * name and the CSS slots reuse it.
 *
 * These assertions read the real bytes: the PostScript names are parsed out of the TTF `name`
 * tables under `node_modules/@expo-google-fonts/inter/`, the declarations come from the real
 * `global.css`, the registered keys come from the real startup hook, and the header family name
 * comes from the real tab layout. The negative cases at the bottom are in-memory literals, so the
 * guard is exercised on every run instead of only once, when it was written.
 *
 * What this proves: the checked-in CSS names only families the checked-in font files expose, the
 * hook registers those same four names, every weight role is declared in both modes, and the one
 * native `fontFamily` literal is a registered name.
 *
 * What this does not prove: which face actually renders, whether a fallback appears, how text looks
 * at any scale or on any device, or that `useFonts` succeeded at runtime. Nothing here renders.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  findFontRegistrationViolations,
  findNativeFontFamilyViolations,
  findTypographyContractViolations,
  listFontModes,
  listFontRoles,
  listShippedFontFiles,
  parseDeclaredFontRoles,
  parseFontRegistrations,
  parsePostScriptName,
  type FontMode,
  type FontRegistration,
  type FontRole,
} from './typography-contract.helpers';

/** The real `global.css`, read once for every assertion in this file. */
const GLOBAL_CSS = readFileSync(path.resolve(__dirname, '../../global.css'), 'utf8');

/** The four weight roles the contract covers, in the order the vendor documents them. */
const FONT_ROLES: readonly FontRole[] = listFontRoles();

/** The two modes whose `--font-*` declarations the contract covers. */
const FONT_MODES: readonly FontMode[] = listFontModes();

/** The four Inter faces the startup hook loads, each paired with the weight role it serves. */
const SHIPPED_FONT_FILES = listShippedFontFiles();

/** PostScript name each shipped face is expected to carry, per weight role. */
const EXPECTED_POST_SCRIPT_NAMES: Readonly<Record<FontRole, string>> = {
  normal: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
};

/** PostScript names parsed out of the four shipped TTF files, in role order. */
const SHIPPED_POST_SCRIPT_NAMES: readonly string[] = SHIPPED_FONT_FILES.map((fontFile) =>
  parsePostScriptName(readFileSync(path.resolve(__dirname, '../..', fontFile.path))),
);

/** The real startup hook, whose `useFonts({...})` object is the registration side of the contract. */
const STARTUP_BOUNDARY_SOURCE = readFileSync(
  path.resolve(__dirname, '../../src/features/startup/ui/StartupBoundary/use-startup-boundary.ts'),
  'utf8',
);

/** The real tab layout hook, the one place that hands a family name to a native header style. */
const ANIME_TABS_LAYOUT_SOURCE = readFileSync(
  path.resolve(__dirname, '../../src/features/animes/ui/AnimeTabsLayout/use-anime-tabs-layout.ts'),
  'utf8',
);

/** Registrations read from the real `useFonts` call, in the order the hook declares them. */
const FONT_REGISTRATIONS: readonly FontRegistration[] =
  parseFontRegistrations(STARTUP_BOUNDARY_SOURCE);

/** A `useFonts` object shaped like the historical defect: export keys used as family names. */
const REGISTRATION_KEY_SOURCE = [
  'const [fontsLoaded] = useFonts({',
  '  Inter_400Regular,',
  '  Inter_500Medium,',
  '  Inter_600SemiBold,',
  '  Inter_700Bold,',
  '});',
].join('\n');

/** A header style that passes a registration key instead of a registered family name. */
const REGISTRATION_KEY_HEADER_SOURCE = "headerTitleStyle: { fontFamily: 'Inter_600SemiBold' },";

/**
 * Rewrites every `--font-<role>` declaration of the real CSS, so a negative case keeps every other
 * line of the file exactly as shipped and both modes carry the forged family name.
 */
function replaceDeclaredRole(role: FontRole, value: string): string {
  const declaration = new RegExp(`--font-${role}: '[^']+'`, 'g');
  return GLOBAL_CSS.replace(declaration, `--font-${role}: '${value}'`);
}

/** Reports the violations of a contract check as one readable string, for failure messages. */
function formatViolations(violations: readonly string[]): string {
  return violations.length === 0 ? '(none)' : violations.join('\n');
}

describe('shipped Inter faces', () => {
  it('exposes the four PostScript names the CSS is expected to declare', () => {
    expect(SHIPPED_POST_SCRIPT_NAMES).toEqual([
      EXPECTED_POST_SCRIPT_NAMES.normal,
      EXPECTED_POST_SCRIPT_NAMES.medium,
      EXPECTED_POST_SCRIPT_NAMES.semibold,
      EXPECTED_POST_SCRIPT_NAMES.bold,
    ]);
  });

  it('carries one face per weight role, with no role left unshipped', () => {
    expect(SHIPPED_FONT_FILES.map((fontFile) => fontFile.role)).toEqual([...FONT_ROLES]);
  });
});

describe('global.css typography contract', () => {
  it('declares every weight role in both modes, each naming a shipped PostScript name', () => {
    const violations = findTypographyContractViolations({
      css: GLOBAL_CSS,
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(formatViolations(violations)).toBe('(none)');
  });

  it('binds each role to its shipped face in both modes', () => {
    const declared = parseDeclaredFontRoles(GLOBAL_CSS);

    for (const mode of FONT_MODES) {
      expect(declared[mode]).toEqual({
        normal: EXPECTED_POST_SCRIPT_NAMES.normal,
        medium: EXPECTED_POST_SCRIPT_NAMES.medium,
        semibold: EXPECTED_POST_SCRIPT_NAMES.semibold,
        bold: EXPECTED_POST_SCRIPT_NAMES.bold,
      });
    }
  });
});

describe('useFonts registration contract', () => {
  it('registers each shipped face under its PostScript name', () => {
    expect(FONT_REGISTRATIONS.map((registration) => registration.key)).toEqual([
      ...SHIPPED_POST_SCRIPT_NAMES,
    ]);
  });

  it('keeps the vendor export each registered face loads', () => {
    const exportNames = FONT_REGISTRATIONS.map((registration) => registration.exportName);
    const vendorExports = SHIPPED_FONT_FILES.map((fontFile) => path.basename(fontFile.path, '.ttf'));

    expect(exportNames).toEqual(vendorExports);
  });

  it('reports no registration drift', () => {
    const violations = findFontRegistrationViolations({
      registrations: FONT_REGISTRATIONS,
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(formatViolations(violations)).toBe('(none)');
  });

  it('binds each CSS role to the family name the hook registers for it', () => {
    const declared = parseDeclaredFontRoles(GLOBAL_CSS);
    const registeredByRole = new Map(
      FONT_REGISTRATIONS.map((registration, index) => [FONT_ROLES[index], registration.key]),
    );

    for (const mode of FONT_MODES) {
      for (const role of FONT_ROLES) {
        expect(declared[mode]?.[role]).toBe(registeredByRole.get(role));
      }
    }
  });

  it('passes only registered family names to native font props', () => {
    const violations = findNativeFontFamilyViolations({
      source: ANIME_TABS_LAYOUT_SOURCE,
      registeredKeys: FONT_REGISTRATIONS.map((registration) => registration.key),
    });

    expect(formatViolations(violations)).toBe('(none)');
  });
});

describe('typography contract rejects registration drift', () => {
  it('rejects export keys used as registration keys', () => {
    const violations = findFontRegistrationViolations({
      registrations: parseFontRegistrations(REGISTRATION_KEY_SOURCE),
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toHaveLength(SHIPPED_POST_SCRIPT_NAMES.length * 2);
    expect(violations.join('\n')).toContain(
      "`useFonts` registers 'Inter_400Regular', which is not a PostScript name",
    );
    expect(violations.join('\n')).toContain(
      "`useFonts` does not register the shipped PostScript name 'Inter-Regular'",
    );
  });

  it('rejects a native font prop naming an unregistered family', () => {
    const violations = findNativeFontFamilyViolations({
      source: REGISTRATION_KEY_HEADER_SOURCE,
      registeredKeys: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toEqual([
      "`fontFamily: 'Inter_600SemiBold'` is not a registered family name (registered: Inter-Regular, Inter-Medium, Inter-SemiBold, Inter-Bold)",
    ]);
  });
});

describe('typography contract rejects drift', () => {
  it('rejects a family name that no shipped font file exposes', () => {
    const violations = findTypographyContractViolations({
      css: replaceDeclaredRole('semibold', 'Saira'),
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toHaveLength(FONT_MODES.length);
    for (const mode of FONT_MODES) {
      expect(violations.join('\n')).toContain(
        `\`--font-semibold\` in \`@variant ${mode}\` names 'Saira', which is not a PostScript name`,
      );
    }
  });

  it('rejects a useFonts registration key used as a family name', () => {
    const violations = findTypographyContractViolations({
      css: replaceDeclaredRole('normal', 'Inter_400Regular'),
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toHaveLength(FONT_MODES.length);
    expect(violations.join('\n')).toContain("names 'Inter_400Regular'");
    expect(violations.join('\n')).toContain('shipped: Inter-Regular, Inter-Medium');
    expect(violations.join('\n')).not.toContain('Inter_400Regular, ');
  });

  it('rejects a mode that stops declaring one weight role', () => {
    // A plain string replacement rewrites only the first match, so `light` loses the role and
    // `dark` keeps it: the check has to be per mode, not per file.
    const cssWithoutLightBold = GLOBAL_CSS.replace("--font-bold: 'Inter-Bold';", '');
    const violations = findTypographyContractViolations({
      css: cssWithoutLightBold,
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toEqual([
      'global.css declares no `--font-bold` in `@variant light`',
    ]);
  });

  it('rejects CSS with no mode block at all instead of passing on an empty read', () => {
    const violations = findTypographyContractViolations({
      css: ':root { --radius: 0.33rem; }',
      postScriptNames: SHIPPED_POST_SCRIPT_NAMES,
    });

    expect(violations).toEqual(
      FONT_MODES.map(
        (mode) =>
          `global.css declares no \`@variant ${mode}\` block, so its --font-* roles cannot be checked`,
      ),
    );
  });
});
