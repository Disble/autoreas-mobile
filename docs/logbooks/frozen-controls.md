# Frozen controls logbook

Every time the app's buttons stopped responding while the app was still on screen. One row per
occurrence, so a later fix can be checked against how often and in which situation it happened
before, and so a theory that was already disproved is not tried again. See [Logbooks](README.md)
for the rules: append, never rewrite. A wrong row is corrected by a new note that says so.

Compiled 2026-10-27 from every doc, ODD document, capture, commit and memory note that mentions the
symptom (sources at the end). "Read" facts cite where they come from; anything inferred says so.

**Where things stand (2026-10-27):** no root cause. Every occurrence since 2026-10-23 happened when
the app came back from the background **into split screen**, on a warm resume (same process, not a
cold start). In both captured occurrences the database, the network and Bridge were healthy, and in
the 10-26 one Android delivered the touches to the app's native view. What has **never** been seen is
whether those touches reach the JavaScript button handlers, because no JavaScript-side trace has ever
been captured during a freeze. The owner reports the split-screen behaviour happens only with this
app.

---

## Do not go there again

Theories and fixes that were already tried or disproved for the split-screen freeze. Reopen one only
with new evidence that contradicts its deciding evidence.

| Theory or fix | Verdict | Deciding evidence |
| --- | --- | --- |
| Database lock between SQLite connections (`database is locked`) | **Different incident**, fixed 2026-08-12 (`e87c800`, `ce335f5`) | August showed an error toast and needed an app restart. The split-screen freezes show no toast, recover without a restart, and on 10-23 the tap was stored and synced within a second. |
| The JavaScript thread is blocked | **Ruled out** (10-23) | The `+1` tapped at 00:25:38.559 was committed at .705 and pushed at 00:25:39.655 while the screen stayed frozen. The only synchronous SQLite on the JS thread is the telemetry outbox, at 250 ms. |
| The database or the write queue hangs | **Ruled out** for the freeze | Same 10-23 evidence; the write path finished. In August the buttons were not dimmed, so the write promise had settled. |
| Bridge, network or auth failure | **Not supported** (10-26) | Reconciles at 01:07:32.080 and .657 answered 202 in 4–7 ms with nothing pending; `GET /api/animes` 200 in 88 ms; WebSocket connected at 01:07:31.957. The 401 at 01:14 (incident 270) was the investigator's own unauthenticated probe. |
| Android refuses input / the app is not responding (ANR) | **Not supported** (10-26) | Touch-downs reached the app's native view (`ViewPostIme`): 45 in minute 01:07 and 50 in 01:08. No ANR since boot. Input dispatch enabled, not frozen, app channel responsive. (Snapshot taken after recovery.) |
| The activity stayed paused, so Fabric stopped dispatching | **Contradicted** (10-23) | The WebSocket only stays open while `AppState === 'active'` (`use-sync-runtime.ts:60-62`), and it stayed connected 00:25:19 → 00:27:33. A pause would have closed it. |
| The chapter "busy" lock (`isMutating`, `in_flight` drop) | **Not the cause**; removed in 2.6.0 (`7a4a121`) | The freeze kills settings, grade, status and the day switch too, which never shared that lock. Removing it was never claimed to fix the freeze (`odd/tasks/nonblocking-anime-actions.md` L8, L31). |
| The list's deep compare (`2827ea3`), portals or toasts | **Ruled out** (10-23 analysis) | Memory note `dead-buttons-after-resume-2026-10-22`. |
| The Bridge desktop app's React Aria focus-loop fix (Bridge 2.5.1) is the same defect | **Rejected as an analogy** | Different runtime and UI library (`.pi/diagnostics/button-freeze-20261026/analysis/transversal-structural-analysis.md:124`). |
| The screen-stall probe (2.5.0) would catch it | **No: it cannot see dead buttons** | It measures a layout round trip, not whether a handler ran. It stayed silent during the 10-26 freeze. See [What the instrumentation can and cannot see](#what-the-instrumentation-can-and-cannot-see). |
| A Bridge request slow enough to block the UI | **Not supported** | The `+1` never waits on reconcile; reconciles were fast in both captured windows. |

Still **open**, neither proven nor disproved:

- Touches are lost between the native view and the JavaScript handlers (gesture handler / responder).
- The screen stops redrawing after the window is resized on resume.
- An invisible layer over the list intercepts touches. A closed sheet showing after a rotation was a
  real bug fixed in 2.3.0 (`fcffeb2`, `025631f`, enforced by the `SheetContent` lint rule), and every
  split-screen occurrence came after that fix, so it is rated **weak**, not ruled out.
- The 2.4.0 Reanimated flag `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` (`d9bedd0`) and the row
  re-render change (`2827ea3`) together with the resize on resume. Suspected on timing only: 2.4.0 was
  installed on 10-22 and the first split-screen freeze came that night. Nobody has tested it.

## Occurrences

All times local, UTC-05. Device in every row: Samsung SM-X800 (Galaxy Tab S9+), Android 16 / API 36.

| # | When | Mobile / Bridge | Layout | Before it | Recovery | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | First reported 2026-08-08; toast captured 2026-08-11 | 1.x / not recorded | not recorded | Chapter `+`/`−`, worse while offline | Only a full app restart | Toast `NativeStatement.runSync … database is locked`. **Different mechanism** (row 1 of the table above). `openspec/changes/archive/2026-08-12-sqlite-write-lock-contention/explore.md:4-30`. |
| 2 | Before 1.12.0 (2026-10-15) | pre-1.12 / — | not recorded | Folder scan at launch | When the scan finished | A synchronous folder scan froze the UI 3.0–4.6 s, 14.7 s after a reboot (`odd/tasks/anime-folders.md:17`). **Different mechanism**, fixed in 1.12.0 (~5.7 s → ~0.5 s, `CHANGELOG.md:221`). |
| 3 | 2026-10-23 00:25–00:27 | 2.4.0 (first night after install) / not recorded | Split screen, warm resume from background | Resume, then chapter `+` | **By itself**, ~2 min; the anime moved to *Visto* only then | Bridge got the first `+` within 1 s, then no chapter action of any phase until a grade at 00:27:22. Every control was dead. Logcat lost (buffers started 04:37), ANR dropbox empty. `odd/tasks/screen-stall-telemetry.md:24-26`. |
| 4 | 2026-10-26 00:05:18 | 2.5.1 / 2.5.1 | not recorded | not recorded | n/a | One `screen_stall` report (#362), trigger `focus`, 4449 ms. Not shown to be a freeze the owner saw; recorded because it is the only stall report on file (`docs/bridge-mcp-incident-investigation-feedback.md:39,90`). |
| 5 | 2026-10-26 ~00:30, **unconfirmed** | 2.5.1 / 2.5.1 | not recorded | Rating and episode change on *Tank Chair* at 00:30:36–38 | Owner recalls closing and reopening the app | Owner's recollection only; kept separate from row 6 on purpose (`docs/bridge-mcp-incident-investigation-feedback.md:89`). |
| 6 | 2026-10-26 ~01:07 | 2.5.1 (code 33) / 2.5.1 | Right half of split screen (655×824 dp, rotation 90), VLC on the left | Activity stopped at 00:34:21, process kept alive; warm resume at 01:07:32 | After plugging in USB and switching the other half of the split, ~01:09:30–47. **Not proven** that either caused it | Full capture in `.pi/diagnostics/button-freeze-20261026/` (local, gitignored). Screenshot at 01:07 shows *DARK MACHINE*. Timeline below. |
| 7 | 2026-10-27, time not reported | not reported (2.6.0 was published 2026-10-26) / not reported | Split screen | Owner's steps below | not reported | Owner report only; nothing captured. |

Bridge was upgraded from 2.5.1 to 2.6.0 **after** row 6, to enable the MCP. The exact moment is
unknown; the Bridge restart at 01:14:45 is not proof of it (`incident-history.md`).

### Row 7: reproduction path reported by the owner

Verbatim (2026-10-27):

> Es algo que tiene que tiene que ver con despertar la app después de haberla tenido en segundo
> plano. Él proceso fue abrirla, poner el día, ponerla media pantalla, abrir carpeta, ver episodio a
> fullscreen, dividir la pantalla escoger la app de nuevo, esta bloqueada los botones.
>
> Este comportamiento a media pantallas solo pasa con esta app. Con ninguna otra pasa igual.

As steps:

1. Open the app and pick the day.
2. Put it in split screen.
3. Open an anime's folder from the app (launches Samsung My Files).
4. Play an episode full screen (the app goes to the background).
5. Split the screen again and pick the app.
6. The buttons are dead.

This is the first occurrence written down step by step, so it is the first candidate for a deliberate
reproduction. Rows 3 and 6 did not record whether a folder had been opened. In row 6, VLC (which
plays the episode) was in the other half, and the window dump after recovery shows VLC focused inside
My Files' task (`autoreas-mobile-incident-window.txt:239-240`), which is consistent with the same path
but does not prove it.

### Row 6: native timeline around the onset

Read from `pre-onset-0055-0107.txt`, `input-lifecycle-timeline.txt` and `logcat-all.txt` in the
capture folder.

| Time | Event |
| --- | --- |
| 00:34:21.386 | Activity stopped; WebSocket disconnects. Process 26598 stays alive. |
| 00:55–01:07 | The separate `:sync` process logs `Could not change the database journal mode … database is locked` on each foreground-service tick (7 times). **Not evaluated** by anyone. |
| 01:07:27 | VLC loses focus; Samsung's "FromRecent" launcher takes the gesture. |
| 01:07:31.957 | Bridge: WebSocket connects. |
| 01:07:32.108 | App set as the resumed activity. |
| 01:07:32.110 | Configuration change to multi-window, right side, 655×824 dp. |
| 01:07:32.184–.200 | Restart → start → resume → top-resumed on the same PID. `ReactHost.onHostResume` at .186. |
| 01:07:32.369–.391 | Relayout, new surface, frame `[1409,0][2800,1752]`, finished drawing. |
| 01:07:32.441 | Window focus enters the app. |
| 01:07:32.561 | First touch-down delivered to the app's view (`ViewPostIme`), 0.36 s after resume. |
| 01:07–01:11 | Touch-downs reaching the view: 45, 50, 12, 4, 3 per minute. Focus moves app ↔ VLC at 01:08:07/09 and 01:08:30/36. |
| 01:09:30–31 | USB connects. |
| 01:09:38.325 | First `[RNScreens] … prop is not available` warning since resume, together with "Canceling draw … Draw frame after cancel". Possibly the first screen-level React render after resume; **inferred, unverified**. |
| 01:09:43 | USB settings open. |
| 01:09:47.194 | Focus returns to the app. Recovery is reported around here. |

Bridge saw no chapter action between *Tank Chair* at 00:30:37–38 and *DARK MACHINE* at 01:20:42, and
no `screen_stall` or phone report in 00:55–01:08:30. The 01:08 reconcile came from the native
foreground-service tick, so it is **not** evidence that JavaScript was alive.

## Changes that touched the symptom

None of these is proven to fix the split-screen freeze.

| Change | Version | What it did | Status for this freeze |
| --- | --- | --- | --- |
| `1f019c8`, `56c449e` | 2026-08-08 | Surfaced chapter-save failures that were swallowed | Instrumentation, "not a root-cause fix" (its own commit message). |
| `ce335f5`, `5180087`, `e87c800` | 2026-08-12 | One write queue per database file, `busy_timeout` on open, `BEGIN IMMEDIATE` | Fixed row 1. The symptom kept appearing rarely afterwards and became more frequent in October. |
| `50e0513` | 1.13.1 | Open My Files without waiting for a result | Stopped a sync on every folder tap. Not a freeze fix (inferred). |
| Anime-folders native module | 1.12.0 | Moved the folder scan off the JS thread | Fixed row 2. |
| `fcffeb2`, `025631f` | 2.3.0 | Closed sheets stay off screen after a rotation; lint rule for `SheetContent` | Rows 3–7 came after it. |
| `d9bedd0` | 2.4.0 | Reanimated `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` for scroll jank | Suspected on timing only; never tested. |
| `2827ea3` | 2.4.0 | List re-renders only the rows that changed | Its deep compare was ruled out (10-23 analysis). |
| `0b218e6`, `8ac6d54`, `ddf9c7f` | 2.5.0 | Screen-stall probe | Diagnostic only; silent during row 6. |
| `3ef222c`, `7a4a121` | 2.6.0 | Asynchronous chapter saves, optimistic display, busy lock removed | Explicitly not a freeze fix. Row 7 came after 2.6.0 was published (installed version not reported). The released APK was never installed during verification; only a lab build was. |

## What the instrumentation can and cannot see

**Screen-stall probe** (2.5.0, needs Bridge ≥ 2.4.0; `docs/mobile-diagnostic-telemetry.md:17-27`).
A touch through the root wrapper, a return to the foreground, a window focus or a resize re-mounts an
invisible view and times the trip from the React commit to its `onLayout`. A trip of 2 s or more sends
one `screen_stall` report (trigger, app state, window focus, window vs screen size, last 8
transitions) through the diagnostics outbox to `POST /api/sync/diagnostics`; 10 s or more opens a
Bridge incident. It **cannot** see:

- whether a button handler ran: a healthy probe can coexist with dead buttons;
- a touch that never reaches JavaScript, because such a touch cannot arm the touch trigger;
- a probe pending when the app goes to the background (discarded), or a new event while one is
  pending (does not re-arm).

**Chapter-action diagnostics** (`episode_action`; `65efc10`, `a69e0b3`, `714ef0d`). Records whether
the tap callback ran, was skipped (`anime_missing`, `db_unavailable`; `in_flight` is gone since
2.6.0), committed or failed, and whether the following sync succeeded. It **cannot** see disabled
buttons or a JavaScript thread that is not running (`odd/tasks/chapter-action-diagnostics.md:4`), and
it only covers the chapter buttons.

**Bridge MCP.** It has no phone-report lookup by ID, and its history and recorder tools take no time
window (`docs/bridge-mcp-incident-investigation-feedback.md:43-57`).

## Never captured

- JavaScript, gesture-handler or responder state during a freeze, in any occurrence. The installed
  release is not debuggable, so `run-as` is refused.
- Any dump taken **during** the freeze; every snapshot so far is from after recovery.
- Logcat for row 3, and anything at all for row 7.
- The exact second of the first failed press, and a calibration between the tablet and Bridge clocks.
- Whether a folder had been opened before rows 3 and 6.

## Proposed, not approved

- Trace one touch end to end: native entry → gesture handler → JavaScript handler → visible effect
  (`analysis/transversal-structural-analysis.md:134`).
- Screen-side instrumentation (frame gaps, AppState, window focus); the stall probe covers only part of
  it.
- A write watchdog with a timeout outcome distinct from a rejection (`analysis/…:85`). Note it targets
  the write path, which rows 3 and 6 showed healthy.
- Bridge MCP: time-window filters and phone-report lookup by ID (asked of the Bridge team).
- A device check of 2.6.0 covering split screen (`odd/tasks/nonblocking-anime-actions.md:62`).

---

## Method: when it happens

Logcat's main buffer rotates within about 40 minutes, so capture first and investigate later.

1. Do not close the app and do not touch the other half of the split screen yet.
2. Note the local time, the installed version (Settings → app info), the layout and which app is in
   the other half, and the steps just before it (was a folder opened? was an episode played?).
3. Take a screenshot.
4. If a computer is at hand, while it is **still frozen**:
   `adb logcat -b all -d > logcat-all.txt`, `adb shell dumpsys input`, `adb shell dumpsys window`,
   `adb shell dumpsys activity activities`, then `adb bugreport`. Keep it under `.pi/diagnostics/`
   (gitignored: it holds device data, never commit it).
5. Note whether it recovered on its own, after how long, and what was done right before.
6. Then check the Bridge MCP for the same window: chapter actions, WebSocket connects and
   disconnects, `screen_stall` and phone reports.

A column the row could not observe says *not observed*; it is never filled in by inference.

## Sources

- `.pi/diagnostics/button-freeze-20261026/` (local, gitignored): `README.md`, `incident-history.md`,
  `pre-onset-0055-0107.txt`, `input-lifecycle-timeline.txt`, `bridge/README.md`,
  `window-0015-0120/README.md`, `analysis/transversal-structural-analysis.md`.
- `odd/tasks/screen-stall-telemetry.md`, `odd/tasks/chapter-action-diagnostics.md`,
  `odd/tasks/nonblocking-anime-actions.md`, `odd/tasks/anime-folders.md`.
- `docs/bridge-mcp-incident-investigation-feedback.md`, `docs/mobile-diagnostic-telemetry.md`,
  `docs/learning-log.md`, `CHANGELOG.md`.
- `openspec/changes/archive/2026-08-12-sqlite-write-lock-contention/explore.md`.
- Engram `incidents/dead-buttons/2026-10-26` (#13029) and #12865 (10-23); agent memory notes
  `dead-buttons-after-resume-2026-10-22` and `dead-chapter-buttons-investigation`.

---

## 2026-10-27 — owner annex: the app still reacts, only the taps fail

Verbatim:

> como dato anexo. Interactuar con la app de si se puede. Por ejemplo, en la parte de arriba de las
> cards de animes, tenemos un scroll para ver todos los días de la semana, porque no entra en la a
> media pantalla. Y ese scroll sí se puede mover. También, si tú presionas los botones que tienen
> animación, la animación sí funciona. Entonces, interactuar con la app sí se puede. Pero los botones
> simplemente no reaccionan, ninguno. Lo cual se me hace muy raro. Podría ser un tema de librería.
> Estaría de revisarse las versiones de todas las librerías, si es que hay bugs y si es que hay
> releases nuevas.

What it changes, checked against the installed code:

- HeroUI Native's `Button` renders `PressableFeedback`, which is
  `Animated.createAnimatedComponent(Pressable)` from `react-native`
  (`node_modules/heroui-native/lib/module/components/pressable-feedback/pressable-feedback.js:4,12`).
  Its press animation is started by setting `isPressed` inside the `onPressIn` callback
  (`pressable-feedback.animation.js:90-98`, wired at `pressable-feedback.js:56-65,84-85`).
- So if the animation plays, **JavaScript is running and React Native's press handling delivered
  `onPressIn` to the button.** This supersedes the open lead "touches are lost between the native view
  and the JavaScript handlers": they are not lost; they reach the button and the tap is then dropped
  before `onPress`.
- Scrolling is handled natively by the scroll view, so it working is consistent with this and says
  nothing more about JavaScript.

In React Native's `Pressability` (`node_modules/react-native/Libraries/Pressability/Pressability.js`),
a press that began (`onPressIn`) ends without `onPress` in these ways:

1. A move event lands outside the button's region measured with `measure()` (`pageX`/`pageY`),
   sending `LEAVE_PRESS_RECT` (`:483-516`, region measured at `:800-830`). A finger on a tablet almost
   always produces small moves, so a stale or offset region would cancel nearly every tap.
2. The responder is terminated (another view or the native side takes the touch).

**Leading candidate, not proven:** after the window moves to the right half on resume (row 6:
configuration change to 655×824 dp, frame starting at x=1409 px), the measured button region and the
touch coordinates disagree, so every tap counts as "finger left the button". It would explain why
only this app does it (other apps don't use React Native's press handling), why scrolling still works,
why the press animation still plays, and why switching the other half of the split screen or waiting
can bring it back (a new layout pass re-measures). Next check: library versions and known bugs
(owner's request), then a deliberate reproduction with the row 7 steps logging `onPressIn`,
`onPressOut` and `onPress` on one button.

## 2026-10-27 — library versions and known upstream bugs

Researched against npm, Expo's `bundledNativeModules.json` and upstream GitHub (issue search via web
only; the GitHub API returned 422, so issues may have been missed). Read-only: nothing was upgraded.

**Versions.** Every pinned package matches exactly what Expo SDK 55 expects. Nothing in the SDK 55
line is "outdated" in a way that an `expo install --fix` would change.

| Package | Installed | Newest SDK 55 accepts | Latest on npm |
| --- | --- | --- | --- |
| react-native | 0.83.10 | 0.83.10 (newest 0.83.x) | 0.88.1 |
| expo | 55.0.28 | 55.0.32 | 58.0.19 |
| expo-router | 55.0.17 | 55.0.18 | 58.0.26 |
| react-native-gesture-handler | 2.30.1 | 2.30.x | 3.4.0 |
| react-native-reanimated / worklets | 4.2.1 / 0.7.4 | 4.2.1 / 0.7.4 (pinned) | 4.7.1 / 0.13.1 |
| react-native-screens | 4.23.0 | 4.23.x | 4.30.0 |
| react-native-safe-area-context | 5.6.2 | 5.6.x | 5.10.1 |
| heroui-native | 1.0.5 | not pinned | 1.0.11 |
| uniwind | 1.6.1 | not pinned | 1.13.0 |
| @gorhom/bottom-sheet | 5.2.8 | not pinned | 5.2.14 |

**Mechanism in the installed code (verified by reading it):**

- A touch's `pageX` is relative to the root view, with no window offset
  (`ReactAndroid/.../uimanager/events/TouchesHelper.kt:57-59`).
- `measure()`'s `pageX` adds the root's `viewportOffset` (`RootShadowNode.cpp:37-38`).
- `viewportOffset` is `getLocationOnScreen()` minus `getWindowVisibleDisplayFrame()`
  (`ReactAndroid/.../runtime/ReactSurfaceView.kt:101-112`), recomputed only when the root view
  measures or its layout changes.
- Inference, not verified: if those two disagree at the moment it is computed after the window jumps
  to the right half, every button's measured box is offset from the touches by roughly the window's x
  position, and the first finger move cancels the press (the annex above).

**Findings, strongest first:**

1. React Native commit `9d183675e9` (PR #56056), *Fix measureInWindow on Android edge-to-edge*,
   released in **0.86.0**, not backported to 0.83.x. It rewrites exactly that offset code to use
   `getLocationInWindow` and stops subtracting the visible display frame, which it says covered
   "status bar insets, split-screen offsets"; tested in split screen. Our installed code is the old
   version. Its stated symptom is wrong coordinates, not dropped presses: **partial-to-strong match.**
   https://github.com/facebook/react-native/commit/9d183675e9552043dd2d768d4fbac1760cdc9a59
2. React Native #57502, *Pressability silently drops presses when measure() disagrees with the native
   hit test* (0.83.6 / SDK 55, iOS, triggered by sheets). **Exact symptom**: feedback plays, first move
   sends `LEAVE_PRESS_RECT`, `onPress` never fires. Closed as not planned; includes an unmerged
   `Pressability.js` patch that discards a measured box that does not contain the touch where the
   press began. https://github.com/react/react-native/issues/57502
3. React Native #50509, `measure`/`measureInWindow` disagree on Android under edge-to-edge (X offset
   included). Open. Mechanism only. https://github.com/react/react-native/issues/50509
4. Reanimated #10121 (drafts #10975, #11016): stale `measure()` during animations drops `onPress`, but
   for the `*_SYNCHRONOUSLY_UPDATE_UI_PROPS` flags, **not** our `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS`.
   Same mechanism, different trigger; probably not us directly. #10444 / PR #10823 show our flag can
   roll animated values back on non-React commits (could also stale a box; inference).
5. Weak or nothing: Expo #46844 (DeX/freeform density), gesture-handler #3476/#4629, screens #4132,
   heroui-native 1.0.6–1.0.11 (only portal touch fixes for popover/menu/select), expo-router,
   safe-area-context, Reanimated 4.2.2–4.2.3.

**What would contain a relevant fix:** React Native ≥ 0.86.0, which means leaving SDK 55. Smaller
alternatives, none applied: patch the two Kotlin files from `9d183675e9` onto 0.83.10, or patch
`Pressability.js` in the style of #57502. No gesture-handler, screens, heroui-native, Reanimated or
Expo release was found with a matching fix, so **upgrading those alone is not expected to fix this**.

**Not yet done:** reproducing it with the row 7 steps while logging `onPressIn` / `onPressOut` /
`onPress` and the button's `measure()` box next to the touch's `pageX`. That single log line would
prove or kill the offset theory before any upgrade or patch.

## 2026-10-27 — is the pinned Android target a factor?

Owner question: the app pins a specific Android version; is that a problem?

- `app.json` pins `compileSdkVersion: 36` and **`targetSdkVersion: 35`**, while React Native 0.83.10's
  default is 36 (`node_modules/react-native/gradle/libs.versions.toml:3-5`). The tablet runs Android
  16 (API 36). The pin dates from the foreground-sync work (`10f95e7`, 2026-04-11), and the background
  service decisions were made and measured on 35 (`docs/adr/008-…md:11`,
  `docs/mobile-background-sync-investigation-log.md:700`).
- The Android 16 window changes for apps targeting 36 on large screens (ignoring orientation,
  resizability and aspect-ratio restrictions) only affect apps that declare such restrictions. Ours
  declares none: the generated `MainActivity` has `screenOrientation="unspecified"`, no
  `resizeableActivity="false"`, and `orientation: "default"` in `app.json`. Edge-to-edge is already
  enforced at target 35 on Android 15+. **So the target pin is not expected to change how split
  screen positions or measures the app** (reasoning from the platform's documented behaviour, not
  tested on device).
- Related and relevant to the offset theory: `MainActivity` declares
  `configChanges="…|orientation|screenSize|screenLayout|smallestScreenSize"`
  (`android/app/src/main/AndroidManifest.xml:32`, prebuild output), so a split-screen resize does
  **not** recreate the activity; React Native has to re-measure the root view itself, which is the
  `viewportOffset` path above.
- Raising the target to 36 is a separate decision with its own risk: it changes background-service
  rules that ADR 008 measured on 35. It is not a fix for this bug on current evidence.

## 2026-10-27 — newer Expo SDKs and the official upgrade path

Read through the Expo MCP (`docs.expo.dev/versions/latest`, `docs.expo.dev/skills`) and the official
`expo-upgrade` skill (`github.com/expo/skills`, `plugins/expo/skills/expo-upgrade/SKILL.md`). Nothing
was installed or upgraded.

| Expo SDK | React Native | React | compileSdk / targetSdk | Contains RN `9d183675e9`? |
| --- | --- | --- | --- | --- |
| 55 (installed, 55.0.28) | 0.83 | 19.2.0 | 36 / 36 (we override target to 35) | No |
| 56 | 0.85 | 19.2.3 | 36 / 36 | No (fix landed in 0.86.0) |
| 57 | **0.86** | 19.2.3 | 36 / 36 | **Yes** |
| 58 (latest) | 0.88 | 19.3.0 | 37 / 36 | Yes |

- The `expo-upgrade` skill says to skip SDK 56 when coming from 55 or earlier and go straight to 57,
  and **not to use `expo@57.0.8` or below** (Hermes V1 memory regression with Worklets/Reanimated). Its
  core steps: `npx expo install expo@latest`, `npx expo install --fix`, `npx expo-doctor`, then clear
  caches; `npx expo prebuild --clean` when native changes are needed. This project's `android/` is
  gitignored prebuild output, so it is a generated-native (CNG) project.
- Expo's own docs name two options when a needed React Native fix is not in the current SDK:
  `patch-package`, or a newer/pre-release SDK.
- Consequences for this app, not evaluated in depth yet: the SDK default target becomes 36, and our
  `targetSdkVersion: 35` override (background service, ADR 008) would have to be kept deliberately or
  re-measured; Reanimated/Worklets, gesture-handler, screens and heroui-native move with the SDK; a
  two-SDK jump is a migration, not a patch.
- Still the first step either way: prove the offset theory with a logged reproduction, so an upgrade
  is chosen because it fixes this, not on hope.

## 2026-10-27 — why `targetSdkVersion: 35`, and does it still hold?

- The pin arrived in `10f95e7` (2026-04-11) with the Notifee JavaScript foreground-service runner.
  Its design notes justify only `compileSdkVersion: 36` (new AndroidX dependencies stopped compiling
  against 35). **No document records a reason for keeping the target at 35.**
- The later native sync engine (ADR 008: `specialUse` service, native ticker) was measured and
  validated at target 35 on the Android 16 tablet, but nothing in it was found to require 35.
- Android 16's target-36-only changes (developer.android.com/about/versions/16/behavior-changes-16):
  edge-to-edge opt-out removed, predictive back on by default (`onBackPressed` no longer called),
  `elegantTextHeight` ignored, `scheduleAtFixedRate` catch-up limited to one run, large-screen
  orientation/resizability restrictions ignored, health permissions, photo-picker preselection. That
  page lists **no** target-36 change to foreground services, JobScheduler/WorkManager quotas,
  AlarmManager, background starts or wake locks. A grep of `modules/`, `plugins/` and `src/` finds no
  use of `scheduleAtFixedRate`, `onBackPressed`, `KEYCODE_BACK`, `BackHandler`, `elegantTextHeight`,
  the edge-to-edge opt-out or body-sensor permissions.
- So on current evidence the pin is a leftover, not a requirement. Raising it is still a change to
  verify on device (the background service survival measurements of ADR 008 were taken at 35), not a
  fix for the frozen controls.

## 2026-10-27 — can Expo and the libraries move independently of the target pin?

- `expo-build-properties` still exposes `android.targetSdkVersion` as an override in the current docs
  (`docs.expo.dev/versions/latest/sdk/build-properties`), so an SDK upgrade can keep
  `targetSdkVersion: 35` unchanged until the reason for the pin is known.
- `expo@57.0.31` (newest 57.x; avoid ≤ 57.0.8 per the `expo-upgrade` skill) pins react-native 0.86.3,
  reanimated 4.5.1, worklets 0.10.1, gesture-handler ~2.32.0, screens ~4.26.0, safe-area-context
  ~5.7.0, svg 15.15.4, keyboard-controller 1.21.9 (`bundledNativeModules.json`).
- heroui-native 1.0.11's peer ranges accept all of those; it asks `@gorhom/bottom-sheet ^5.2.9`
  (we have 5.2.8). uniwind 1.13.0 (`react-native >=0.81`) and react-native-notify-kit 10.9.1
  (`react-native >=0.73`) declare no conflict.
- Not verified, only a build and the test suites can tell: the five local native modules under
  `modules/` compiling against the new Expo/React Native, and whether Reanimated 4.5 still honours
  `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS`.

## 2026-10-27 — the reason for `targetSdkVersion: 35`, searched exhaustively

- **April origin (`10f95e7`, 2026-04-11): no reason was ever recorded.** Git has a single real change
  of the line, nothing set 36 and reverted it, and the commit's own notes
  (`docs/specs/changes/2026-04-10-android-foreground-sync-service/design.md`, `tasks.md` 1.3) justify
  only `compileSdkVersion: 36`. Engram #2336 (2026-04-11) mentions target 35 only as a smoke-test
  update. React Native 0.83 already defaulted to 36, so the line **lowered** the target. No transcript
  from April survives (the oldest is 2026-10-07). Inference: written alongside the required compileSdk
  bump, with no stated reason.
- **The only recorded decision:** `odd/tasks/background-sync-native-bound.md:230-246`, T8 —
  "**Decided 2026-09-19: keep targetSdk 35 and declare `specialUse`.**" The options were 35 +
  `specialUse`, 34 + `dataSync`, 33 with no type, and `dataSync` at 35, to escape the `dataSync`
  6 h/24 h cap. **Target 36 was never evaluated.**
- What depends on 35, per the docs: only that every background-survival result (ADR 008) was measured
  at 35. The exact-alarm denial and the `<queries>` visibility requirement hold at 36 too. No doc claims
  anything breaks at 36.
- Note: Engram #13129/#13130 (written 2026-10-27) attribute the override to ADR 008; that is a
  reason assigned after the fact, not the original one.

## 2026-10-27 — checking the owner's recollection about target 36

Owner, verbatim: "No, sí se rompe. Justamente porque no estaba funcionando fue que se bajó de versión.
Incluso se hicieron varios análisis y eso. Trata de buscar en los commits antiguos por esas fechas.
Porque se probó y no funcionaba. Y como no funcionaba, se dejó por escrito de que era algo que Android
quitó desde la versión 16. Y que pues no se puede y no informa. Y que tenemos que hacer desde la 15 y
quedarnos hasta allí por el resto de nuestras vidas. Revisa que sea cierto, revisa todas esas cosas."

Searched: all 66 non-checkpoint commits of April 2026 with their diffs (`git log --all -p`), every
commit touching `targetSdk` (`-G`), `docs/`, `docs/specs/`, `openspec/`, `odd/`, the sibling
repositories under `autoreas-sp/` (Markdown), and Engram ("Android 16", "SDK 36", "targetSdk", plus
Spanish phrasings). **Not found:** any test at target 36, any downgrade from 36, or any text saying
Android 16 removed something that forces 35.

What **is** recorded, and may be what is remembered:

- The restriction is **Android 15's, for apps targeting 35+**, not Android 16's: `dataSync`
  foreground services get 6 h per 24 h, then `Service.onTimeout`
  (`docs/mobile-bridge-background-sync-redesign.md` §4 P1). And it was **silent**: H03, "JS state keeps
  reporting it running" (same doc, line 318). That matches "no se puede y no informa".
- It was diagnosed on device in September (Engram #9822, #9824, #9850: Syncthing targets 33 with no
  service type and survives days; we targeted 35 with `dataSync` and died).
- The options weighed (Engram #9851, `odd/tasks/background-sync-native-bound.md` T8): `specialUse` at
  35, target 34 with `dataSync` ("congela la app en Android 14 y volver a subir reingresa al tope"),
  target 33 without a type, or `dataSync` at 35. **Decided 2026-09-19: stay at 35 with `specialUse`.**
  Going *up* to 36 was never on the list, and nothing says it was tried.
- The April line itself (`10f95e7`) set 35 while React Native's default was already 36; its notes and
  Engram #2327/#2332 discuss only compileSdk 36. No April document mentions a failure at 36.

Conclusion: the recollection is not supported by the records found. The documented "it doesn't work and
doesn't tell you" is the Android 15 `dataSync` cap at target 35, which `specialUse` solved. Whether
`specialUse` keeps working at target 36 is **untested**, so raising the target still needs the same
on-device survival measurement before it is accepted.

## 2026-10-27 — Judgment Day: does `targetSdkVersion` 35 → 36 affect the app?

Two blind judges over commit `732fff0` (tree `6bc1299`), the change being `app.json:61` 35 → 36 only,
checked against the official target-36 change list. **Verdict: APPROVED, no severe finding.**

| Item | Judge A | Judge B | Ledger |
| --- | --- | --- | --- |
| Predictive back | n/a: `app.json:20` `predictiveBackGestureEnabled: false` → manifest `enableOnBackInvokedCallback="false"`, survives prebuild | same | not affected |
| Edge-to-edge opt-out removed | n/a: never used; edge-to-edge already on at 35 | same (`gradle.properties:47`) | not affected |
| Large-screen orientation/resizability ignored | n/a today (`orientation: default`, no resizability limits); a future orientation lock would be ignored on the tablet | same | info |
| `scheduleAtFixedRate`, `elegantTextHeight`, health, Bluetooth, MediaStore, photo picker | not used | not used (also searched native libraries) | not affected |
| Foreground services, alarms, WorkManager, wake lock, intents | `specialUse` + subtype; inexact `setAndAllowWhileIdle`; no target-36 change listed | same, with code lines | not affected |
| Docs/comments say "targetSdk 35"; `specialUse` survival only measured at 35; Robolectric tests run at `sdk=35` | SUGGESTION | SUGGESTION | **confirmed info**: update records, re-measure survival on device |
| `tests/smoke/android-cleartext-config.test.ts:27` hardcodes `targetSdkVersion: 35` in a `toEqual` | — | WARNING | suspect (one judge), verified true: the change must update this test |

Both judges note their conclusion rests on the supplied Android 16 list (they could not browse) and
that React Native 0.83 / notify-kit internals were not inspected beyond the manifest opt-out.

## 2026-10-27 — milestones and the closure rule

Owner, verbatim: "En efecto, pongámosle como un milestone. Primero tiene que ser la migración hacia las
nuevas versiones de las librerías, incluyendo el posible fix. Y recuerda, esto es posible. No se va a
cerrar esa bitácora hasta que se haya demostrado por un periodo lo suficientemente largo de tiempo de
que funciona. Por desgracia, eso de probar en el momento no funciona. Tiene que ser probado sobre la
marcha en un periodo largo de tiempo para poder declarar que funciona. Por lo tanto, pues también eso
implica poner un recordatorio. Pero la bitácora no se cierra hasta que se haya validado. Y
evidentemente estos cambios que hacemos deben ser guardados en la bitácora como parte de afectaciones o
posibles mejoras que estamos viendo. ¿Quién sabe? Tal vez subir a versión 16 afecte. No digo que sí,
pero podría haber alguna posibilidad."

**Closure rule.** This logbook stays open until a fix has been validated by **normal use over a long
period**, including split-screen sessions, with no occurrence. A test done once on the spot does not
close it: rows 3–7 show the freeze is intermittent and depends on a resume after time in the
background. A single new occurrence after a milestone ships reopens that milestone's verdict.

| Milestone | What it changes | Status | Observation window |
| --- | --- | --- | --- |
| M1 | Expo SDK and library upgrade (`chore/expo-sdk-upgrade`, `odd/tasks/expo-sdk-upgrade.md`), bringing React Native ≥ 0.86 with the `measure` offset fix `9d183675e9`. Target stays 35. | In progress | Starts when a build with M1 is installed on the tablet and used normally. |
| M2 | `targetSdkVersion` 35 → 36, as its own change after M1 is validated. Judgment Day approved it (see above); requires updating `tests/smoke/android-cleartext-config.test.ts:27` and an overnight background-service survival check. | Not started, waits for M1 | Its own window; any change in freezes **or** in background sync is attributed to M2. |

Keeping M1 and M2 apart is deliberate: if both shipped together, a change in the freeze rate or in
background sync could not be attributed to either.

**Proposed validation criterion (owner to confirm):** at least three weeks of normal use after
installing the milestone's build, with split-screen use on several days, and zero frozen-controls
occurrences. Basis: before M1, occurrences were logged on 10-23, 10-26 (twice) and 10-27, i.e. several
per week, so three clean weeks would be a clear change rather than chance.

## Changes under observation

Every change made while this logbook is open, with the effect it might have on the freeze (better or
worse) and how it is checked. Append a row per change; never remove one.

| Date | Change | Possible effect on the freeze | Possible side effects | How it is checked |
| --- | --- | --- | --- | --- |
| 2026-10-26 | 2.6.0: chapter busy lock removed, optimistic actions | None expected (the freeze hits every control) | — | Row 7 happened after its publication; version installed at row 7 not reported |
| 2026-10-27 | M1: Expo 58 / React Native 0.88 and latest libraries, target 35 kept | May fix it if the offset theory holds (RN `9d183675e9`) | Any library regression; Reanimated flag `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` may change meaning | Full test suites now; M1 observation window on the tablet |
| (planned) | M2: target 36 | Not expected; the owner keeps the possibility open | Background service survival (only measured at 35) | Overnight survival check + M2 observation window |

**2026-10-27 — criterion confirmed by the owner:** three weeks of normal use per milestone, split screen
on several days, zero occurrences. Window start = the day the milestone's build is installed on the
tablet; record that date here when it happens. Reminder: kept in the agent's persistent memory, checked
at the start of every session (no calendar entry).

## 2026-10-27 — M1 delivered in the worktree (not yet installed)

Detail in `odd/tasks/expo-sdk-upgrade.md` L3. Entries for "Changes under observation":

| Date | Change | Possible effect on the freeze | Possible side effects | How it is checked |
| --- | --- | --- | --- | --- |
| 2026-10-27 | React Native 0.83.10 → **0.88.0**: `ReactSurfaceView.kt:50-53` now computes `viewportOffset` with `getLocationInWindow`; `getWindowVisibleDisplayFrame` no longer appears in the file | **The candidate fix** for the offset theory | — | M1 observation window |
| 2026-10-27 | Gesture Handler 2.30 → **3.3** (major) | Touch handling path changes; could help or hurt | Gestures and sheets behave differently | Device use during M1 window |
| 2026-10-27 | Reanimated 4.2.1 → 4.7.1: `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` is now the library default (`staticFlags.json`); our entry is redundant but kept | None expected (same flag value) | — | — |
| 2026-10-27 | `compileSdkVersion` 36 → 37 (RN 0.88 requires it); **target stays 35** | None expected | — | Build |
| 2026-10-27 | Expo 58 template turns on R8 minification for release builds (`android.enableMinifyInReleaseBuilds=true`) | None expected | Release-only crashes from stripped classes (native modules, reflection) | First release/lab build must be exercised, including background sync |
| 2026-10-27 | heroui-native 1.0.5 → 1.0.11, bottom-sheet 5.2.8 → 5.2.14, uniwind 1.6 → 1.13 | None expected | Styling or sheet behaviour | Device use |

Held back (not part of M1): ESLint 10, @testing-library/react-native 14, Stryker 10. Known gap: the
Stryker mutation dry run fails under Jest 30, so the staged mutation gate would fail if any of its
three files (`src/features/sync/native-foreground-sync-ticker.helpers.ts`,
`native-foreground-sync-adapter.helpers.ts`, `native-battery-optimization.helpers.ts`) is staged.

**2026-10-27 — M1 independent verification:** PASS, no blockers. Open advisory: a native sync-engine test run failed once in six (68 of 450, not reproduced, baseline not checked). It is unrelated to touch handling but must be cleared before M1 is released; logged in `odd/tasks/expo-sdk-upgrade.md` L5.

**2026-10-27 12:13 (tablet local time) — M1 installed, observation window starts.** Lab build
`autoreas-mobile-2.6.0-lab-arm64-v8a-20261027T1657Z.apk` from `chore/expo-sdk-upgrade` @ `e992ad5`
(code = `db6f51e`), installed with `adb install -r` over 2.6.0 (data kept). App launched, data and the
Bridge connection present, no crash in logcat. The window ends **2026-11-17** if no freeze happens.
Installing any other build before then (for example a 2.6.x release without M1) interrupts the
window; record it here.

**2026-10-27 12:16 — first M1 regression reported by the owner (layout, not a freeze).** On the tablet in
landscape the transparent header covered the top of the day panel ("Lunes" cut off, could not be
scrolled into view). Cause: `AnimeListScreen.tsx` padded the content with a fixed `pt-16` (64 pt),
while the header is 64 pt **plus** the status bar; after the upgrade the content is drawn under the
status bar, so the overlap became visible. Fix on `chore/expo-sdk-upgrade`: the screen pads by the
measured header height (the project's `useHeaderHeight` helper, already used by `ScreenScrollView`).

| Date | Change | Possible effect on the freeze | Possible side effects | How it is checked |
| --- | --- | --- | --- | --- |
| 2026-10-27 | List screen top padding = measured header height instead of a fixed 64 pt | None expected | Content position on phone and in split screen (the helper keeps its first value on Android) | Device use; a new lab build interrupts and restarts the M1 window |

**2026-10-27 13:04 — header overlap, second half.** The first fix left 8 px under the header: the shared
`useHeaderHeight` helper froze the first Android value (86 pt) while the header settled at 94 pt. The
helper now follows the live value. Verified on the tablet with a Metro dev client: panel at y=273, header
ends at 264; Settings unaffected. A dev-client build was installed for UI work, so the M1 observation
window is **paused** until a lab or release build with M1 is installed again.

| Date | Change | Possible effect on the freeze | Possible side effects | How it is checked |
| --- | --- | --- | --- | --- |
| 2026-10-27 | Shared `useHeaderHeight` returns the live header height on Android (no longer the first value) | None expected | Content may shift once on mount if the header height changes (Settings, list screen) | Device use |
| 2026-10-27 | Kotlin unit tests run with `--no-parallel` (owner chose option 1) | None (test infrastructure only) | Slower native test step | `bun run test:kotlin` |

## 2026-10-27 — M2 folded into M1 (owner decision)

Owner, verbatim: "Ah, sí, sí, sí, la de Android 16. Vamos a agregar para la próxima release también eso,
porque si no, ¿cuándo probamos? ¿En 2 meses? No, pues ahorita."

`targetSdkVersion` 35 → 36 ships in the same build as the library upgrade. **Consequence, accepted:** a
change in the freeze rate or in background sync during the window can no longer be attributed to the
libraries or to the target separately. If either regresses, the first split is a build with target 35
on the same libraries. The single window is still three clean weeks from the install date.

| Date | Change | Possible effect on the freeze | Possible side effects | How it is checked |
| --- | --- | --- | --- | --- |
| 2026-10-27 | `targetSdkVersion` 35 → 36 (Android 16), same build as M1 | Not expected (Judgment Day found no touch-related target-36 behaviour); the owner keeps the possibility open | Background service survival, only ever measured at 35; Robolectric unit tests still run at `sdk=35` | Overnight survival during the window (sync status in Settings and the Bridge's records) |
