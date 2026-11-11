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
- **Attached files** are read only because the person attached them: the panel uploads them
  (`attachments.put`) and a run reads its `files` only from the attachments folder (`loadFiles` in
  `src/attachments.ts` refuses any other path). An image is recognised by its bytes (`sniffImage`),
  and every enhanced prompt lists the images' paths for the agent.
- **Every new read checks its Privacy switch** (`settings.privacy.*` in the worker: project files,
  git, terminal output, environment keys, online model lists, history). The Preview, the run and
  the auto-enhance hook must all go through the same check. Add a test in `src/privacy.test.ts`.
- **Request inputs are plain JSON**: no `undefined` values (leave the key out), no class instances.
  Requests and events are declared once in `src/protocol.ts`.
- **`terminal.sendText` takes at most 4096 characters per call**: send through `terminalChunks`
  (`SEND_CHUNK` = 4000) and `sendPieces`, which also closes a bracketed paste left open. Text typed
  into a terminal goes through `terminalSafe` (no control characters from a model): what the panel
  sends, the prompt of a new agent, and the auto-enhance hook's rewrite, which Orca types. The hook
  never replaces a prompt with an empty one.
- **Project files are read with `readText`** (`src/context/files.ts`): it refuses secret files by
  name, and a link that leads out of the workspace or to a secret file. A new read of a project
  file goes through it.
