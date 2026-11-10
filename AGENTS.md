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
  entries in the same change. `src/i18n.test.tsx` fails on a missing key, and on an entry nothing
  shows any more: it reads every `t('…')` in `src/panel/` and `web/src/`, and the tables of texts
  passed to `t()` by variable (a new table is added to its list). Worker messages the panel shows
  are translated there too, so keep their wording in step.
- **The name "Enhance Prompt" is a brand**: use `BRAND` from `src/brand.ts`, never `t()`; text that
  names the plugin keeps the name as it is in every language (`src/i18n.test.tsx` checks it).
- **Flat colours only**: no gradients in the logo (`assets/icon.png`, cut from `assets/art/logo-source.jpg` by `scripts/cut-icon.ps1`; vector in
  `assets/icon.svg`), or the pictures (`scripts/make-listing.mjs`: listing, README and guide).
- **Attached images** are read only because the person picked them (by path; Orca panels have no file
  picker): `src/images.ts` checks the path, type (by bytes) and size, and every enhanced prompt lists
  their paths for the agent.
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

`npm run web:dev` serves the panel at http://localhost:5174 on sample data (`web/src/mock-orca.ts`),
redrawn on every save, with no worker, model or network. The address sets what to look at:
`?lang=vi&theme=dark&width=360` (language, theme, a sidebar's width), `?tab=models` (a section),
`?demo=<prompt>` (types the prompt and runs it: the run card plays its steps; `&run=0` only types it),
`?options=1`, `?attach=1`, `?ask=allowAgentLaunch` (a confirmation dialog), and `?mock=1` keeps the
sample data even while Orca has the development plugin loaded (without it the page talks to that
plugin's real worker). `node scripts/shot-web.mjs [out.png] [width] [height] [query]` saves a picture
of it; `node scripts/make-listing.mjs` redraws every listing, README and guide picture from it.

## Releases

1. Bump `version` in `orca-plugin.json` and `VERSION` in `src/version.ts` (shown in the panel's header): patch for fixes, minor for features, major for breaking changes.
   Minor and patch are single digits 0-9 and carry over like an odometer: 1.8.9 -> 1.9.0,
   1.9.0 -> 2.0.0 (never 1.10.0), 13.9.9 -> 14.0.0.
2. Add a section at the top of `CHANGELOG.md` (Added / Changed / Fixed / Security / Notes) and its link at the bottom.
3. Run `node scripts/release.mjs X.Y.Z`. It refuses to start unless you are on `main`, nothing but
   those files (and `src/version.ts`) is changed or untracked, and X.Y.Z is exactly the next patch, minor or major after
   the latest `v*` tag (odometer rule; see `scripts/release-lib.mjs`). It then runs tsc, the tests,
   `orca plugin check` and `orca plugin validate`, commits only those two files with the subject
   `vX.Y.Z: <first sentence of the first changelog bullet>` (never cut) and the section as body,
   tags, pushes `main` and the tag, and creates the GitHub release from the changelog section.
4. Check the listing: <https://www.onorca.dev/plugins/cattfan/orca-enhance-prompt>

## Listing policy

The plugin must stay free, have no tracking or analytics, and contain no obfuscated code.
`publisher` is the repo owner, so leave it out of the manifest. Ids must not start with `orca-`.

## The panel (`enhance`, web)

The panel Orca shows is `ui: "html"`, built with React + Tailwind + shadcn/ReUI from `web/` into
`src/web-dist/` (committed: Orca runs no build step; minified, which the listing policy allows since the source is in `web/src`).
Run `npm run web:build` before committing a change under `web/`, and also after changing a file under
`src/` that the panel imports (`src/panel/*`, `src/i18n*.ts`, `src/messages.ts`, `src/presets.ts`,
`src/version.ts`…) or a changelog: they are all bundled. The build is reproducible, so a build that
leaves `src/web-dist` unchanged means it was up to date.

What the panel knows and does has no UI in it and lives in `src/panel/`: `state.ts` (the atoms),
`actions.ts` (what the buttons call), `view.ts` (labels, options and small decisions, as plain data)
and `setup.ts` (`wirePanel()`: Orca's events to the state, and the first requests). `web/src` only
draws that, and `web/src/orca-runtime.ts` stands in for the `orca` module inside the frame. The tests
run the same code on Orca's panel runtime with nothing drawn: `mountPanel()` from
`src/panel/testing.ts`, then call the actions and read the atoms. So anything worth a test goes in
`src/panel/`, not in a component: nothing in `web/src` is covered by `orca plugin test`.
Pasted, dropped or picked files go to the worker in chunks (`attachments.put`, `src/attachments.ts`)
and reach the run as `files`.

```sh
npm run web:install   # once
npm run web:dev       # http://localhost:5174 with sample data (see Live preview)
npm run web:build     # then orca plugin dev load . to see it in Orca
```

Its strings go through `t()`; translations live in `src/i18n-dict.ts`.
