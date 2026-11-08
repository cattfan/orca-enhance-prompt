# Working on this plugin

Orca plugin (`trusted-worker`) with no build step: Orca transpiles `src/*.ts(x)` on load.
Docs: https://github.com/stablyai/orca/tree/main/docs/reference (plugin-*.md).

## Checks before every commit

```sh
orca plugin types .      # once, writes .orca/types
npx tsc -p .
orca plugin test .
orca plugin check .
orca plugin validate .
```

## Live preview

`npm run dev` serves http://localhost:5173: the panel's scenarios from `src/panel.check.ts`, drawn by
`scripts/render-panel.mjs`, redrawn on every save. Add a scenario there to preview a new state.

## Every change is a release

1. Bump `version` in `orca-plugin.json`: patch for fixes, minor for features, major for breaking changes.
   Minor and patch are single digits 0-9 and carry over like an odometer: 1.8.9 -> 1.9.0,
   1.9.0 -> 2.0.0 (never 1.10.0), 13.9.9 -> 14.0.0. `scripts/release.mjs` refuses anything else.
2. Add a section at the top of `CHANGELOG.md` (Added / Changed / Fixed / Security / Notes) and its link at the bottom.
3. Commit with a message that says what changed: `git commit -m "vX.Y.Z: <summary>"`.
4. Tag and push: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin main vX.Y.Z`.
5. Create the GitHub release from the changelog section:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<that CHANGELOG section>"`.
6. Check the listing: https://www.onorca.dev/plugins/cattfan/orca-enhance-prompt

`scripts/release.mjs <version>` does steps 3–5 once steps 1–2 are done.

## Listing policy

The plugin must stay free, have no tracking or analytics, and contain no obfuscated code.
`publisher` is the repo owner, so leave it out of the manifest. Ids must not start with `orca-`.
