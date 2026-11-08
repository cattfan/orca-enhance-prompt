# Settings

Open **Settings → Plugins → Enhance Prompt**. Model profiles, API keys, fallback and the auto-enhance mode are also in the panel's **Models** tab.

## Language

| Setting | Default | Meaning |
| --- | --- | --- |
| Panel language | Auto | Language of the panel: Auto follows Orca, or English, Tiếng Việt, 中文. Also in the menu at the bottom of the panel's Models section. |
| Output language | Same as my prompt | Language of the enhanced prompt. The **Output** menu on the Enhance tab overrides it for one prompt. |

Code, identifiers, paths and error messages are always kept as they are.

## Prompt

| Setting | Default | Meaning |
| --- | --- | --- |
| Default style | Balanced | See [Styles](getting-started.md#styles) |
| Custom instructions | empty | Extra rules for the rewriter: your stack, conventions, "always ask the agent to run tests" |
| Adapt to the target agent | On | Shape the prompt for the agent in the target terminal. See [Agent-aware prompts](context-levels.md#agent-aware-prompts) |

## Context

| Setting | Default | Meaning |
| --- | --- | --- |
| Project context level | Standard | See [Context levels](context-levels.md) |
| Terminal lines (Max level) | 100 | Recent lines of the target terminal at the Max level; 0 turns it off |
| Always include files | empty | Paths relative to the workspace, one per line, such as `docs/architecture.md` |
| Exclude from code search | `dist/`, `build/`, `out/`, `coverage/`, lockfiles, `*.min.js`, `*.map`, `*.snap` | Glob-like patterns, one per line |

## Models

| Setting | Default | Meaning |
| --- | --- | --- |
| Fallback to the next model | On | See [Fallback](models.md#fallback) |
| Fall back on | Any error | Or only network, timeout, rate limit and 5xx |
| Timeout per model | 60 s | How long one model may take |

## Sending

| Setting | Default | Meaning |
| --- | --- | --- |
| How to send multi-line prompts | Bracketed paste | Keeps line breaks in Claude Code, Codex and most agent CLIs. **Raw text** or **Single line** for terminals that need it |
| Press Enter after sending | Off | Off lets you review the prompt in the agent first. The switch on the Enhance tab overrides it |
| History size | 50 | Enhanced prompts to keep; 0 turns history off |

## Status bar

| Setting | Default | Meaning |
| --- | --- | --- |
| Status bar item | Icon and text | Icon and text, icon only, or hidden |

Clicking the item opens the right sidebar, where the panel lives. Orca's status bar right-click menu lists only Orca's own items, so use this setting, or the command **Enhance Prompt: Show / hide status bar item**, to hide it.

## Auto-enhance

See [Auto-enhance](auto-enhance.md#settings).

## Commands

| Command | Does |
| --- | --- |
| Enhance Prompt: Show / hide the right sidebar | Opens the sidebar that holds the panel |
| Enhance Prompt: Cycle auto-enhance | Off → Rules → AI |
| Enhance Prompt: Auto-enhance off / with rules / with AI | Sets the mode |
| Enhance Prompt: Show / hide status bar item | Toggles the status bar item |
