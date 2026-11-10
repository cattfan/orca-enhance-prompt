# Rules and prompt structures

## Your rules

The **Rules** tab holds short rules the rewriter always follows, on top of the style: "Always tell
the agent to run `pnpm test` before finishing", "Keep code identifiers in English".

- A rule you add applies to **the project you are in**. Rules saved by older versions for every
  project are still listed, marked "everywhere".
- Type a rule and press Enter (Shift+Enter for a new line), or **Add rule**.
- The switch pauses a rule; the trash icon deletes it.
- Rules are used by every Enhance and by [AI auto-enhance](auto-enhance.md).
- They win over the style's shape when the two disagree.

The style **Custom only** follows your own instructions instead of a built-in shape; write them in
**Options → Custom instructions** when that style is picked (they are also the setting **Custom
instructions** in Settings → Plugins → Enhance Prompt).

## Prompt structures

A structure is a list of headings the prompt is written under, in that order. Two are built in:

| Structure | Headings |
| --- | --- |
| Task brief | Goal, Background, Requirements, Constraints / out of scope, Edge cases, Acceptance criteria, Assumptions / questions |
| Steps | Goal, Steps, Verify |

- **Edit** (pencil) changes any structure, a built-in one too: an edited built-in is marked
  "edited", and **Restore the default** (↺) brings the original back.
- **Add structure**: a name and one heading per line, in any language.
- Pick one under **Options → Structure** in the composer. "By style" uses the style's own shape.

Built-in structures are shown in the panel's language. Headings may be in any language: the
rewriter translates them into the prompt's output language, and leaves out a heading only when
nothing belongs under it. So changing the panel language never changes what a structure means.

## How prompts are written

The rewriter follows the prompting guidance of Anthropic (Claude, Claude Code, [Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2)) and OpenAI (GPT-5):

- specific: real files, the symptom, what "done" looks like, one or two commands that check it;
- grounded: no invented files or commands; files found by search are "likely relevant";
- no copy of your `AGENTS.md` / `CLAUDE.md`: the agent reads them itself;
- the reasons you gave are kept; instructions say what to do rather than what not to do;
- a calm, plain tone (no MUST / IMPORTANT);
- it says when the agent should stop and ask (blocking unknowns, actions that are hard to undo) and
  otherwise decide and note the assumption;
- it asks the agent to report the commands it ran and what they printed;
- no instructions that pull against each other;
- approvals name the exact actions they cover, and an action you already approved in your request is
  written as approved; a hard limit says what it covers and why, without a bare "never" or "always";
- for a task with several steps, the agent is told to finish every part and to work through ordinary
  obstacles (a failing command, a timeout) instead of stopping, to change only what the task needs
  and list nearby problems at the end, and to close with a summary that stands on its own. A small
  change gets none of this;
- the agent is not told how to think: no "think step by step", no request to write out its reasoning
  (newer Claude models can refuse that), no token budget, no order to use subagents.
