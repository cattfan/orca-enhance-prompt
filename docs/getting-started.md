# Your first enhanced prompt

From a fresh install to a prompt in your agent's terminal in about two minutes.

## 1. Open the panel

Enhance Prompt lives in Orca's **right sidebar**.

- Press `Ctrl+L` (`⌘L` on macOS), or click **Enhance: off** in the status bar.
- Click the **lightbulb** tab.

If you don't see the lightbulb, check that the plugin is enabled under **Settings → Plugins → Enhance Prompt**.

## 2. Add a model

Open the **Models** tab.

- **You already use Claude Code, Codex or Gemini CLI?** They show up under **Use your subscription**. Click one, then click **Test** (✓) on its card. No API key needed. See [Subscription CLIs](models.md#subscription-clis).
- **You have an API key?** Click **Add model**, pick a preset (OpenAI, Anthropic, OpenRouter, Groq…), pick the model from the list, paste the key, and **Save**. The key is stored encrypted by Orca.

Add a second model to get [fallback](models.md#fallback): when the first one fails, the next one answers.

## 3. Enhance

Go back to the **Enhance** tab and describe what you want, as roughly as you like:

```text
login page is broken on mobile
```

The line under the prompt shows the current options, for example **Balanced · Standard · Auto**. Click it to change them:

- **Style**: what kind of prompt you need. See [Styles](#styles).
- **Context**: how much of your project the model sees. **Standard** is a good default; **Deep** finds the code that matches your request. See [Context levels](context-levels.md).
- **Output**: the language of the result, or the same language as your request.
- **Model**: **Auto** runs your models in order with fallback, or pick one.

Click **Enhance** or press `Ctrl+Enter` (`⌘Enter`). A model API takes a few seconds; a subscription CLI usually takes 5 to 15.

## 4. Review and send

The result opens in the **Enhanced prompt** card. Edit it freely, then:

- Pick the agent's terminal under **Send to**. Agent terminals come first.
- Click **Send to agent**. The prompt is pasted, not submitted, so you can read it in the agent before pressing Enter. Turn on **Press Enter after sending** to submit it right away.

Other actions:

- **Copy** and **Clear**: the two icons at the top of the card.
- **Refine**: makes the result your new input, to enhance it again with another style or level.
- **Context used**: lists everything the model saw. Untick an item to leave it out next time.
- **Send as is**: before you enhance, sends your prompt unchanged to the selected terminal.

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
| Custom only | Only your **Custom instructions** from Settings |

Every style keeps your intent: it never adds scope you didn't ask for, and it names a file or command only when it appears in your request or the project context.

> [!TIP]
> That's the whole flow: describe → enhance → review → send. Every other page goes deeper into one of those steps.
