# Troubleshooting & FAQ

## I can't find the panel

- Press `Ctrl+L` (`⌘L` on macOS) to open the right sidebar, then click the **lightbulb** tab.
- Make sure the plugin is enabled under **Settings → Plugins → Enhance Prompt**.

## Where do I update it?

**Settings → Plugins → Enhance Prompt.** Updates that ask for nothing new install by themselves within about 6 hours. An update that adds commands or settings waits for you and shows **Update needs review**; open the plugin and approve it.

From a terminal:

```bash
orca plugin update cattfan.enhance-prompt
# If it prints an --approve command, run that command to confirm.
```

## The status bar menu has no entry for Enhance Prompt

Orca's status bar right-click menu lists only Orca's own items. Use **Status bar item** in [Settings](settings.md#status-bar), or the command **Enhance Prompt: Show / hide status bar item**.

## "No model yet" or "No API key yet"

Open the **Models** tab and add a model: click a CLI under **Use your subscription**, or **Add model** with an API key. See [Models](models.md).

## A subscription CLI fails

- Run it once in a terminal (`claude`, `codex`, `gemini`) and sign in. An error ending in "run it once in a terminal to sign in" means exactly that.
- "was not found": Orca can't see the CLI on its `PATH`. Edit the model and set the full path in **Command** (for example `~/.local/bin/claude`).
- A quota or rate-limit error comes from your plan. With [fallback](models.md#fallback), the next model answers.

## The model list is empty or old

- API presets need a key before they can list models: paste it in the form, or save it and reopen.
- Click **Refresh model list** (↻). Lists are cached for a day.
- You can always pick **Other (type the id)…**.

## The prompt names the wrong files

- Use **Deep** or **Max** and write the names you know, such as `` `LoginForm` `` or `src/auth/`.
- Untick unrelated items in the context list (**Options**) and enhance again.
- For a remote (SSH or WSL) workspace, project files are not readable; see [Remote workspaces](context-levels.md#remote-workspaces).

## Sending puts each line in a separate message

Your agent's terminal doesn't support bracketed paste. Set **How to send multi-line prompts** to **Single line** in [Settings](settings.md#sending).

## Auto-enhance does nothing

- It only changes prompts Orca sends (launch, task, orchestration). Prompts you type are never hooked.
- In AI mode, the hook model must answer within 2 seconds, and CLI models are skipped. Check the reason with `orca plugin logs cattfan.enhance-prompt`.

## Where are the logs?

```bash
orca plugin logs cattfan.enhance-prompt
```
