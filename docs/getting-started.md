# Your first enhanced prompt

From a fresh install to a prompt in your agent's terminal in about two minutes.

## 1. Open the panel

Enhance Prompt lives in Orca's **right sidebar**.

- Press `Ctrl+L` (`⌘L` on macOS), or click **Enhance** in the status bar.
- Click the **lightbulb** tab.

If you don't see the lightbulb, check that the plugin is enabled under **Settings → Plugins → Enhance Prompt**.

The icons at the top right of the panel switch between **Enhance** (sparkles), **History** (book), **Models** (robot), **Rules** (scroll) and **Settings** (gear: auto-enhance, access switches, stored data and feedback). The language menu sits just left of them, and the version next to the title opens **What's new**. Hover an icon to see its name.

## 2. Add a model

Open the **Models** tab.

- **You already use Claude Code, Codex or Gemini CLI?** They show up under **Use your subscription, no API key** at the bottom of the tab. Click **Add**, then the test button (plug) on its card. No API key needed. See [Subscription CLIs](models.md#subscription-clis).
- **You have an API key?** Click **Add model**, pick a preset (OpenAI, Anthropic, OpenRouter, Groq…), pick the model from the list, paste the key, and **Save**. The key is stored encrypted by Orca.

Add a second model to get [fallback](models.md#fallback): when the first one fails, the next one answers.

## 3. Enhance

Go back to the **Enhance** tab and describe what you want, as roughly as you like:

```text
login page is broken on mobile
```

The prompt box and its tools sit in one card: under the text, the model menu and the **Options** button (sliders) on the left, the **paperclip** and the **Enhance** button (↵) on the right. Paste a screenshot or drop files on the box to attach them.

The model menu lists every model you can use right now, like the model menu in ChatGPT or Claude: **Auto** runs your models in order with fallback, or pick one, such as **Claude Code · sonnet** or **Codex · GPT-6.1-Sol**. The lists come from each CLI or API and stay current; see [Model lists stay current](models.md#model-lists-stay-current).

**Options** opens the other options (hover it to see the current ones), with the list of context that will be sent below them:

- **Style**: what kind of prompt you need. See [Styles](#styles).
- **Context**: how much of your project the model sees. **Standard** is a good default; **Deep** finds the code that matches your request. See [Context levels](context-levels.md).
- **Output language**: the language of the result, or the same language as your request.
- **Structure**: headings to write the prompt under (see [Rules and prompt structures](rules-and-fixes.md)).

Press **Enter** (Shift+Enter for a new line) or click ↵. A model API takes a few seconds; a subscription CLI usually takes 5 to 15.

While it runs, a progress card shows each step as it really happens: reading the workspace, the project's rules and stack, git changes, finding relevant code, the AI file picker, the terminal, then the model writing (with its name, and the next one when it falls back). The bar shows the total percentage and each step its own; the model call reports no progress of its own, so its share is an estimate marked ≈. The square button stops it; if it fails, the card stays with the error and **Try again**.

## 4. Review and send

The result opens in the **Enhanced prompt** card. Edit it freely, then:

- Pick the agent's terminal at the bottom of the card. Agent terminals come first.
- Click **Send**. The prompt is pasted, not submitted, unless the **Enter** switch next to Send is on. Long prompts are sent in pieces of up to 4,000 characters, still as one paste.

Other actions:

- **Copy**, **Refine** (arrow up) and **Clear**: the icons at the top of the card. Refine moves the result up into the prompt box, to enhance it again with another style or level.
- **Context** (under Options): lists everything the model saw. Untick an item to leave it out next time.

## 5. Reuse from history

The **History** tab keeps every enhanced prompt with its style, model and time. Search it, open one in the Enhance tab with the pencil, or copy it. Prompts rewritten by [auto-enhance](auto-enhance.md) are marked **auto**.

## Styles

| Style | Shape of the prompt |
| --- | --- |
| Balanced | One-line goal, then Context, Requirements, Constraints and Done when, only where useful |
| Concise | A few tight sentences or bullets |
| Detailed spec | Goal, background, numbered requirements, non-goals, edge cases, acceptance criteria |
| Bug fix | Symptom, reproduction, root-cause investigation first, minimal fix, regression test |
| New feature | User value, behavior, API or UI surface, tests, done when |
| Refactor | Target, motivation, behavior must not change, small steps, verification |
| Code review | What to review, focus areas, findings by severity with `file:line`, no edits |
| Plan first | Explore, write a plan with risks and questions, then wait or proceed |
| Custom only | Only your own instructions (**Options → Custom instructions**) |

Every style keeps your intent: it never adds scope you didn't ask for, and it names a file or command only when it appears in your request or the project context.

> [!TIP]
> That's the whole flow: describe → enhance → review → send. Every other page goes deeper into one of those steps.
