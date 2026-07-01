# Troubleshooting

## `pnpm test` Fails Immediately

Check:

- Node version is `>=24`
- dependencies are installed with `pnpm install`
- you are running commands from the ROI package root (`roi/` checkout or
  unpacked `package/` directory)

## Lifecycle Helper Fails To Run

The lifecycle helper (`scripts/lifecycle.mjs`) is the only persistence
path. If `node scripts/lifecycle.mjs --list-verbs` fails, check:

- `node` is on your `PATH` and reports `>=24` (`node --version`)
- you are running from the ROI package root so the relative
  `src/service.mjs` and `.data/` paths resolve
- no other process has locked `.data/roi.sqlite` unexpectedly
- `ROI_SQLITE_PATH`, if set, points to a writable location

For a clean reproduction, run the integration smoke against a temp DB:

```bash
pnpm run smoke:integration
```

That harness drives the helper as a subprocess (the same way skills do)
and is the fastest signal that persistence is healthy.

## A Skill Reports `lifecycle: <verb> failed`

The helper exits 1 and prints `lifecycle: <verb> failed: <message>` on
stderr when the underlying service throws. To see the stack trace:

```bash
ROI_DEBUG=1 node scripts/lifecycle.mjs <verb> '<json-args>'
```

Common causes:

- malformed JSON arguments (use `-` to read from stdin for long bodies)
- unknown verb (run `node scripts/lifecycle.mjs --list-verbs`)
- missing required fields on the verb's input schema (see
  `src/contracts.mjs` and the corresponding service method)

## Cursor Does Not Recognize ROI Commands

Cursor has no skill picker; ROI command vocabulary is injected through
`.cursor/rules/roi-commands.mdc` shipped in the ROI package root.

Check:

- you opened the checked-out `roi/` root or unpacked `package/` root
  that ships `.cursor/rules/roi-commands.mdc`
- the agent session reloaded after the rule file changed (start a new
  conversation if needed)
- to also install the ROI rule into `~/.cursor/rules/`, run
  `scripts/install-agent-skills.sh cursor-user`

## Copilot CLI Does Not Show ROI Skills

Check:

- you ran `scripts/install-agent-skills.sh copilot` from the ROI package
  root
- `~/.copilot/installed-plugins/roi-plugin/` exists and points at this
  checkout's `skills/` directory
- `~/.copilot/settings.json` lists `roi-plugin` under installed plugins
- you restarted `gh copilot` after running the installer

## Codex Does Not Surface ROI Skills

Check:

- `scripts/install-agent-skills.sh codex` ran successfully and created
  `~/.local/share/roi/plugins/roi/` plus
  `~/.local/share/roi/.agents/plugins/marketplace.json`
- `~/.codex/config.toml` (or a trusted project `.codex/config.toml`)
  contains a `[marketplaces.roi-plugin]` block whose `source` points at
  the generated marketplace root
- `[plugins."roi@roi-plugin"] enabled = true` is present in the same
  config file
- the ROI skills directory is reachable from Codex (no broken symlinks
  after a checkout move)
- after updating a checkout, re-run `scripts/install-agent-skills.sh codex`
  and inspect the dry-run payload paths if the skill picker still shows stale
  source-contract guidance

For the Codex desktop app, after running the installer also click
**Codex.app → Settings (⚙) → Plugins → ROI → Install**, then restart.

## Codex Desktop Fails To Add The ROI Marketplace

If Codex.app shows **Failed to add marketplace** for ROI, check the local
marketplace package:

- use the generated marketplace root as the source:
  `~/.local/share/roi` (enter the full absolute path if the UI does not
  expand `~`)
- do not use the raw checkout path unless its
  `.agents/plugins/marketplace.json` is also current
- clear **Git ref** and **Sparse paths** in the Add Marketplace dialog
  for local marketplace paths; `--ref` only applies to Git marketplace
  sources
- ensure `.agents/plugins/marketplace.json` uses a supported
  authentication policy: Codex accepts `ON_INSTALL` or `ON_USE`, not
  `NONE`

For opaque UI failures, inspect the desktop log under
`~/Library/Logs/com.openai.codex/YYYY/MM/DD/`; `marketplace/add` entries
include the underlying parse or source-format error.

## You See An Experimental SQLite Warning

That is expected in the current release. ROI uses Node's experimental
`node:sqlite` API. This warning does not by itself indicate failure.

## A Run Stops At Review

This is normal. `roi:draft` typically pauses at `verify_gate`. Use:

- `roi:inspect` to inspect the paused state
- `roi:review` to record the verdict and decide whether to edit or publish

## A Run Is Blocked By Policy

Use `roi:inspect` and inspect the stored policy decision and blocked task
state. Common causes include destructive or approval-sensitive actions.

## A Run Is Stuck In `waiting_on_external`

This usually means the A2A path has not yet delivered a reconciled result
back to local ROI state. Retry with `roi:draft` or inspect the remote
side if you are testing bounded A2A delegation.

## `roi:learn` Returns `noop`

That is expected unless ROI has enough repeated successful activations
with passing reviews to justify a capability proposal.

## State Looks Wrong During Local Experimentation

Stop any in-flight helper invocations and inspect or reset. Because the
database runs in WAL mode, always remove the sidecar files along with
`roi.sqlite`:

```bash
rm -f .data/roi.sqlite .data/roi.sqlite-wal .data/roi.sqlite-shm
```

Only do this if you intentionally want to discard local mission history.

See [`state-and-artifacts.md` → "Schema And Migrations"](./state-and-artifacts.md#schema-and-migrations)
for the reset-vs-migrate policy and when a schema-version bump requires
a reset rather than a silent restart.
