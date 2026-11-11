# Troubleshooting & FAQ

## I can't find the panel

- Press `Ctrl+L` (`⌘L` on macOS) to open the right sidebar, then click the **lightbulb** tab.
- Make sure the plugin is enabled under **Settings → Plugins → Enhance Prompt**.

## Where do I update it?

It depends on how you installed it.

- **From the catalog** (Settings → Plugins, or **Open in Orca**): Orca updates it by itself while its setting **Update plugins automatically** is on. A new version installs about 12 hours after Orca first sees it in the catalog; Orca looks at startup and every 6 hours. To have it sooner, open **Settings → Plugins → Enhance Prompt** and click **Update**.
- **From the GitHub link** (`orca plugin install cattfan/orca-enhance-prompt`, or the repository's address): Orca never updates it by itself. Run the command below, or install the same link again: both move it to the newest release.

```bash
orca plugin update cattfan.enhance-prompt
# If it prints an --approve command, run that command to confirm.
```

An update that asks for nothing new keeps your approval. One that adds commands or settings waits for you: Orca shows **Update needs review**, and the command above prints what it asks for instead of installing. Open the plugin and approve it.

## It asks which folder the project is in

Orca tells a plugin the open workspace's name and branch, not its folder. When several of your projects share both (every project's first checkout is "main" on "main"), that is not enough to tell them apart.

- The plugin knows the folder as soon as an agent has run in one of that workspace's terminals: Orca reports which workspace an agent's terminal is in, and the plugin remembers it.
- Until then it asks once. Pick the project in the list (each entry is the project's name and its folder); the answer is kept for that workspace's terminals.
- Before 2.6.4 it kept asking, also in a project you had already picked: update the plugin.

## The status bar menu has no entry for Enhance Prompt

Orca's status bar right-click menu lists only Orca's own items. Use **Status bar item** in [Settings](settings.md#status-bar), or the command **Enhance Prompt: Show / hide status bar item**.

## "No model yet" or "No API key yet"

Open the **Models** tab and add a model: click a CLI under **Use your subscription**, or **Add model** with an API key. See [Models](models.md).

## A subscription CLI fails

- Run it once in a terminal (`claude`, `codex`, `gemini`) and sign in. An error ending in "run it once in a terminal to sign in" means exactly that.
- "was not found": Orca can't see the CLI on its `PATH`. Edit the model and set the full path in **Command** (for example `~/.local/bin/claude`).
- A quota or rate-limit error comes from your plan. With [fallback](models.md#fallback), the next model answers.

## "… did not answer within … s"

The model took longer than the run could wait. A run in the panel may take up to 5 minutes in all (it is not held to the 2 minutes Orca gives one request: the panel keeps asking until the prompt is there, and **Cancel** stops it at any time). A model with another one after it gets **Timeout per model** (60 s by default, in [Settings](settings.md#models)) so the next still has time, and the last one to try gets what is left.

- Press **Try again**: a model that usually answers in half a minute can be slow for one run.
- Pick a lower context level (the Max level sends the most), or a faster model for this prompt.
- With several models, raise **Timeout per model** if the first one is cut too early.

## "… reached its limit of … tokens before it finished"

The answer stopped at the model's **Max tokens**. Models that think before they answer use part of that limit for thinking. Open the model in the **Models** tab (⋮ → **Edit**) and raise **Max tokens**; models added before 2.5.4 were created with 2,000, new ones get 8,000.

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
