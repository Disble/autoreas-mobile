# Anime folders

Open each anime's folder on the tablet, and its page, straight from the anime card.

Spec and decision log: [`odd/tasks/anime-folders.md`](../odd/tasks/anime-folders.md). Approved mockups: the anime-folders flow canvas linked from that document.

## How it works for the user

1. The list shows a hint banner, "Abre la carpeta de cada anime desde la tablet", until a folder is chosen or "Ahora no" dismisses it for good.
2. "Elegir carpeta" opens a short guide, then the Android folder picker, already at `SD card › Videos › Anime` when that folder exists. The user picks the folder that holds the animes and allows access once. The grant survives restarts and reboots.
3. Every card whose anime has a folder there shows a folder button bottom-left, next to the page button. The folder opens in Samsung My Files; in split screen it opens in the other half.
4. Settings → "Carpetas de anime" shows the chosen folder, how many animes open their folder, and when it was last checked, with "Volver a buscar" and "Cambiar carpeta". "Ver detalle" lists the folders without anime, the folders more than one anime points to, and how each matched folder was found.
5. When the SD card is missing or Android revokes the grant, a red banner says so, and "Elegir de nuevo" goes straight to the picker. Folder buttons disappear until then; page buttons keep working.

## Matching rules

The folder index walks the chosen root up to 3 levels, skipping hidden folders and files. Each anime is resolved in this order, and the first step that finds anything decides:

| Step | Source | Notes |
|------|--------|-------|
| Path | `folderRelative` from the bridge | The folder whose path shares the most trailing segments, so a tablet root at another level still matches. |
| Exact name | basename of `carpeta`, case-insensitive | |
| Normalized name | accents, punctuation and spaces dropped | Never for names with non-latin letters. |

- A step that finds two or more folders resolves nothing.
- A folder two **active** animes resolve to gives neither the button, and is listed under "CON MÁS DE UN ANIME".
- Inactive animes (`activo = 0`) stay rows on mobile. They mark the folder they use as used (it is not listed as without anime), but they never get a button, never make a folder shared, and do not count in the Settings totals.
- Subfolders of a matched folder are its content, not findings.

## Folders that arrive after their anime

An anime can reach the tablet before its folder does: a Season create arrives before its first episode makes the folder on the PC, and the copy to the SD card comes later still. The full walk runs once per launch, so the app checks again in two moments, with no timers or delays:

- **An incoming event of that anime.** When a remote change is applied to an anime (its `last_applied_change_ms` changes), and that anime is active, has a `folderRelative`, and its folder name is not in the index.
- **Returning to the app.** Every such pending anime is checked.

A check lists only the folder where the anime's folder is expected (its deepest indexed parent, usually the root): one provider query per parent, shared by every pending anime in it. Only when an expected folder is there does the full walk run again. Animes whose folder never reaches the tablet stay pending and cost that one query per own event. "Volver a buscar" in Settings remains the manual fallback.

Limitation: when the tablet root sits above the bridge library root (for example `Videos` instead of `Videos/Anime`), a one-segment `folderRelative` is expected directly in the root and the check never finds it; "Volver a buscar" does.

## Where the code lives

| Concern | Path |
|---------|------|
| Root and hint preferences (`app_preferences`) | `src/features/anime-folders/anime-folders-preferences.helpers.ts` |
| Index, resolution, summary (pure) | `src/features/anime-folders/anime-folders.helpers.ts` |
| SAF, My Files and browser seam | `src/features/anime-folders/anime-folders-io.helpers.ts` |
| Native folder lister (one query per folder) | `modules/saf-lister/` |
| Shared index state (one walk at a time, last index kept while refreshing) | `src/features/anime-folders/anime-folders.store.ts` |
| Hooks | `use-anime-folders.ts`, `use-anime-folder-resolution.ts`, `use-anime-folder-arrival.ts` (late folders, mounted by the anime list) |
| UI | `src/features/anime-folders/ui/` (banner, setup sheet, Settings card, detail screen) |
| Detail route | `src/app/(tabs)/anime-folders.tsx` |

## Device notes

- Folders are listed by the local native module `modules/saf-lister`: one `DocumentsContract` children query per folder (name and MIME type together), run off the JS thread. expo-file-system's `Directory.list()` is not used for the walk: it is a synchronous JS-thread call with one provider query per child, which on the tablet meant 558 queries, 5.7 s, and a frozen UI. The index lives in memory and the list renders with the last known index while a refresh runs. Cold start shows no folder buttons until the first walk finishes.
- My Files is opened with `samsung.myfiles.intent.action.LAUNCH_MY_FILES` and `START_PATH`, flags `NEW_TASK | LAUNCH_ADJACENT`. This is Samsung-only; on another launcher the button shows an error alert.
- `folderRelative` is optional on the bridge contract. A bridge that does not send it still works through name matching.
