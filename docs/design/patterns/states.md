# Loading, empty and error states

**Answer:** the startup boundary renders three blocking screens (loading, SQLite unavailable,
failure/recovery) and the loading one gains a slow-start notice after 8 s. Inside the app there
is one list empty state, one shared sync-status model rendered as a banner and as a settings
card, and three feedback styles for failed actions (danger toast, inline danger alert, alert
inside a sheet). It has **no skeleton component, no `ActivityIndicator`, no React error
boundary and no first-load spinner** for the anime list. Each row below is the real component
and the real trigger.

> Back to the [design system README](../README.md) · [Primitives](../components/heroui-native.md) ·
> [AppText](../components/app-text.md).

## Blocking states (before any route renders)

| State | Trigger | Real component | Citation |
| --- | --- | --- | --- |
| Loading placeholder | `rootContent` suspends while the local database prepares | `StartupBoundaryLoading` | `src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:414` |
| "Taking longer than expected" | 8 s soft deadline after fonts and the SQLite provider are ready and startup is still not ready | same component, `isTakingLongerThanExpected` | `src/features/startup/ui/StartupBoundary/use-startup-slow-notice.ts:32`, `src/features/startup/startup.constants.ts:63` |
| SQLite unavailable | `!hasSQLiteProvider` resolves the screen as `sqlite-unavailable` | `SQLiteUnavailableScreen` | `src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:257` → `:304` |
| Startup failure / recovery | a `startupFailure` exists; recovery presentation attached when available, generic card otherwise | `StartupBoundaryFallback` | `src/features/startup/ui/StartupBoundary/startup-boundary.helpers.ts:309` |

The loading card is `Card` + `Card.Body` + `Spinner` + `Typography.Heading`/`Paragraph`, and
the slow notice is a third paragraph inside the same card
(`src/features/startup/ui/StartupBoundary/StartupBoundaryLoading.tsx:16`). The failure card
stacks `Alert status="danger"` for the diagnosis, `Alert status="warning"` for the recovery
hint, and only the actions the recovery layer authorised
(`src/features/startup/ui/StartupBoundary/StartupBoundaryFallback.tsx:19`).

## In-flow states

| State | Trigger | Real component | Citation |
| --- | --- | --- | --- |
| Empty anime list | `animes.length === 0` | `AnimeEmptyState` | `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:91` → `src/features/animes/ui/AnimeListScreen/AnimeListScreenContent.tsx:40` |
| Sync status (list) | `deriveVisibleSyncStatus(facts, now)` from connection status, pending ops and last sync | `AnimeListScreenStatusSection` | `src/features/sync/sync-visible-status.helpers.ts:219` → `src/features/animes/ui/AnimeListScreen/AnimeListScreenStatusSection.tsx:28` |
| Sync status (settings) | the same shared status, plus icon, meta line and one action | `SettingsStatusCard` | `src/features/settings/ui/SettingsScreen/settings-sync-status.helpers.ts:99` → `src/features/settings/ui/SettingsScreen/SettingsStatusCard.tsx:44` |
| Rating submit status | sheet status `pending` / `failed` | `SheetStatusAlert`, `warning` for failed, `accent` otherwise | `src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:79` |
| Background sync issue | one entry per issue in the background status | coloured row inside `SettingsBackgroundCard` (not an `Alert`) | `src/features/settings/ui/SettingsScreen/SettingsBackgroundCard.tsx:17` |
| Folder hint / folder lost | folder banner kind `hint` / `lost` | `AnimeFolderBanner` (`Alert status="accent"` / `status="danger"`) | `src/features/anime-folders/ui/AnimeFolderBanner/AnimeFolderBanner.tsx:41`, `:23` |

The sync status is the one deliberately shared pattern: tone `success` for "up to date",
`accent` while syncing, `default` while waiting or offline, `warning` only for a backlog stale
for the configured number of hours, `danger` only when the Bridge answered and rejected the
sync (`src/features/sync/sync-visible-status.helpers.ts:228`, `:241`, `:251`, and the ladder
note at `:216`).

## Feedback for a failed action

| Style | Used for | Citation |
| --- | --- | --- |
| `toast.show({ variant: 'danger' })` | a chapter mutation that threw, a pairing attempt that failed | `src/features/animes/ui/AnimeListScreen/anime-list-screen-callback.helpers.ts:66`, `src/features/setup/ui/SetupScreen/use-setup-screen.ts:85` |
| Inline `Alert status="danger"` | a screen-level action error that stays on screen | `src/features/setup/ui/SetupScreen/SetupScreen.tsx:83`, `src/features/settings/ui/SettingsScreen/SettingsScreen.tsx:24` |
| `Alert` inside a sheet | rating submit failure, replaced when the next attempt starts | `src/features/animes/ui/SeasonRatingSheet/SeasonRatingSheet.tsx:79` |

## Decisions (blocking dialogs)

Both dialogs render no trigger and treat every close route — close button, overlay or drag —
as the non-committal answer, so a gesture can never be read as consent:

- destructive reset: `src/features/startup/ui/StartupBoundary/StartupDatabaseResetDialog.tsx:78`;
- battery exemption allow/dismiss:
  `src/features/battery-exemption/ui/BatteryExemptionPrompt/BatteryExemptionPrompt.tsx:47`.

## What this app does not have

Verified absent from `src/`, stated so nobody infers a pattern that is not there:

- **No skeleton or shimmer component** (no match for `skeleton`); loading is a `Spinner` plus copy.
- **No `ActivityIndicator`** — `Spinner` is the only indeterminate indicator.
- **No React error boundary** (no `ErrorBoundary`, no `componentDidCatch`). Failure containment
  is the startup boundary only; a render error past startup is unhandled by this design.
- **No first-load spinner for the anime list.** `AnimeListScreenContent` branches on `isEmpty`
  or renders the `FlatList`; the only progress affordance is the `RefreshControl` built at
  `src/features/animes/ui/AnimeListScreen/anime-list-screen.helpers.ts:242`.
- **No retry inside the empty state.** `AnimeEmptyStateView` renders an icon, a message and a
  hint, and no action at all (`src/features/animes/ui/AnimeEmptyState/AnimeEmptyState.tsx:17`).
- **No dedicated offline screen.** Being offline changes sync-status copy and toast copy; it
  never replaces a screen.

## Evidence boundary

Everything above is read from the cited lines. No rendering, contrast, animation, device or
assistive-technology claim is made. Where a state depends on runtime facts, this page names the
pure function that decides it — not what a device will show.
