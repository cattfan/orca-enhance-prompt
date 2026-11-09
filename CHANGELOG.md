# Changelog

All notable changes to Enhance Prompt. Versions count like an odometer: minor and patch are digits 0-9 that carry over (1.9.0 is followed by
2.0.0, 13.9.9 by 14.0.0). Each version is a `vX.Y.Z` git tag and a GitHub release with these notes.

## [2.4.0] - 2026-11-09

### Changed

- The web panel replaces the old panel: Orca now shows one Enhance Prompt panel (lightbulb icon) with paste, drop and file attachments, Enter to enhance, toasts and editable structures.

## [2.3.1] - 2026-11-09

### Changed

- The web panel's sidebar icon is a lightning bolt instead of a globe, so it reads as a tool rather than a web page.

## [2.3.0] - 2026-11-09

### Added

- A new web panel, Enhance Prompt (web), drawn with React and shadcn/ReUI next to the existing one: paste a screenshot, drop files or attach them with the paperclip, and press Enter to enhance (Shift+Enter for a new line).
- Attached files of any kind (up to 8, 10 MB each): images go to models that read images, short text files join the context, and the enhanced prompt lists every file's path so your agent can open it.
- Built-in prompt structures can be edited, and restored to their default.
- The Custom only style's instructions can be written in the panel's options.

### Changed

- In the web panel, rules apply to the project you are in, notices are toasts, and the colours are neutral black and white.
- A project can keep up to 1000 rules instead of 50.

### Notes

- Translations now live in src/i18n-dict.ts, shared by both panels. The web panel's source is in web/ and builds into src/web-dist (npm run web:build).

## [2.2.2] - 2026-11-09

### Changed

- The composer's tools are labelled buttons under the prompt box (Images, Fix error, Options, Preview) instead of four bare icons; Enhance sits next to the model menu.
- Notices are a compact tinted line with a close button, without the untranslated "Note" heading.
- Preview unfolds the context list (whose title already gives the items and characters) instead of showing a notice with the same counts.

## [2.2.1] - 2026-11-09

### Fixed

- Project context works again on current Orca: Orca now names this machine's workspaces "local" instead of leaving the host empty, so every workspace was taken for an SSH/WSL one and the rules, git, code search and AI file picker steps were all skipped.
- Several workspaces with the same name and branch (several checkouts on "main") are told apart: the panel learns each terminal's workspace from Orca's agent events, and when it still cannot tell, asks once which folder the project is in.

### Changed

- The explanation line under the progress steps is gone; the ≈ next to the model's share still marks the estimate.

## [2.2.0] - 2026-11-09

### Added

- Attach images to a prompt: press the upload icon and paste the full path of a PNG, JPEG, GIF or WebP file (up to 4 images, 5 MB each). Models that read images get them (Anthropic, and the OpenAI, OpenRouter and Gemini presets; Codex CLI with `-i`), others get their paths, and the enhanced prompt always lists the paths so your agent can open them. A missing, wrong-type or too large file is refused with the reason before any model call.
- The progress card shows percentages: the total and every step, with a small bar under the running step. Steps that can be counted move as they go (git commands, words searched, project read); the model call is an estimate marked ≈ that reaches 100% only with the answer. A cancel or error keeps the percentage reached.
- A user guide with pictures: docs/user-guide.md.

### Changed

- New flat logo (indigo tile, white prompt, amber spark) and flat colours in the listing pictures: no gradients.
- "Enhance Prompt" is a name, so it stays the same in every language: the panel's header shows it in English, Vietnamese and Chinese, and so does the status bar.

### Notes

