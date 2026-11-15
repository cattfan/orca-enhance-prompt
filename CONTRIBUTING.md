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
