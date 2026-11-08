# Changelog

All notable changes to Enhance Prompt. Versions follow [semver](https://semver.org); each
version is a `vX.Y.Z` git tag and a GitHub release with these notes.

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
