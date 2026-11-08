# Changelog

All notable changes to Enhance Prompt. Versions follow [semver](https://semver.org); each
version is a `vX.Y.Z` git tag and a GitHub release with these notes.

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

[1.2.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.2.0
[1.1.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.1.0
[1.0.0]: https://github.com/cattfan/orca-enhance-prompt/releases/tag/v1.0.0
