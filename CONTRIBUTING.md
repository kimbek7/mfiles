# Contributing to Mfiles

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Getting started

You need Windows and Node.js 22 or newer.

```
npm install
npm run dev
```

## Before you open a pull request

Open an issue first for larger changes, so the approach can be agreed before you invest time.

Run the same checks as CI:

```
npm run format:check
npm run typecheck
npm test
npm run e2e
```

## Ground rules

**File safety comes first.** Mfiles moves real user files, so changes to `src/core/executor.ts`, `src/core/journal.ts`, `src/core/planner.ts` or `src/core/safety.ts` need tests. The app must never overwrite a file, and every move must stay undoable after an interruption. Extend the crash recovery tests in `tests/core/plan-execute.test.ts` when you add a step to a move.

**Keep `src/core` free of Electron.** It is plain TypeScript tested on real temporary folders. All file work runs in the worker, and the interface never touches the file system.

**Add text to both languages.** Interface strings live in `src/shared/i18n.ts`, in English and Polish. A test fails when the dictionaries differ or when Polish text appears elsewhere in the code.

**Write in English.** This covers code, comments, documentation and commit messages.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `fix: keep subtitles next to renamed videos`.

## Reporting bugs

Use the issue template and include the steps, the expected and actual result, and the app version. Remove personal paths and file names from logs and screenshots.
