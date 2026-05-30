# Contributing

Thanks for contributing to ROI.

## Project Posture

ROI is a self-contained implementation of Reusable Operational Intelligence.
Changes should preserve that posture:

- keep runtime behavior self-contained under `roi/`
- avoid introducing dependencies on the broader BMO runtime
- document new behavior as clearly as you implement it
- keep the product language clear and consistent

## Local Setup

```bash
pnpm install
pnpm test
```

Run the lifecycle helper directly when debugging persistence:

```bash
node scripts/lifecycle.mjs --list-verbs
node scripts/lifecycle.mjs mission_list '{}'
```

## What To Validate

Before opening a change:

- run `pnpm test` (or `npm test`)
- run `pnpm run validate` (Node ≥24, lifecycle-verb manifest matches
  `fixtures/lifecycle-verbs.json`)
- optional: `pnpm run smoke:integration` (drives `scripts/lifecycle.mjs`
  end-to-end against a temp DB via `ROI_SQLITE_PATH`)
- verify docs match the actual runtime behavior
- keep command names and lifecycle language consistent
- keep `learn` / `learning` terminology consistent across user-facing docs;
  the internal lifecycle verb remains `enlighten_run`, but the product
  learning pass is **`roi:learn`** (see
  `docs/command-reference.md`)

## Release checklist

When cutting a release or bumping `package.json` `version`:

1. Update this `CHANGELOG.md` under the new version.
2. After adding, removing, or renaming verbs in `scripts/lifecycle.mjs`, run
   `pnpm run sync:lifecycle-verbs` and commit `fixtures/lifecycle-verbs.json`.
3. Run `pnpm run validate`, `pnpm test`, and `pnpm run smoke:integration`.
4. Run the full release gate: `pnpm run release:check`.

## Documentation Expectations

If you change:

- command behavior
- persistence semantics
- lifecycle states
- A2A behavior
- capability promotion behavior

then update the relevant docs in `README.md` or `docs/` in the same change.

## Issues And Pull Requests

- open issues for bugs, confusing docs, or design gaps
- keep pull requests focused
- explain behavior changes in user-facing terms, not only implementation terms

## Scope Guardrail

Do not turn ROI into a thin wrapper around unrelated BMO internals. This
package exists to remain understandable on its own.
