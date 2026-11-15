# Contributing to Enhance Prompt

Thanks for wanting to make it better. You do not need to write code to help: most of what improved
this plugin started as someone saying what did not work for them.

## Ways to help

- **A prompt came out wrong.** The most useful report there is: what you typed, what came out, and
  what was wrong with it. [Report a prompt](https://github.com/cattfan/orca-enhance-prompt/issues/new?template=1-prompt-came-out-wrong.yml)
- **Something is broken, slow or confusing.** [Report it](https://github.com/cattfan/orca-enhance-prompt/issues/new?template=2-something-is-broken.yml)
- **An idea or a wish**, small ones too. [Share it](https://github.com/cattfan/orca-enhance-prompt/issues/new?template=3-idea.yml)
- **Wording or a translation** that reads wrong, or a language you would like. [Tell us](https://github.com/cattfan/orca-enhance-prompt/issues/new?template=4-translation.yml), or add it yourself (below).
- **A star** on the repository helps other Orca users find the plugin.

Issues are public: remove keys, tokens, private code and anything about your project you would not
publish. The plugin sends nothing by itself, so what you write is all that is seen. Any language is
fine: English, Tiếng Việt, 中文, Español.

## Adding a language

Spanish came this way ([#1](https://github.com/cattfan/orca-enhance-prompt/pull/1)), and it is a good
model to follow:

1. `src/i18n-dict.ts`: a dictionary with every key of `VI`, the same `{placeholders}`, and the name
   "Enhance Prompt" kept as it is. Add the language to `UiLanguage`, `resolveLanguage` (its locale)
   and `translate`.
2. `src/i18n.ts`: the dictionary in `dictionaries`.
3. `src/panel/view.ts`: its short label in `UI_LANGUAGE_LABELS`.
4. `src/worker.ts`: its entry in `WORKER_WORDS` (the status bar's tooltip and the commands' answers).
5. `npm run web:build`, and commit the rebuilt `src/web-dist`.

`src/i18n.test.tsx` fails on a missing entry or a lost placeholder. A new language shows when Orca
itself runs in it (the panel's language is Auto by default). The language menu lists it once the
`uiLanguage` setting in `orca-plugin.json` does: changing that setting makes every user approve the
update again, so the maintainer adds it with a release that changes the manifest anyway. Leave
`orca-plugin.json` as it is in your pull request.

## Changing code

[AGENTS.md](AGENTS.md) holds the rules the code must keep (privacy switches, what may be typed into
a terminal, the frozen manifest...) and how to run the panel on sample data. Before a pull request:

```sh
orca plugin types .   # once
npx tsc -p .
orca plugin test .
orca plugin check .
orca plugin validate .
```

Run `npm run web:build` after changing anything under `web/` or a file the panel imports, and
commit the rebuilt `src/web-dist` (Orca runs no build step). Leave the version and the changelog
to the release.

The plugin stays free, with no tracking or analytics and no obfuscated code.

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <summary>

<body: what changed and why, wrapped at 72 columns>

<footers: Refs: #12, Co-Authored-By: ...>
```

- **type**: `feat` (a new capability), `fix` (a bug fix), `perf`, `refactor`, `test`, `docs`,
  `build`, `ci`, `chore`, `revert`. A breaking change adds `!` after the scope and a
  `BREAKING CHANGE:` footer.
- **scope**: the part touched: `panel`, `worker`, `prompts`, `context`, `hook`, `i18n`, `models`,
  `privacy`, `changelog`, `release`, `deps`.
- **summary**: imperative mood, lower case, no final period, at most 72 characters in all
  (`fix(panel): recognize agents running in Orca's chat view`).
- One logical change per commit. Generated files (`src/web-dist`) go in the commit whose sources
  produced them.
- A release is the commit `chore(release): vX.Y.Z`, which `scripts/release.mjs` makes.

## Changelog

[CHANGELOG.md](CHANGELOG.md) follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

- One section per version, `## [X.Y.Z] - YYYY-MM-DD`, newest first, with its link at the end of
  the file.
- Groups, in this order and only when they have entries: `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security`.
- One change per bullet, written for the person using the plugin: what is different for them, in
  one or two sentences. UI names in **bold** as the panel shows them, code and settings in
  `backticks`. No implementation detail, no test or refactor that changes nothing for them.
- A change that makes Orca ask to approve the update again says so in its bullet.
- `docs/changelog/CHANGELOG.vi.md` and `CHANGELOG.zh-CN.md` carry the same sections, translated,
  with the same bullets in the same order (the panel's What's new shows them).

## Pull requests and releases

- Work on a branch named `<type>/<short-topic>` (`fix/orca-chat-view`), and open a pull request
  whose title is the commit summary. The template asks for the summary, the changes, how it was
  verified and the user-facing impact.
- Pull requests are squash-merged, so the commit on `main` is the pull request's title and
  description.
- A release adds its section to the three changelogs, then `node scripts/release.mjs X.Y.Z`
  commits, tags `vX.Y.Z` and creates the GitHub release named `vX.Y.Z`, with the changelog section
  and a link to the full diff as its notes.
