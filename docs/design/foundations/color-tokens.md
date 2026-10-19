# Color tokens

Components never name a color. They name a **semantic role** (`bg-surface`,
`text-muted`, `border-border`), and the role resolves to a value per mode. The app has
two modes, `light` and `dark`; both take their color values from the vendor theme
`heroui-native/styles`, and the app adds no color overrides of its own today.

> Back to the [design system overview](../README.md).

---

## How a role resolves

| Layer | What it provides | Where |
| --- | --- | --- |
| Base variable | The value for the mode, e.g. `--background`, `--accent`, `--surface` | `heroui-native/styles` → `variables.css`, under `@variant light` / `@variant dark` |
| Alias | The utility-facing name, e.g. `--color-background: var(--background)` | `heroui-native/styles` → `theme.css` |
| Derived roles | Values built from base roles, e.g. `--color-accent-soft`, `--color-danger-soft`, `--color-surface-hover` | `heroui-native/styles` → `theme.css` |
| App overrides | Optional per-mode overrides declared after the vendor import | `global.css` → `@layer theme` |

Today the app overrides only `--font-*` and `--radius` in `global.css`. Every color role
in both modes is therefore the vendor value. An override is added by declaring the base
variable (for example `--accent`) inside the matching `@variant` block — overriding
`--color-accent` directly bypasses the layer the rest of the system reads from.

## Role vocabulary the app consumes

| Group | Roles | Typical use |
| --- | --- | --- |
| Base | `background`, `foreground` | Screen background behind the app shell; default text |
| Surface | `surface`, `surface-secondary`, `surface-tertiary` and their `*-foreground` pairs | Cards, grouped sections, nested panels |
| Overlay | `overlay`, `overlay-foreground`, `backdrop` | Sheets, dialogs and what sits behind them |
| Text and chrome | `muted`, `border`, `separator`, `focus`, `link` | Secondary text, dividers, focus rings, links |
| Accent | `accent`, `accent-foreground` | Primary action and selection |
| Status | `success`, `warning`, `danger` and their `*-foreground` pairs | Inline feedback, alerts, destructive actions |
| Derived emphasis | `accent-soft`, `accent-soft-foreground`, `danger-soft`, `surface-hover` and siblings | Low-emphasis banners and pressed/hover states |

The vocabulary extends beyond this table with vendor roles the app does not reference
directly (`default-*`, `field-*`, `segment-*`, `background-secondary`, the `*-hover` and
`*-soft` families). HeroUI Native components may consume them internally; app code
should reach for a role from this table rather than inventing a hue.

Not color roles: `--radius`, the `--font-*` aliases and the shadow roles. They are real
tokens with their own owners.

## What is not documented or enforced yet

- The vendor's palette values are not restated here. They live in
  `node_modules/heroui-native/src/styles/variables.css` and can change with a package
  upgrade, so this page deliberately points at them instead of copying numbers.
- No check enforces "semantic role only". A component that writes `bg-white` or an
  inline literal passes today.
- No check reads, resolves or compares color values, and there is no contrast or
  perceptual requirement recorded anywhere in the repository.
- The derived families (`*-hover`, `*-soft`, `*-secondary`) are vendor formulas over the
  base roles. None of them have been reviewed as design decisions on this project.
- Roles the app never references — `field-*`, `segment-*`, `default-*` — are undocumented
  beyond the vendor source.

## Evidence boundary

- Statements here come from reading `global.css`, `metro.config.js` and the installed
  `heroui-native` style files. No rendering, screenshot, contrast measurement or device
  run was performed or is claimed.
- Font registration and weight choices are a separate typography concern; the `--font-*`
  aliases are listed here only to say they are not color roles.
- `themes/alpha.css` exists in the repository but is not imported by `global.css`. It is
  not an active mode and contributes no role values.
