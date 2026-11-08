# Privacy & permissions

Enhance Prompt has no tracking, analytics or telemetry, and no server of its own.

## Where your prompt goes

- Your prompt, plus the context items listed under **Context used**, is sent **only to the model you run**: the API endpoint of that model profile, or the subscription CLI on your machine, which talks to its own provider.
- With fallback on, a failed request is retried on your next model.
- Model lists are fetched from the same providers (`GET /models`), from the CLIs themselves, and, for Claude Code aliases, from the public [Claude Code settings schema](https://www.schemastore.org/claude-code-settings.json). Nothing about you or your project is sent with these.

## What is read on your machine

- At the Standard level and above: the agent rule files, README, manifest files and file list of the focused workspace, through read-only `git` commands (`ls-files`, `status`, `log`, `diff`, `grep`) and file reads.
- At the Max level: the last lines of the terminal you picked.
- **Never**: `.env*`, `*.pem`, `*.key`, `*.p12`, keystores, SSH keys, files named like `secret` or `credentials`, binary files, and anything matching your exclude patterns.
- `~/.claude/settings.json`, `~/.codex/config.toml` and `~/.gemini/settings.json`, only to read which model you use and which models you allow.

## What is stored

| Where | What |
| --- | --- |
| Orca's encrypted secrets | API keys you paste |
| The plugin's own storage | Model profiles, history, cached model lists |
| Orca settings | The options on the [Settings](settings.md) page |

To clear it yourself: **Clear history** in the History tab, **Delete** on each model card (removes its key too), and **Reset** for the plugin's settings in Orca.

## Permissions

| Capability | Why |
| --- | --- |
| `storage:own`, `settings:own`, `secrets:own` | Profiles, history, settings, API keys |
| `workspace:read` | Workspace name, branch and folder, its terminals, and keeping context warm when you switch workspace |
| `agent:read` | Listing agent terminals and knowing which agent you target |
| `terminal:send` | Typing the prompt into the terminal you pick in **Send to** |
| `terminal:read` | Max context level only: recent output of the target terminal |

The plugin runs as a worker process (`trusted-worker`), because it calls model APIs, runs CLIs and `git`, and reads project files. Orca asks you to approve it on install, and again when an update asks for more.

## Subscription CLIs

When you use a subscription CLI, the prompt is passed on stdin to a fixed command (`claude -p`, `codex exec --sandbox read-only`, `gemini -p`) running in an empty temporary folder that is deleted afterwards. Claude Code runs with no tools; Codex runs in a read-only sandbox.

## Clipboard

**Copy** uses your OS clipboard tool (`clip.exe`, `pbcopy`, `wl-copy`, `xclip` or `xsel`) with the text passed on stdin.
