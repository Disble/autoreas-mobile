/**
 * Pure parsing helpers behind `tests/design/typography-contract.test.ts`.
 *
 * Both sides of the typography contract are read from bytes the repository actually ships, so the
 * test fails on drift instead of on a copied expectation:
 *
 * - family names come from the `name` table of the TTF files under
 *   `node_modules/@expo-google-fonts/inter/` (nameID 6, the PostScript name);
 * - registered names come from the `useFonts({...})` object of
 *   `src/features/startup/ui/StartupBoundary/use-startup-boundary.ts`;
 * - declared roles come from the `@variant light` and `@variant dark` blocks of `global.css`;
 * - native family names come from `fontFamily: '<value>'` literals of a component source file.
 *
 * One string has to serve all three places. `expo-font` registers a custom family under the JS key
 * on Android and aliases the key to the PostScript name on iOS, so a key that is not the PostScript
 * name produces two different family names per platform.
 *
 * This file deliberately declares only types and functions: the repository's `role-file-shape` rule
 * keeps values out of a `.helpers` file, so the small role/mode lists are exposed as functions
 * instead of exported constants.
 *
 * No function here renders a font, resolves a fallback family, or measures text. The contract and
 * its limits are documented in `docs/design/foundations/typography.md`.
 */
import { Buffer } from 'node:buffer';

/** One entry of a `useFonts({...})` object: the native family name and the export it registers. */
export interface FontRegistration {
  readonly key: string;
  readonly exportName: string;
}

/** A weight role that must resolve to one shipped face. */
export type FontRole = 'normal' | 'medium' | 'semibold' | 'bold';

/** A mode that must declare every weight role. */
export type FontMode = 'light' | 'dark';

/** Relative path (from the repository root) of one shipped Inter face. */
export interface ShippedFontFile {
  readonly role: FontRole;
  readonly path: string;
}

/** Declared family name per weight role, as found in one mode block. */
export type DeclaredFontRoles = Readonly<Partial<Record<FontRole, string>>>;

/** Everything the contract needs: `global.css` text plus the PostScript names the TTF files expose. */
export interface TypographyContractInput {
  readonly css: string;
  readonly postScriptNames: readonly string[];
}

/** Returns the four weight roles the app declares a family for, in registration-weight order. */
export function listFontRoles(): readonly FontRole[] {
  return ['normal', 'medium', 'semibold', 'bold'];
}

/** Returns the two modes whose `--font-*` declarations the contract covers. */
export function listFontModes(): readonly FontMode[] {
  return ['light', 'dark'];
}

/** Returns the four Inter faces the startup hook loads, each paired with the role it serves. */
export function listShippedFontFiles(): readonly ShippedFontFile[] {
  return [
    {
      role: 'normal',
      path: 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
    },
    {
      role: 'medium',
      path: 'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
    },
    {
      role: 'semibold',
      path: 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
    },
    {
      role: 'bold',
      path: 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
    },
  ];
}

/**
 * Returns true when `value` is one of the four roles the contract covers.
 */
function isFontRole(value: string): value is FontRole {
  return listFontRoles().includes(value as FontRole);
}

/**
 * Reads the `name` table's byte offset out of the sfnt table directory.
 *
 * Returns `null` when the file has no `name` table, which makes a caller fail with a message about
 * the file instead of with a stray out-of-range read.
 */
function findNameTableOffset(font: Buffer): number | null {
  // The sfnt header is: version (4 bytes), table count (2), three more 16-bit fields, then a
  // directory of 16-byte records that starts at byte 12.
  const tableCount = font.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    const tag = font.toString('ascii', recordOffset, recordOffset + 4);
    if (tag === 'name') {
      return font.readUInt32BE(recordOffset + 8);
    }
  }
  return null;
}

/**
 * Parses the PostScript name (nameID 6) out of a TrueType/OpenType `name` table.
 *
 * Only the Windows platform record is read: that is the record a PostScript name is required to
 * exist in, and it is the only encoding (UTF-16BE) this decoder handles. Throws when the file
 * carries no such record, so a renamed or mispackaged font cannot silently pass.
 */
