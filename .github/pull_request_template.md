## Summary

<!-- One or two sentences: what this changes and why. -->

## Changes

-

## Verification

- [ ] `npx tsc -p .`
- [ ] `orca plugin test .`
- [ ] `orca plugin check .` and `orca plugin validate .`
- [ ] `npm run web:build` committed, if `web/` or a file the panel imports changed
- [ ] Checked in the panel (`npm run web:dev`) or in Orca (`node scripts/e2e.mjs`), if the UI changed

## User-facing impact

<!-- What a person using the plugin will notice. "None" for internal changes.
     Say so if the manifest changes: Orca then asks every user to approve the update again. -->

## Related issues

<!-- Fixes #12, Refs #34 -->
