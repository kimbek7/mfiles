# Mfiles

A Windows desktop app for organizing files in a folder or on a whole drive. It shows the scan as a live map, and during sorting files flow as particles into their target groups.

## How it works

1. **Scan:** the folder map grows live. Colors stand for file types, and after the scan you can click a folder to zoom in.
2. **Plan:** choose the grouping (type, year, month, size, in any order) and review paths before and after. Nothing changes on disk at this stage.
3. **Simulation (optional):** the full animation without touching any files.
4. **Sorting:** files go to `<selected folder>\_Posortowane` by default.
5. **Undo:** available right away and later from the history, also after restarting the app.

## How context is preserved

Organizing does not detach files from what they are about:

- **Topic folders:** a folder with a meaningful name (`Klienci`, `Wakacje 2023`) moves as a whole to `Tematy`, and its contents stay unchanged.
- **Generic folders:** `Pobrane`, `Pulpit`, `Nowy folder` and auto-generated names are split, and their subfolders are evaluated separately. Only loose files are grouped by type and date.
- **Your decision:** on the plan screen every folder can be set to **W całości** (whole), **Zostaw** (keep) or **Rozbij** (split), with an immediate preview. When organizing a whole drive, topics stay in place by default.
- **Companion files:** subtitles, photo metadata and `page_files` folders follow their main file.
- **Duplicates:** a copy inside a topic always wins, and only loose copies go to `_Duplikaty`.
- **Change list:** `_Spis-<session>.csv` is created in the target folder with paths before and after. It opens in Excel, and undo removes it.

Context comes only from paths and names. The app does not read document contents for this purpose.

## Running

```
npm install
npm run dev
```

`npm run dist` puts the `.exe` packages (installer and portable version) in `dist/`. The files are unsigned, so SmartScreen shows a warning on first launch.

## File safety guarantees

- Nothing is overwritten: a name collision produces ` (2)`.
- Nothing is deleted, except the original after a hash-verified copy to another drive. Duplicates are only moved to `_Duplikaty`.
- Every operation is recorded in the journal at `%APPDATA%\mfiles\journal` before it runs. After a crash the app offers to finish undoing.
- Folders with `.git`, `package.json`, `.sln`, `.csproj` etc. and portable apps (`.exe` + `.dll`) move as a whole.
- A file changed after the plan was built, or locked by another program, is skipped and reported.
- System folders, `AppData`, symlinks and junctions are skipped. File contents are not read under OneDrive.

## Structure

| Folder | Contents |
|---|---|
| `src/core` | logic without Electron: scan, classification, duplicates, context, plan, execution, journal |
| `src/main` | main process and the worker doing all file work |
| `src/preload` | narrow API for the interface |
| `src/renderer` | React and the PixiJS scene |

## Tests

```
npm test                                  # core, including interrupting every step
npm run e2e                               # full path on the built app
$env:MFILES_SECOND_VOLUME='D:\'; npm test # adds moving to a real second drive
$env:MFILES_PERF=30000; npx playwright test perf.spec   # performance on real files
```

## Limitations

- Windows only.
- No custom rules, and no detection of similar but non-identical photos.
- Folder recognition relies on names and can be wrong, so every decision is visible and can be changed in the plan.
- Empty source folders remain after sorting, and undo reuses them.
- Moving flushes the journal to disk for every file. Measured throughput is about 300 files per second, so a million files would take around an hour.