- `npm run mock:progress` (or http://localhost:5173/mock-progress with `npm run dev`) plays the progress card through simulated runs; `node scripts/make-guide-images.mjs` draws the guide's pictures.

## [2.1.1] - 2026-11-09

### Fixed

- An enhanced prompt stays in the project it was written in. Switching projects keeps each project's draft and result apart, so Send can no longer paste one project's prompt into another project's agent; an answer that arrives after you switched waits for its own project, and one for a project that was closed is dropped.

### Added

- The panel shows its version next to the title (for example "Enhance v2.1.1").
- A Feedback section (gear icon) with a button to open an issue on GitHub; the READMEs ask for issues too.

## [2.1.0] - 2026-11-09

### Added

- Fix this error: press the bug icon, pick the terminal where the build, tests or dev server failed, and Enhance reads the latest error (up to 150 lines) and writes a bug-fix prompt for the agent you send to. It follows Privacy → Read terminal output.
- A Rules tab: your own rules for the rewriter, for every workspace or only one, used by every Enhance and by AI auto-enhance; and prompt structures, the headings a prompt is written under (built-in Task brief and Steps, or your own in any language), picked under Options in the composer.

### Changed

- Enhanced prompts follow Anthropic's and OpenAI's prompting guidance: the reasons you give are kept, instructions say what to do rather than what not to do, the tone is plain (no MUST / IMPORTANT), the agent is told when to stop and ask and to report the commands it ran with their output, and contradictory instructions are avoided.
- Enhanced prompts no longer copy your AGENTS.md or CLAUDE.md (the agent reads them itself), name one or two check commands instead of every one, leave open choices to the agent, and stay short when the request is small; Concise really is concise; Claude Code gets Markdown headings only.
- Deep and Max context is faster on large repositories: git status, log and diff run side by side.

### Notes

- `scripts/eval-prompts.mjs` checks the rewriter on fixed cases with a real model. Delete everything also deletes your rules and structures.

## [2.0.2] - 2026-11-09

### Fixed

- Cancel and timeouts now really stop a run: a subscription CLI is stopped with everything it started (also npm `.cmd` installs of Codex and Gemini on Windows), running git commands are stopped, and no step starts after a cancel.
- A run answers within the panel's 120 s wait, however many models the fallback chain tries; an answer that arrives after the panel gave up is dropped and not saved to history.
- "CLI default" really runs the CLI with its own default model (Claude Code used to get `--model haiku`). Disabling, enabling or switching a model from its card no longer writes the preset's URL and model into the profile.
- AI auto-enhance offers only enabled API models (subscription CLIs are too slow for its 2 s), and the panel warns when none can run instead of silently doing nothing.
- A model endpoint that answers with an HTML page or nothing (a proxy, a Wi-Fi sign-in page) gives a clear error and fallback moves on, also with "transient errors only".
- A `claude --help` that failed once is asked again; a cancelled CLI run leaves no temporary folder behind.

### Security

- Uncommitted changes to secret files (credentials, secrets, private keys, certificates) and to your exclude patterns are left out of the git diff sent at Deep and Max levels, including a secret file that was renamed.
- Git reads never run a repository's `core.fsmonitor` program.
- With "Save history" off, the draft and the last result are no longer kept on disk between panel runs; "Delete everything" clears them too.
- A context item you untick is not read at all (for example the terminal output).

### Changed

- History: deleting an entry and Clear history go through the worker, in order with new entries (none lost); Clear history asks for a second press; very long prompts are kept trimmed and the whole history is capped by size; the History tab shows 50 entries at a time with Show more.
- Errors, context notes and labels from the worker are shown in the panel's language (Vietnamese and Chinese included).
- Gemini CLI models come from `gemini models list` (Gemini CLI 0.67 and later) while online model lists are allowed.
- The Claude Code model list is fetched again as soon as Claude Code is updated, instead of after a day.

### Notes

- New tests (99 in all) and an end-to-end check in the real Orca (`scripts/e2e.mjs`); the release script commits only the manifest and the changelog, from a clean `main`, with the next version only.

## [2.0.1] - 2026-11-08

### Fixed

- The panel opens faster. Claude Code's model list is read straight from its program file bytes and remembered until that file changes, `claude --help` is read once per version, and the panel's simultaneous requests for one list share a single fetch. Stored-data counts load only when Privacy is opened.
- Text sent to a terminal no longer carries control characters (ESC, Ctrl-C, DEL and the like) from the model's answer, so it cannot type keystrokes into the agent.
- A send that fails part-way still closes its bracketed paste, so the agent is not left stuck in paste mode.
- Preview context now obeys the Privacy switches (project files, git, terminal output) exactly like a run.
- Auto-enhance (AI) no longer adds cached project context while "Read project files" is off.
- Model lists use API keys from environment variables only while that Privacy switch is on.
- History no longer loses an entry when a panel run and auto-enhance finish at the same time.
- Closing the panel during a run stops the model call; a cancelled run shows its open step as skipped, not failed.

## [2.0.0] - 2026-11-08

### Fixed
- **Sending a long prompt failed** with "text: Too big: expected string to have <=4096 characters": Orca
  accepts at most 4096 characters per terminal write, so prompts are now sent in pieces of up to 4,000
  characters, in order, still as one bracketed paste (cuts fall on line breaks and never split an emoji).

### Added
- **Live progress while enhancing**: a card shows each step as the worker really reaches it (workspace, project
  rules and stack, git, relevant code, AI file picker, terminal, then the model with its name and any fallback
  attempt), a bar that fills as steps finish, and a running timer. The model call reports no percentage of its
  own, so it is one step with the timer. It ends as done (the result shows "Done · x s"), failed (the card keeps
  the error with **Try again**) or cancelled; each run starts fresh, and progress from an older run is ignored.

### Changed
- **Privacy holds the settings**: the panel language and auto-enhance (mode and hook model) moved there from
  the Models section, next to the access switches and stored data. Its icon is the settings gear. Saved values
  are unchanged.
- **Composer redesign**: the prompt box and its toolbar sit in one card; the options button uses a filter icon
  (so it is not confused with the settings gear); Cancel replaces Enhance while running.
- Context item names, kinds and the worker's notes are shown in the panel's language.

## [1.9.0] - 2026-11-08

### Added
- **Every Claude model by name**, not just aliases: Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 5.5, then older ones
  (Opus 4.8, 4.7, 4.6, Sonnet 4.6, Haiku 4.5…), with their descriptions. Read from the model table built into
  the installed Claude Code (the list its /model menu shows), so it always matches your version. The aliases
  stay at the end as "sonnet (latest)" and so on.
- Menus show display names: "Claude Code · Fable 5.1" in the composer, "Fable 5.1 — For your toughest
  challenges" on the model card.

### Changed
- Cached model lists from earlier versions are ignored, so the new list shows up right away.

## [1.8.2] - 2026-11-08

### Fixed
- **Nothing is hidden in a narrow sidebar**: Orca's tab strip hid the tabs that did not fit, so the panel now
  uses an icon navigation (Enhance, History, Models, Privacy) with the section name on the left; it fits any
  width. The send row and the model card rows wrap instead of clipping.

### Added
- **Open in Orca** button and community-catalog install steps in the READMEs (English, Vietnamese, Chinese).
- The live preview takes `?width=` and `?theme=` in its URL.

## [1.8.1] - 2026-11-08

### Fixed
- Tabs no longer overflow a narrow sidebar: short names without counts ("Privacy" is "Riêng tư" in Vietnamese).
- Privacy switches are checkboxes, so every row lines up (Orca draws a switch right after its label).

### Changed
- **The plugin is about 6x smaller** (7.8 MB to 1.3 MB): the cover, screenshots and README pictures are JPEG,
  README pictures at 1.5x. The community directory holds large updates for review.

## [1.8.0] - 2026-11-08

### Added
- **Privacy tab with a switch for each kind of access**: read project files, run git, read terminal output,
  send to terminals, save history, use environment API keys, fetch model lists online. Orca approves access
  as a whole; these switches decide what the plugin actually uses, and the worker checks them before every
  read, send, save or download. Also in Settings as "Privacy: …".
- **What is stored, and wiping it**: counts of history entries, saved models, encrypted keys and cached model
  lists, with Clear history, Clear model lists and Delete everything (press twice).

### Changed
- **Much more compact panel** (about half the height):
  - No header; the language menu moved to the bottom of the Models tab.
  - The prompt box has no label; one toolbar row holds the model menu, Options (⚙), Preview (🔍) and Enhance.
  - Style, context, output language and "Press Enter after sending" open from ⚙.
  - The result card has copy, refine and clear as icons, and one row for the terminal and **Send**.
  - Model cards take two rows: position, name and actions; then the model menu and key status. Enable or
    disable with the pause/play icon.
  - The composer's model menu shows short names, such as "Claude Code · sonnet".

## [1.7.0] - 2026-11-08

### Changed
- **Reorder models in one click**: the number on each model card is now a position menu (#1, #2…); pick #1 to
  try a model first. The up/down arrows are gone. Orca's plugin UI has no drag and drop, so this is the
  fastest way to move a model.
- **Detailed model names** everywhere: the header shows the model that will answer, such as
  "Claude Code · sonnet" or "Auto: Claude Code · haiku"; the menus show the id and its description,
  such as "sonnet — Sonnet, newest".
- The model menu has its own row above **Enhance**, so long names never push the buttons around.

## [1.6.2] - 2026-11-08

### Changed
- Long help texts moved behind an info icon (ⓘ): hover to read, press to show it as a notice. Applies to the
  Models tab sections, its footer (now "More settings and privacy ⓘ") and the subscription CLI note in the
  model form.
- The live preview takes `?scenario=<name>` in its URL.

## [1.6.1] - 2026-11-08

### Added
- **Live UI preview on localhost** for development: `npm run dev` serves http://localhost:5173 with every
  panel scenario side by side, dark/light, adjustable width and folds, redrawn on every save in `src/`.

## [1.6.0] - 2026-11-08

### Added
- **Model menu next to Enhance**, like the model picker in ChatGPT or Claude: every model of every enabled
  profile, from its live list (Claude Code · Haiku / Sonnet / Opus / Fable, Codex · each catalog model,
  API models), plus **Auto**. The profile's own model is marked **default**.
- The picked model is used for that prompt only; the saved profile and the rest of the fallback chain keep
  their own models. The header badge shows the picked model.

### Changed
- The options fold now holds style, context and output language; **Preview context** is an icon button.

## [1.5.0] - 2026-11-08

### Changed
- **Redesigned Enhance tab** around one flow: write, enhance, review, send.
  - **Enhance** is the primary button; **Preview context** sits beside it.
  - Style, context, output language and model fold into one line that shows the current choice
    ("Bug fix · Deep · Auto"); open it for a labeled two-column picker.
  - The result is a card: the prompt, copy and clear at the top, then **Send to**, the Enter switch,
    **Send to agent** (primary) and **Refine**.
  - An empty state explains that nothing reaches the agent until you click Send, with **Send as is**.
- **Models tab in sections**: Your models, Fallback, Auto-enhance (with its hook model), Max context level.
- **New logo**: a dark tile like Orca's own icons, a prompt chevron and cursor, and a violet-to-cyan spark.
- Listing images and README pictures are now in the dark theme, matching the panel in Orca.

### Fixed
- "No terminals in this workspace", "Choose a terminal" and the Models tab footer were not translated.

## [1.4.0] - 2026-11-08

### Added
- **Model lists that stay current**: the Model field is a list of what each source offers today, so you no
  longer type model ids.
  - Claude Code: its aliases (`haiku`, `sonnet`, `opus`, `fable`…), which always point at the newest model.
    Read from `claude --help` and the Claude Code settings schema on schemastore.org, limited to your
    `availableModels`, with your default marked.
  - Codex CLI: `codex debug models`, the catalog Codex itself shows, with your `config.toml` model marked.
  - Gemini CLI: known models plus your `~/.gemini/settings.json` model.
  - APIs: the provider's `GET /models` (Anthropic `/v1/models`), newest first.
  - Cached for a day, with a Refresh button, and **Other (type the id)…** for anything unlisted.
- **Switch a model in place** from the menu on each model card.
- **Auto-enhance mode in the panel** (Models tab), next to fallback.
- **New icon**, from `assets/icon.svg`.
- **Docs in Orca's format**: a README with the same layout as Orca's (feature table, supported models,
  install), Vietnamese and Chinese READMEs, and pages for getting started, context levels, models,
  auto-enhance, settings, privacy and troubleshooting.

### Changed
- **Clicking the status bar item now opens the right sidebar**, where the panel lives; its tooltip explains
  where the panel, settings and updates are. To cycle auto-enhance, use the panel or the command palette.
- New command **Enhance Prompt: Show / hide the right sidebar**.

### Fixed
- The "CLI default" model option was dropped by Orca because its value was empty.
- Two strings in the model form were not translated.

## [1.3.0] - 2026-11-08

### Added
- **Panel in English, Tiếng Việt and 中文**: a language picker at the top right of the panel, and a
  "Panel language" setting (Auto follows Orca's language). Every label, button, hint and message is translated.
- **Output language per prompt**: same as the prompt, English, Vietnamese or Chinese, next to Style and
  Context (the setting still offers more languages as the default).
- **Status bar options**: Orca's status bar right-click menu only lists Orca's own items, so the new
  "Status bar item" setting shows the item with icon and text, icon only, or hides it. The item now shows a
  zap icon while auto-enhance is on, and its text and tooltip follow the panel language.
- Commands: `Auto-enhance with rules`, `Auto-enhance with AI`, `Show / hide status bar item`.
- **Listing images**: a cover and 3 screenshots (context, models, languages), plus a real capture in the README.
  `scripts/make-images.mjs` regenerates them from the panel's own component trees with sample data.

### Changed
- The selected tab, the last run, and the context list are kept when you switch to another sidebar tab and back.
- CLI models show "model · Claude Code CLI" instead of an empty URL.

## [1.2.0] - 2026-11-08

### Added
- **Use your subscription, no API key**: new model type that runs an agent CLI already signed
  in on this machine, in one-shot mode:
  - Claude Code (Claude Pro/Max): `claude -p`, no tools, no session saved, default model `haiku`.
  - Codex CLI (ChatGPT plan): `codex exec`, read-only sandbox, ephemeral session.
  - Gemini CLI (Google account): `gemini -p`.
  - Custom CLI: any command that reads the prompt on stdin and prints the answer.
- The Models tab detects installed CLIs (PATH plus common install folders) and adds one in one click.
- CLI models join the fallback chain like API models. The prompt is passed over stdin and the CLI runs
  in an empty temporary folder, so it loads no project rules, hooks or files of its own.

### Changed
- Relevant-code search is much more precise:
  - Each keyword is grepped separately and weighted by how rare it is in the repo (IDF), so a specific
    name like `agent.prompt.before` outweighs common words like "timeout" or "agent".
  - Dotted names (`agent.prompt.before`, `user.profile.update`) are kept as exact search terms.
  - Path matches count by keyword specificity.
  - Snippets are cut around the matching lines of only the chosen files.

### Notes
- Auto-enhance (2 s hook budget) skips CLI models because they take a few seconds to start.
- A CLI call uses the CLI's own quota. Codex adds its own large system prompt (about 45k tokens per call).

## [1.1.0] - 2026-11-08

### Added
- **5 project context levels** (Off, Basic, Standard, Deep, Max), as a default and per prompt:
  - Standard: agent rule files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules`,
    Copilot instructions), a README digest, stack and real commands, repo tree. Cached per workspace.
  - Deep: git status, recent commits, uncommitted diff, code relevant to the prompt.
  - Max: AI-picked files (two-step) and recent output of the target agent terminal.
- "Context used" list with per-item exclusion, and **Preview context**.
- **Multiple models**: 10 presets (OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral,
  Ollama, LM Studio, custom), reorder, enable/disable, test, per-prompt choice, a model for the hook,
  and a model for the file picker.
- **Fallback** between models, on any error or only on network/timeout/429/5xx.
- Agent-aware prompts for Claude Code, Codex, Gemini CLI and Aider.
- Settings: always-include files, exclude patterns, terminal lines, adapt to agent.

### Security
- `.env*`, `*.pem`, `*.key`, credential and secret files are never read, listed, grepped or diffed.

## [1.0.0] - 2026-11-08

### Added
- Enhance panel: write, enhance, edit, then send to an agent terminal, copy or refine.
- OpenAI-compatible and Anthropic APIs, with the key in Orca's encrypted secrets.
- 9 styles, output language, custom instructions.
- History with search, reuse, copy and delete.
- Auto-enhance hook for prompts Orca sends to agents (rules or AI), toggled from the status bar.
- Bracketed paste for multi-line prompts.

[2.4.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.4.0
[2.3.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.3.1
[2.3.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.3.0
[2.2.2]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.2.2
[2.2.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.2.1
[2.2.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.2.0
[2.1.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.1.1
[2.1.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.1.0
[2.0.2]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.0.2
[2.0.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.0.1
[2.0.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v2.0.0
[1.9.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.9.0
[1.8.2]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.8.2
[1.8.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.8.1
[1.8.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.8.0
[1.7.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.7.0
[1.6.2]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.6.2
[1.6.1]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.6.1
[1.6.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.6.0
[1.5.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.5.0
[1.4.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.4.0
[1.3.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.3.0
[1.2.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.2.0
[1.1.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.1.0
[1.0.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.0.0
