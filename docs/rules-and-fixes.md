# Rules, structures and Fix this error

## Your rules

The **Rules** tab (wrench icon) holds short rules the rewriter always follows, on top of the style:
"Always tell the agent to run `pnpm test` before finishing", "Keep code identifiers in English".

- A rule applies to **every workspace** or **only the workspace you are in** when you add it.
- Untick a rule to pause it; the trash icon deletes it.
- Rules are used by every Enhance and by [AI auto-enhance](auto-enhance.md).
- They win over the style's shape when the two disagree.

The setting **Custom instructions** (Settings → Plugins → Enhance Prompt) still works and is added
before your rules.

## Prompt structures

A structure is a list of headings the prompt is written under, in that order. Two are built in:

| Structure | Headings |
| --- | --- |
| Task brief | Goal, Background, Requirements, Constraints / out of scope, Edge cases, Acceptance criteria, Assumptions / questions |
| Steps | Goal, Steps, Verify |

Add your own in the Rules tab: a name and one heading per line, in any language (for example
`Mục tiêu`, `Bối cảnh`, `Yêu cầu`, `Tiêu chí hoàn thành`). The rewriter translates headings into the
output language and leaves out a heading only when nothing belongs under it.

Pick a structure under **Options** in the composer (**Structure**). "By style" uses the style's own
shape.

## Fix this error

When a build, test run or dev server fails in another terminal, the agent does not see it. Instead
of copying the error by hand:

1. Press the **bug** icon in the composer.
2. Under **Error in**, pick the terminal that shows the error (it defaults to one that is not an agent).
3. Press **Fix this error**.

The plugin reads the latest error block from that terminal (up to 150 lines), puts it first in the
context, and writes a **Bug fix** prompt for the agent you send to. Text already in the composer is
added to it. Then review and **Send** as usual.

It reads terminal output, so it needs **Privacy → Read terminal output** on.

## How prompts are written

The rewriter follows the prompting guidance of Anthropic (Claude, Claude Code) and OpenAI (GPT-5):

- specific: real files, the symptom, what "done" looks like, one or two commands that check it;
- grounded: no invented files or commands; files found by search are "likely relevant";
- no copy of your `AGENTS.md` / `CLAUDE.md`: the agent reads them itself;
- the reasons you gave are kept; instructions say what to do rather than what not to do;
- a calm, plain tone (no MUST / IMPORTANT);
- it says when the agent should stop and ask (blocking unknowns, actions that are hard to undo) and
  otherwise decide and note the assumption;
- it asks the agent to report the commands it ran and what they printed;
- no instructions that pull against each other.