export function parsePostScriptName(font: Buffer): string {
  const nameTableOffset = findNameTableOffset(font);
  if (nameTableOffset === null) {
    throw new Error('font file has no `name` table');
  }
  // A `name` table is: format (2), record count (2), storage offset (2), then 12-byte records whose
  // `offset` field is relative to the storage offset, not to the table.
  const recordCount = font.readUInt16BE(nameTableOffset + 2);
  const storageOffset = nameTableOffset + font.readUInt16BE(nameTableOffset + 4);
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = nameTableOffset + 6 + index * 12;
    const platformId = font.readUInt16BE(recordOffset);
    const nameId = font.readUInt16BE(recordOffset + 6);
    if (platformId !== 3 || nameId !== 6) {
      continue;
    }
    const length = font.readUInt16BE(recordOffset + 8);
    const stringOffset = storageOffset + font.readUInt16BE(recordOffset + 10);
    const utf16be = Buffer.from(font.subarray(stringOffset, stringOffset + length));
    return utf16be.swap16().toString('utf16le');
  }
  throw new Error('font file has no Windows platform PostScript name record (nameID 6)');
}

/**
 * Parses the keys of the `useFonts({...})` call out of a hook source file.
 *
 * Both forms the repository can use are read: the shorthand `Inter_400Regular` and the explicit
 * `'Inter-Regular': Inter_400Regular`. A quoted key is unquoted, and an entry that fits neither form
 * throws instead of being skipped, so a reformatted object fails loudly rather than passing empty.
 */
export function parseFontRegistrations(source: string): readonly FontRegistration[] {
  const callIndex = source.indexOf('useFonts({');
  if (callIndex === -1) {
    throw new Error('source has no `useFonts({` registration object');
  }
  const openIndex = source.indexOf('{', callIndex);
  const closeIndex = source.indexOf('}', openIndex);
  if (closeIndex === -1) {
    throw new Error('the `useFonts({` registration object is unterminated');
  }
  const entryPattern = /^(?:'([^']+)'|"([^"]+)"|([\w$]+))(?:\s*:\s*([\w$]+))?$/;
  const registrations: FontRegistration[] = [];
  for (const rawEntry of source.slice(openIndex + 1, closeIndex).split(',')) {
    const entry = rawEntry.trim();
    if (entry.length === 0) {
      continue;
    }
    const match = entryPattern.exec(entry);
    if (match === null) {
      throw new Error(`cannot parse font registration entry \`${entry}\``);
    }
    const [, quotedKey, doubleQuotedKey, bareKey, exportName] = match;
    const key = quotedKey ?? doubleQuotedKey ?? bareKey;
    registrations.push({ key, exportName: exportName ?? key });
  }
  return registrations;
}

/**
 * Lists every `fontFamily: '<value>'` string literal of a component source file.
 *
 * Only literals are read: a `fontFamily: someVariable` is not a family name this contract can check,
 * and nothing here resolves what a variable would hold at runtime.
 */
function parseNativeFontFamilyNames(source: string): readonly string[] {
  return [...source.matchAll(/fontFamily:\s*'([^']+)'/g)].map((match) => match[1]);
}

/**
 * Extracts the body of one `@variant <mode> { … }` block, brace-balanced.
 *
 * Returns `null` when the mode header or its opening brace is absent, and an unterminated block
 * yields the remainder of the file rather than a silent empty string.
 */
function readVariantBlock(css: string, mode: FontMode): string | null {
  const header = `@variant ${mode}`;
  const headerIndex = css.indexOf(header);
  if (headerIndex === -1) {
    return null;
  }
  const openIndex = css.indexOf('{', headerIndex + header.length);
  if (openIndex === -1) {
    return null;
  }
  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character !== '}') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return css.slice(openIndex + 1, index);
    }
  }
  return css.slice(openIndex + 1);
}

/**
 * Reads every `--font-<role>: '<value>'` declaration of every covered mode out of CSS text.
 *
 * A mode whose block is missing maps to `null` instead of an empty object, so the caller can tell
 * "no block at all" from "block that declares nothing".
 */