- **A CLI model runs in an empty temporary folder** and knows that folder (its path, "not a git
  repository", the platform): `runCli` ends the instructions with `NOT_THE_PROJECT` (`src/cli.ts`),
  so none of it is taken for the person's project and written into a prompt.
- **The rewriter writes for an agent that has the whole project.** With little or no context (the
  Off level, a remote workspace, project files switched off) a model likes to say so in the prompt
  ("no project context was provided, so locate…"), and the agent reads that as a statement about
  its own project. A rule in `BASE` (`src/prompts.ts`) and the last sentence of `NOT_THE_PROJECT`
  forbid it; `scripts/eval-prompts.mjs` has a case with no context and checks every case for it.
- **Orca names a workspace two ways.** `workspace.list` answers `identity:…` for a Git worktree,
  while events and hooks (`agent.status.changed`, `agent.tool.after`, `editor.save.before`,
  `workspace.removed`) carry the worktree's own id, `<repository id>::<path>`, and the same folder
  comes with either kind of slash. Never compare two workspace ids with `===`: `namesWorkspace` and
  `workspaceKey` (`src/workspaces.ts`) meet at the path. `workspace.readContext` gives the focus no
  id at all, only a name and a branch that several projects share ("main" on "main"), so the
  focused workspace is found by its terminals (`src/context/terminals.ts`: what Orca's agent events
  said, kept in storage), and only then by what the panel noted or the person picked. Tests use
  both id shapes, as the real Orca does; a mock where they are equal hides this.
- **What belongs to a project is kept under the project's name**, never under the workspace's:
  the workspace of every project's first checkout is called "main". A rule is `project:<name>`
  (`src/rules.ts`; `<name>` is the repository's name from `workspace.list`), and the panel calls a
  project by that name. While it is not known which of several same-named projects is open, the
  project is null: nothing of one project is used in another. A scope without `project:` was saved
  before 2.6.5 and still means a workspace's name; it is not converted, since nothing says which
  project it was meant for.
- **One request of a panel waits at most 120 s** (`PANEL_REQUEST_LIMIT_MS`: Orca's limit), but a
  run is not tied to one request. The panel says it keeps waiting (`resumable`); a run that
  outlasts `RUN_LIMITS.sliceMs` is answered `pending` and goes on in the worker, and the panel asks
  again (`resume`) until it is done, `RUN_LIMITS.totalMs` at most (`enhanceRequest` in
  `src/worker.ts`). A run lives only while a panel waits for it: cancelled, or not asked about for
  `RUN_LIMITS.orphanMs`, it is stopped and nothing is saved. A caller that does not say it keeps
  waiting gets its answer within one request (`RUN_LIMITS.budgetMs`). The auto-enhance hook has 2 s
  (`HOOK_BUDGET_MS`). The per-model timeout keeps time for the model that comes next; the last
  model of a chain has no next and may use the rest of the run (`runChain` in `src/models.ts`).
- **A thrown error reaches the panel as its code and its text, nothing else**: Orca passes no other
  field of the error on (the test host does, which hid this). A worker error for the panel is made
  with `hostError`, whose text carries the message after the English sentence (`withMessage` in
  `src/messages.ts`); the panel reads it with `message()` (`src/panel/state.ts`) and shows it in
  its own language. A step's detail in the progress card is not translated: put names and counts
  there, never a sentence.
- **The manifest asks for nothing new without a decision**: when an update's manifest has a new
  capability, command, panel, hook, event, status bar item or setting, Orca asks every user to
  approve again and installs nothing until they do ("Update needs review"), so they miss the
  version's fixes too. A preference of the panel lives in the panel's state (a `persist: 'plugin'`
  atom), not in `contributes.settings`. `src/manifest.test.ts` holds the approved lists; when one
  must grow, say in the changelog that Orca will ask (as 2.5.0 did).
- **Never commit temporary files**: scratch tests or measurements (`src/zz-*.test.ts`, timing
  scripts) stay out of git. `scripts/release.mjs` refuses to run while anything but
  `orca-plugin.json`, `CHANGELOG.md` and `src/version.ts` is changed or untracked.

## End-to-end in the real Orca

`node scripts/e2e.mjs` loads this folder into the running Orca as a development plugin
(`local.enhance-prompt`, next to the installed one, with its own empty storage), drives its worker,
hook and panel through Orca (`dev request`, `dev hook`, `shot`), then unloads it. It only reads: no
model call, no terminal send, nothing saved. The first run prints the approval fingerprint Orca asks
for; approve it yourself, then run `node scripts/e2e.mjs --approve <fingerprint>`.

## Live preview

`node scripts/eval-prompts.mjs` runs a few fixed cases through a real model (Claude Code, `haiku`, your
subscription) and checks the output mechanically (no preamble, right language, no invented paths,
details kept, length, structure headings). Run it after changing `src/prompts.ts` or what a CLI is
told in `src/cli.ts`.

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
3. Translate that section into `docs/changelog/CHANGELOG.vi.md` and `CHANGELOG.zh-CN.md` (What's new
   reads them), run `npm run web:build`, and commit the two translations with the rebuilt
   `src/web-dist`. The three files of steps 1 and 2 stay uncommitted: the release commits them.
4. Run `node scripts/release.mjs X.Y.Z`. It refuses to start unless you are on `main`, nothing but
   `orca-plugin.json`, `CHANGELOG.md` and `src/version.ts` is changed or untracked, and X.Y.Z is exactly the next patch, minor or major after
   the latest `v*` tag (odometer rule; see `scripts/release-lib.mjs`). It then builds the panel again
   and stops if that changes `src/web-dist` (the committed panel was older than the sources: commit
   the rebuilt one and run it again), runs tsc, the tests, `orca plugin check` and
   `orca plugin validate`, commits only those three files with the subject
   `vX.Y.Z: <first sentence of the first changelog bullet>` (never cut) and the section as body,
   tags, pushes `main` and the tag, and creates the GitHub release from the changelog section.
5. Check the listing: <https://www.onorca.dev/plugins/cattfan/orca-enhance-prompt>

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
`src/panel/`, not in a component: of `web/src`, `orca plugin test` covers only `store.ts`.
Pasted, dropped or picked files go to the worker in chunks (`attachments.put`, `src/attachments.ts`)
and reach the run as `files`. Their copies live in a temporary folder (`ATTACHMENTS_DIR`: a day at
most, and gone with Delete everything); under the test runner that folder is the test file's own.

```sh
npm run web:install   # once
npm run web:dev       # http://localhost:5174 with sample data (see Live preview)
npm run web:build     # then orca plugin dev load . to see it in Orca
```

Its strings go through `t()`; translations live in `src/i18n-dict.ts`.
