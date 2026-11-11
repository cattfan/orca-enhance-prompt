# Auto-enhance

Auto-enhance rewrites the prompts **Orca itself** sends to agents, before they reach the agent: launch prompts, task and issue prompts, orchestration dispatches, and `orca terminal send` to an agent.

> [!IMPORTANT]
> Orca never lets plugins change a prompt you type yourself into an agent. For those, use the panel.

## Modes

| Mode | What happens |
| --- | --- |
| **Off** (default) | Prompts go through unchanged. |
| **Rules** | Your text is appended to every prompt, instantly. Good for standing rules such as "run the tests and summarize what you changed". |
| **AI** | The prompt is rewritten by your **Auto-enhance hook model**, with the cached project context of the focused workspace. |

Switch modes in any of these places:

- The panel's **Settings** section (gear icon): **Auto-enhance** (Off, Rules or AI).
- The command palette: **Enhance Prompt: Auto-enhance off / with rules / with AI**, or **Cycle auto-enhance**.
- **Settings → Plugins → Enhance Prompt → Auto-enhance**.

The status bar item reads **Enhance: On** while auto-enhance is on (with rules or with AI) and **Enhance: Off** otherwise. It is bright while on and dimmed while off, and its tooltip says which of the two is on.

## The 2-second limit

Orca waits at most 2 seconds for a plugin before sending the prompt anyway. In AI mode:

- Use a fast API model as the **Auto-enhance hook model** (the panel's Settings section, shown when the mode is AI and you have two or more models). Subscription CLIs are skipped because they take longer than that to start.
- Project context comes from the cache the plugin keeps warm for the focused workspace, so there is no extra wait. Turn this off with **Auto-enhance: use cached project context**.
- If the model doesn't answer in time, or fails, the original prompt is sent unchanged and the reason is in `orca plugin logs cattfan.enhance-prompt`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Auto-enhance | Off | Off, Rules, or AI |
| Auto-enhance: text to append | "Before you finish: keep changes minimal…" | The text Rules mode appends |
| Auto-enhance: minimum prompt length | 8 | Shorter prompts are left alone |
| Auto-enhance: use cached project context | On | AI mode adds rules and stack context |

Prompts rewritten in AI mode are saved in **History** and marked **auto**.
