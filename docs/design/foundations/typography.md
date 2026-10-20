# Typography

The app ships **one font family — Inter — in four faces**, and each face serves one weight role.
Each role has exactly **one name**: the face's **PostScript name**. That same string is used as the
`useFonts` registration key, as the `--font-*` value in `global.css`, and anywhere a native prop takes
a family name.

| Weight role | Utility it resolves | Family name (`useFonts` key = `--font-*` value) | Shipped file (under `node_modules/@expo-google-fonts/inter/`) |
| --- | --- | --- | --- |
| Regular 400 | `font-normal` | `Inter-Regular` | `400Regular/Inter_400Regular.ttf` |
| Medium 500 | `font-medium` | `Inter-Medium` | `500Medium/Inter_500Medium.ttf` |
| Semibold 600 | `font-semibold` | `Inter-SemiBold` | `600SemiBold/Inter_600SemiBold.ttf` |
| Bold 700 | `font-bold` | `Inter-Bold` | `700Bold/Inter_700Bold.ttf` |

Inter is the only family the app ships. The Saira, SNPro and SpaceGrotesk references disappeared
with the six removed themes; nothing in tracked source or CSS names them today.

> Back to the [design system overview](../README.md) · Color roles in [Color tokens](color-tokens.md).

---

## The rule

**One PostScript name per role, reused by every layer that needs a family name.**

| Layer | What it does with the name | Where |
| --- | --- | --- |
| Registration | `useFonts({ 'Inter-SemiBold': Inter_600SemiBold })` registers the face under that name | `src/features/startup/ui/StartupBoundary/use-startup-boundary.ts` |
| CSS slot | `--font-semibold: 'Inter-SemiBold'` makes the weight utility resolve that family | `global.css` |
| Native prop | `headerTitleStyle: { fontFamily: 'Inter-SemiBold' }` asks the platform for that family | `src/features/animes/ui/AnimeTabsLayout/use-anime-tabs-layout.ts` |

The stack header options are built in `use-anime-tabs-layout.ts` and rendered by the dumb
`AnimeTabsLayout.tsx`, so the family literal lives in the hook, not in the component: that is where
to look when a native family name needs to change.

Two near-misses stay rejected on purpose:

- `Inter_400Regular`, `Inter_600SemiBold` — the **JavaScript export names** of the vendor font
  package. They are not family names; see the platform evidence below for why using one as a key
  breaks the other two layers.
- `Saira`, `SNPro`, `SpaceGrotesk` — families no shipped file contains.

## Why one spelling, from the installed `expo-font`

`expo-font` does not turn the JavaScript key into the same family name on both platforms:

| Platform | Source read | What the key becomes |
| --- | --- | --- |
| Android | `node_modules/expo-font/android/src/main/java/expo/modules/font/FontLoaderModule.kt:56` — `ReactFontManager.getInstance().setTypeface(fontFamilyName, Typeface.NORMAL, typeface)` | the **family name itself** |
| iOS | `node_modules/expo-font/ios/FontLoaderModule.swift:40-42` — reads the font's `postScriptName`, then `FontFamilyAliasManager.setAlias(fontFamilyAlias, forFont: postScriptName)` | an **alias of the PostScript name** |

Consequence: **a registration key is not a family name, and the two spellings resolve on different
platforms.** With keys named `Inter_400Regular` and CSS slots named `Inter-Regular`, iOS still answers
both spellings (the PostScript name is the real family, the key only an alias), while Android answers
only the key — so the CSS slot and the native prop reach no registered face there. Registering each
face under its PostScript name makes the registration, the CSS slot and the native prop one string
that is correct on both platforms.

This is a naming contract read from package source. It is **not** a measured rendering result: no
device was run for it, and nothing here shows which face a device actually paints.

## Why all four roles are declared

Both layers below bind the *same four names*, which is why a partial set is not a smaller version of
this system but a different one:

| Layer | What it does | Where it is visible |
| --- | --- | --- |
| Uniwind | Declares `--font-normal`, `--font-medium`, `--font-semibold`, `--font-bold` as theme slots, so each weight class resolves a family | `node_modules/uniwind/uniwind.css` (`@theme`) |
| HeroUI Native | Its `Text` weight variants emit exactly `font-normal`, `font-medium`, `font-semibold`, `font-bold` | `node_modules/heroui-native/src/components/text/text.styles.ts` |

The vendor's font setup documentation (published by HeroUI Native, **not vendored in this repo**)
describes declaring **all four** roles when installing a custom font: an undeclared role keeps the
default family, so a partly declared set mixes Inter with a system face. That consequence is
documented vendor behaviour — **this repository did not measure it**.

## Where the fonts are loaded

`src/features/startup/ui/StartupBoundary/use-startup-boundary.ts` calls `useFonts` from
`@expo-google-fonts/inter` with the four PostScript names as keys and the vendor exports as values
(`'Inter-Regular': Inter_400Regular`, `'Inter-Medium': Inter_500Medium`,
`'Inter-SemiBold': Inter_600SemiBold`, `'Inter-Bold': Inter_700Bold`). Startup holds the route slot
until the faces report loaded, and it has a deadline plus a failure path for the case where they
never do.

The imported export names are the vendor's and stay unchanged: they are how a face is *loaded*, not
how it is *named* afterwards.

## Where the names are declared

`global.css` → `@layer theme { :root { @variant light … @variant dark … } }`. Both modes declare the
same four values today: no role changes family between light and dark. Overriding a role means
editing the matching `@variant` block, and the mechanism is otherwise the one described in
[Changing a token](../README.md#how-to-change-a-token).

## What the contract test proves

`tests/design/typography-contract.test.ts` parses the TTF `name` tables (nameID 6, Windows platform,
UTF-16BE) out of the four shipped files, the `useFonts({...})` keys out of the real startup hook, the
`--font-*` declarations out of the real `global.css`, and the `fontFamily: '<literal>'` of the real
tab layout. Then it reports:

- **proved:** every declared value is a PostScript name one of the shipped files carries; the hook
  registers exactly those four names, keeping the vendor export for each; every role is declared in
  **both** modes with the same value the hook registers; and the one native `fontFamily` literal is a
  registered name. The suite fails if a value is renamed to `Saira`, to a registration key such as
  `Inter_400Regular` or `Inter_600SemiBold`, if a role disappears from one mode, if a mode block is
  dropped entirely (an empty read cannot pass), or if the hook registers an export key again.
- **not proved:** which face renders, whether a fallback ever appears, how text looks at any size or
  text scale, whether `useFonts` succeeds on a device, and anything about light versus dark
  appearance. No rendering happens in the test.

## Evidence boundary

- Read for this page: the four TTF files, `global.css`, `use-startup-boundary.ts`,
  `use-anime-tabs-layout.ts`, the installed `expo-font` sources named above, and the installed
  `uniwind`/`heroui-native` sources named above. `themes/alpha.css` declares the same four Inter
  values but is **not imported**, so it is not an active typography source.
- The Android/iOS registration behaviour is **read from the installed package source**, not observed
  on a device or simulator. Nothing on this page proves which face renders, that no fallback is used,
  or that the header shows semi-bold Inter.
- Not done: no rendering, no fallback measurement, no contrast or text-scale check, no device or
  simulator run, no screenshot. Dynamic type, letter spacing and line height are separate, currently
  undocumented decisions.
