# Models

Enhance Prompt runs on models you choose: the subscription CLIs already signed in on your machine, any API key, or a local server. Manage them in the panel's **Models** tab.

## Subscription CLIs

If Claude Code, Codex or Gemini CLI is installed and signed in, it appears under **Use your subscription**. Click it to add it, then click **Test** (✓) on its card.

| CLI | Plan it uses | How it runs |
| --- | --- | --- |
| Claude Code | Claude Pro or Max | `claude -p` with no tools and no saved session |
| Codex CLI | ChatGPT | `codex exec` in a read-only sandbox, ephemeral |
| Gemini CLI | Your Google account | `gemini -p` |
| Custom CLI | Any | Your command; it must read the prompt on stdin and print the answer |

The prompt is passed on stdin and the CLI runs in an empty temporary folder, so it loads none of your project's rules, hooks or files on its own. The project context Enhance gathered is in the prompt.

Notes:

- A CLI takes a few seconds to start, so [auto-enhance](auto-enhance.md) skips CLI models.
- Each call counts against the CLI's own limits. Codex adds a large system prompt of its own to every call.
- If Orca can't find the CLI (common for apps started from the dock on macOS), set its full path in **Command** when you edit the model.

## API models

Click **Add model** and pick a preset:

| Preset | Endpoint | Key |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` |
| Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| DeepSeek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| Mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| Ollama | `http://localhost:11434/v1` | none |
| LM Studio | `http://localhost:1234/v1` | none |
| Custom | any OpenAI-compatible or Anthropic-style endpoint | optional |

- Keys you paste are stored in Orca's encrypted secrets and never shown again. Leave the field empty and the environment variable in the table is used instead.
- Endpoints must use `https`, except `http://localhost` for local servers.
- If you have no saved models, the plugin uses any of those environment variables it finds, and the Models tab says so.

## Model lists stay current

You don't type model ids. The **Model** field lists what each source offers today:

| Source | Where the list comes from |
| --- | --- |
| Claude Code | Its aliases (`haiku`, `sonnet`, `opus`, `fable`…), which always point at the newest model. Read from `claude --help` and the [Claude Code settings schema](https://www.schemastore.org/claude-code-settings.json), limited to your `availableModels` if you set one, with your default marked. |
| Codex CLI | `codex debug models`: the same catalog Codex shows, with your `config.toml` model marked. |
| Gemini CLI | Known models plus the one in `~/.gemini/settings.json`. |
| API presets | The provider's `GET /models` (Anthropic: `/v1/models`), newest first. |

Lists are cached for a day. Click **Refresh model list** (↻) next to the field to fetch them now. **Other (type the id)…** takes any id that is not listed. On each card, the model menu switches models in place.

## Fallback

Models are tried from top to bottom. The **#** menu on each card sets its position (pick **#1** to try it first), and the switch skips it.

> [!NOTE]
> Orca's plugin UI has no drag and drop, so the position is a menu: one click instead of a drag.

- **Fallback to the next model when one fails** (on by default).
- **Fall back on**:
  - **Any error**: a bad key, an unknown model, a network error, a timeout, a rate limit, a server error.
  - **Only network, timeout, rate limit, 5xx**: a configuration mistake stops the chain, so you notice it.
- Models without a key are skipped.
- After an enhance, the panel shows which model answered and which ones failed first, for example *Fell back after: OpenAI (429: rate limit)*.

The **Model** menu on the Enhance tab can pick one model for a single prompt. With fallback on, the rest of the chain still backs it up.

## Models for special jobs

With two or more models:

- **Auto-enhance hook model**: the model [auto-enhance](auto-enhance.md) uses. It must answer in under 2 seconds, so pick a fast API model such as Groq or a small OpenAI model.
- **File picker model**: the model that picks files at the [Max context level](context-levels.md#max).

## Test a model

**Test** (✓) on a card sends a tiny request through that model alone and reports the time, or the exact error.