export function parseDeclaredFontRoles(
  css: string,
): Readonly<Record<FontMode, DeclaredFontRoles | null>> {
  // Quoted values only: an unquoted `--font-bold: 700` is a weight declaration, not a family, and
  // must not be read as one.
  const declarationPattern = /--font-([a-z-]+)\s*:\s*'([^']+)'/g;
  const parsed = {} as Record<FontMode, DeclaredFontRoles | null>;
  for (const mode of listFontModes()) {
    const block = readVariantBlock(css, mode);
    if (block === null) {
      parsed[mode] = null;
      continue;
    }
    const roles: Partial<Record<FontRole, string>> = {};
    for (const match of block.matchAll(declarationPattern)) {
      const [, rawRole, value] = match;
      if (isFontRole(rawRole)) {
        roles[rawRole] = value;
      }
    }
    parsed[mode] = roles;
  }
  return parsed;
}

/**
 * Lists every way the CSS drifts from the shipped font files. An empty list means the contract holds.
 *
 * Each violation is a full sentence naming the role, the mode and the offending value, so a failure
 * reads as an instruction and not as a diff. A family name that no shipped file exposes — `Saira`, or
 * the registration key `Inter_400Regular` — always produces one, and so does a missing role.
 */
export function findTypographyContractViolations(
  input: TypographyContractInput,
): readonly string[] {
  const { css, postScriptNames } = input;
  const violations: string[] = [];
  const declared = parseDeclaredFontRoles(css);
  for (const mode of listFontModes()) {
    const roles = declared[mode];
    if (roles === null) {
      violations.push(
        `global.css declares no \`@variant ${mode}\` block, so its --font-* roles cannot be checked`,
      );
      continue;
    }
    for (const role of listFontRoles()) {
      const value = roles[role];
      if (value === undefined) {
        violations.push(`global.css declares no \`--font-${role}\` in \`@variant ${mode}\``);
        continue;
      }
      if (!postScriptNames.includes(value)) {
        violations.push(
          `\`--font-${role}\` in \`@variant ${mode}\` names '${value}', which is not a PostScript name in the shipped Inter files (shipped: ${postScriptNames.join(', ')})`,
        );
      }
    }
  }
  return violations;
}

/**
 * Lists every way the `useFonts` registration drifts from the shipped PostScript names.
 *
 * A registration key that is not a shipped PostScript name is the defect this contract exists for: on
 * Android that key becomes the family name, so CSS and native props naming `Inter-Regular` reach no
 * registered face. A shipped name nobody registers is the mirror failure, and a duplicate key would
 * silently override the earlier face.
 */
export function findFontRegistrationViolations(input: {
  readonly registrations: readonly FontRegistration[];
  readonly postScriptNames: readonly string[];
}): readonly string[] {
  const { registrations, postScriptNames } = input;
  const violations: string[] = [];
  const registered = new Set<string>();
  for (const registration of registrations) {
    if (registered.has(registration.key)) {
      violations.push(`\`useFonts\` registers the family name '${registration.key}' more than once`);
    }
    registered.add(registration.key);
    if (!postScriptNames.includes(registration.key)) {
      violations.push(
        `\`useFonts\` registers '${registration.key}', which is not a PostScript name in the shipped Inter files (shipped: ${postScriptNames.join(', ')})`,
      );
    }
  }
  for (const postScriptName of postScriptNames) {
    if (!registered.has(postScriptName)) {
      violations.push(`\`useFonts\` does not register the shipped PostScript name '${postScriptName}'`);
    }
  }
  return violations;
}

/**
 * Lists every native `fontFamily` literal that is not one of the registered family names.
 *
 * A component that passes anything else asks the platform for a family nobody registered, which is
 * exactly how the header ended up naming a registration key instead of a family.
 */
export function findNativeFontFamilyViolations(input: {
  readonly source: string;
  readonly registeredKeys: readonly string[];
}): readonly string[] {
  const { source, registeredKeys } = input;
  const names = parseNativeFontFamilyNames(source);
  if (names.length === 0) {
    return ['no `fontFamily` string literal was found, so the native side cannot be checked'];
  }
  return names
    .filter((name) => !registeredKeys.includes(name))
    .map(
      (name) =>
        `\`fontFamily: '${name}'\` is not a registered family name (registered: ${registeredKeys.join(', ')})`,
    );
}
