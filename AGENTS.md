# Working on this plugin

Orca plugin (`trusted-worker`) with no build step: Orca transpiles `src/*.ts(x)` on load.
Docs: https://github.com/stablyai/orca/tree/main/docs/reference (plugin-*.md).

## Checks before every commit

```sh
orca plugin types .      # once, writes .orca/types
npx tsc -p .
orca plugin test .       # every *.test.ts(x) and *.test.mjs, src/ and scripts/
orca plugin check .
orca plugin validate .
```

The test suite usually finishes in seconds, but some tests start real processes (git, a fake CLI,
`taskkill`), and earlier runs on this machine have taken several minutes. Give it a generous timeout
(e.g. `timeout 300 orca plugin test .`) rather than assuming it hangs.

## Rules that must keep holding

- **Every UI string goes through `t('...')`** from `src/i18n.ts`, with its Vietnamese and Chinese
  entries in the same change. `src/i18n.test.tsx` fails on a missing key. Worker messages the panel
  shows are translated there too, so keep their wording in step.
- **Every new read checks its Privacy switch** (`settings.privacy.*` in the worker: project files,
  git, terminal output, environment keys, online model lists, history). The Preview, the run and
  the auto-enhance hook must all go through the same check. Add a test in `src/privacy.test.ts`.
- **Request inputs are plain JSON**: no `undefined` values (leave the key out), no class instances.
  Requests and events are declared once in `src/protocol.ts`.
- **`terminal.sendText` takes at most 4096 characters per call**: send through `terminalChunks`
  (`SEND_CHUNK` = 4000) and `sendPieces`, which also closes a bracketed paste left open. Text typed
  into a terminal goes through `terminalSafe` (no control characters from a model).
- **A panel waits at most 120 s** (`PANEL_REQUEST_LIMIT_MS`); a run must answer within
  `RUN_LIMITS.budgetMs`. The auto-enhance hook has 2 s (`HOOK_BUDGET_MS`).
- **Never commit temporary files**: scratch tests or measurements (`src/zz-*.test.ts`, timing
  scripts) stay out of git. `scripts/release.mjs` refuses to run while anything but
  `orca-plugin.json` and `CHANGELOG.md` is changed or untracked.

## End-to-end in the real Orca

`node scripts/e2e.mjs` loads this folder into the running Orca as a development plugin
(`local.enhance-prompt`, next to the installed one, with its own empty storage), drives its worker,
hook and panel through Orca (`dev request`, `dev hook`, `shot`), then unloads it. It only reads: no
model call, no terminal send, nothing saved. The first run prints the approval fingerprint Orca asks
for; approve it yourself, then run `node scripts/e2e.mjs --approve <fingerprint>`.

## Live preview

`node scripts/eval-prompts.mjs` runs a few fixed cases through a real model (Claude Code, `haiku`, your
subscription) and checks the output mechanically (no preamble, right language, no invented paths,
details kept, length, structure headings). Run it after changing `src/prompts.ts`.

`npm run dev` serves http://localhost:5173: the panel's scenarios from `src/panel.check.ts`, drawn by
`scripts/render-panel.mjs`, redrawn on every save. Add a scenario there to preview a new state.

## Releases

1. Bump `version` in `orca-plugin.json`: patch for fixes, minor for features, major for breaking changes.
   Minor and patch are single digits 0-9 and carry over like an odometer: 1.8.9 -> 1.9.0,
   1.9.0 -> 2.0.0 (never 1.10.0), 13.9.9 -> 14.0.0.
2. Add a section at the top of `CHANGELOG.md` (Added / Changed / Fixed / Security / Notes) and its link at the bottom.
3. Run `node scripts/release.mjs X.Y.Z`. It refuses to start unless you are on `main`, nothing but
   those two files is changed or untracked, and X.Y.Z is exactly the next patch, minor or major after
   the latest `v*` tag (odometer rule; see `scripts/release-lib.mjs`). It then runs tsc, the tests,
   `orca plugin check` and `orca plugin validate`, commits only those two files with the subject
   `vX.Y.Z: <first sentence of the first changelog bullet>` (never cut) and the section as body,
   tags, pushes `main` and the tag, and creates the GitHub release from the changelog section.
4. Check the listing: <https://www.onorca.dev/plugins/cattfan/orca-enhance-prompt>

## Listing policy

The plugin must stay free, have no tracking or analytics, and contain no obfuscated code.
`publisher` is the repo owner, so leave it out of the manifest. Ids must not start with `orca-`.
