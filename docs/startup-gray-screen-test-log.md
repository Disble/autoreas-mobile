# Startup Gray Screen Test Log

## Scope

This log records the bounded startup fault inventory considered for the gray or frozen screen incident. It does not claim reproduction of the reported production incident.

## Fault Inventory

| Fault | Current evidence | Test status | First slice |
| --- | --- | --- | --- |
| Font load does not settle or fails | `useStartupBoundary` bounds font loading at five seconds and converts the `useFonts` error or deadline into the existing redacted startup fallback. | Focused hook tests cover a non-settling load, an explicit font error, and a loaded-font deadline window that preserves routing. Integration coverage confirms the visible HeroUI fallback, one splash hide, no route replacement, and no sync runtime mount for a non-settling load. | Yes, font deadline and failure fallback |
| SQLite provider retains Suspense after a controlled `onInit` failure | Controlled startup failures now render in the safe root shell outside `SQLiteProvider`, while retaining the non-database theme and UI providers. | Integration fault injection uses a permanently suspending provider whose initiated local preparation rejects. It observes `StartupBoundaryFallback`, no route slot, no sync runtime gate, and no route replacement. | Yes, external terminal fallback |
| SQLite provider never invokes `onInit` | A provider-readiness watchdog begins after fonts load and a provider is selected. It emits a redacted `provider_readiness` failure after five seconds. | Integration fault injection uses a provider that suspends forever and never calls `onInit`. It confirms loading before the deadline, then the visible fallback, one splash release attempt, no database preparation/configuration calls, no route replacement, and no sync runtime gate. | Yes, provider-readiness watchdog |
| Database preparation stage does not settle or rejects | `prepareForegroundDatabase` covers connection pragmas, version read, migrations, schema validation, and readiness marker. The startup hook now bounds the whole preparation call. | Focused hook test covers non-settlement; existing hook test covers rejection. Individual stage non-settlement coverage remains absent. | Yes, whole-operation deadline |
| Local config read does not settle or rejects | `getBridgeConfigSnapshot` runs after database preparation and before route selection. The startup hook now bounds the call. | Focused hook test covers non-settlement. Existing controlled failure handling covers rejection; focused rejection coverage remains absent. | Yes, whole-operation deadline |
| Splash API failure | `preventAutoHideAsync` handling stays unchanged. Every terminal startup path releases through `hideAsync`; a rejection triggers one bounded `hide()` fallback and any final native failure is contained. | Focused hook fault injection covers `hideAsync` rejection in controlled failure and ready states, with one `hideAsync`, one `hide()`, and no unhandled rejection. | Yes, splash-release fallback |
| Route replacement failure | Ready-state `router.replace` runs before splash release; its `catch` releases splash then reraises the original navigation exception for React's existing error path. | Focused hook fault injection covers a synchronous replacement exception, one route call, and one splash-release attempt. | Yes, navigation exception release |
| SQLite native runtime unavailable | `getSQLiteProvider()` can return no provider and renders `SQLiteUnavailableScreen`. | Existing root boundary test covers unavailable provider rendering. | No |
| Post-ready offline or slow bridge calls | Bridge calls mount only after startup reaches ready. The offline bridge is not established as the splash blocker. | No startup-blocking test is appropriate because bridge work is post-ready. | No, separate reliability concern |

## First Slice Decision

The first slice bounds foreground database preparation and local configuration loading. A deadline rejection enters the existing redacted `StartupFailure` flow, which lets `useStartupBoundary` hide the retained splash and render its fallback. A focused hook test confirms the existing request identifier guard prevents a stale deadline failure from overwriting a newer ready state.

The bridge remains a separate post-ready reliability concern. This log does not identify it as a confirmed splash blocker.

## Font Slice Decision

The font slice reuses the controlled startup fallback with a `font_loading` diagnostic stage. The fallback releases the retained native splash and prevents route and sync runtime activation after a font error or five-second deadline. This is fault-injection coverage only; it does not reproduce or confirm the reported production incident.

## Provider Slices Decision

Controlled local failures now escape `SQLiteProvider`, so a retained provider Suspense promise cannot cover the fallback. The provider-readiness watchdog covers the separate path where Expo SQLite never invokes `onInit`; it is cancelled when local readiness succeeds or another controlled failure already exists. The ready-path timer cancellation test confirms that a completed startup remains on its route after the watchdog window.

These are fault-injection tests, not field reproduction. Jest does not establish physical-device behavior for Expo's native splash module, including the `hideAsync` rejection and `hide()` fallback path. Remaining untested cases include Expo SQLite behavior on physical devices and individual database sub-stage hangs.
