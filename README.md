# Enhance Prompt for Orca

Turn a rough idea into a clear, structured prompt for your coding agents (Claude Code, Codex,
Gemini CLI, OpenCode…), then send it straight to an agent terminal in [Orca](https://github.com/stablyai/orca).

- **Enhance panel** in the right sidebar: write → Enhance (Ctrl/Cmd+Enter) → edit → **Send to agent** / Copy / Refine.
- **Styles**: Balanced, Concise, Detailed spec, Bug fix, New feature, Refactor, Code review, Plan first, Custom.
- **Project-aware**: optionally adds the workspace name/branch, `AGENTS.md` / `CLAUDE.md` / `README.md`
  (first few KB), the top-level file list, and recent lines of the target terminal.
- **Your own model**: any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, DeepSeek, Ollama,
  LM Studio…) or Anthropic. The key is stored in Orca's encrypted secrets (or read from
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`).
- **History** with search, reuse, copy and delete.
- **Auto-enhance** (off by default) for prompts *Orca* sends to agents (launch, task and orchestration
  prompts) through the `agent.prompt.before` hook:
  - *Rules*: instantly appends your text (e.g. "run the tests and summarize the changes").
  - *AI*: rewrites with the model. Orca waits at most 2 s for a hook, so use a fast model; on timeout
    the original prompt is sent unchanged.
  - Toggle it from the status bar item or the command palette.
  - Orca never hooks prompts you type yourself into a terminal; use the panel for those.
- **Sending**: multi-line prompts use bracketed paste so agent TUIs keep the line breaks (or raw /
  single line). "Press Enter after sending" is off by default so you can review first.

## Setup

1. Install from the Orca plugin directory (or `orca plugin install cattfan/orca-enhance-prompt`).
2. Open the **Enhance Prompt** panel → **Setup** tab: choose a provider, a model and a base URL, paste an API key, then **Test connection**.
3. The other options are in Settings → Plugins → Enhance Prompt.

| Provider | Base URL | Example model |
| --- | --- | --- |
| OpenAI | *(empty)* | `gpt-4.1-mini` |
| Anthropic | *(empty)* | `claude-haiku-4-5` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4.1-mini` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local, no key) | `http://localhost:11434/v1` | `qwen2.5-coder` |

## Permissions

| Capability | Why |
| --- | --- |
| `storage:own`, `settings:own`, `secrets:own` | History, settings, API key |
| `workspace:read` | Workspace name and branch, and listing its terminals as targets |
| `agent:read` | Listing the agent terminals you can send to |
| `terminal:send` | Typing the prompt into the agent terminal you pick |
| `terminal:read` | Only when "Terminal lines as context" is above 0 |

## Privacy

There is no tracking, analytics or telemetry. Your prompt, plus whatever context you turned on,
goes only to the API endpoint you configured. API keys stay in Orca's encrypted secrets store.
Copy uses the OS clipboard tool (`clip.exe`, `pbcopy`, `wl-copy`/`xclip`/`xsel`) with the text
passed on stdin.

## Development

```sh
npm install          # TypeScript + @types/node for type checking only
orca plugin types .  # writes .orca/types
npm run typecheck
npm test             # orca plugin test .
npm run check        # orca plugin check .
orca plugin dev watch . --check
```

There is no build step: Orca transpiles `src/*.ts(x)` when it loads them.

## Release

```sh
orca plugin validate .
# bump "version" in orca-plugin.json, commit, then:
git tag -a v1.0.0 -m v1.0.0 && git push origin v1.0.0
gh repo edit --add-topic orca-plugin
```

Listing status: https://www.onorca.dev/plugins/cattfan/orca-enhance-prompt

## License

MIT
