# FAQ

## Is ROI production-ready?

No. ROI v0.1 is an early release with real behavior, but it is not
positioned as a production-hardened platform.

## Do I need A2A to use ROI?

No. Local execution is enough to exercise the full mission lifecycle. A2A is an
optional bounded delegation path.

## What does `roi:learn` actually do?

It looks for repeated successful capability activations and creates human-gated
capability proposals when a reusable pattern is strong enough.

## Can I drive the lifecycle helper without installing a host plugin?

Yes. `node scripts/lifecycle.mjs <verb> '<json-args>'` is the canonical
interface; skills are a thin wrapper. Run
`node scripts/lifecycle.mjs --list-verbs` for the registry and
`pnpm run smoke:integration` for an end-to-end subprocess exercise.

## Does ROI ship an MCP server?

Not in this release. Earlier ROI versions bundled a stdio MCP server;
the current runtime is the lifecycle helper, invoked per-command by
each skill. Hosts integrate by registering the ROI skill plugin (or
Cursor rule), not by speaking MCP to a long-running ROI process.

## Where does state live?

By default, in `.data/roi.sqlite` under the active ROI package root.

## Why does `roi:draft` pause instead of just finishing?

Because verification is a required workflow gate. ROI treats “awaiting
verification” as a real state, not a hidden follow-up note.

## Why is capability promotion human-gated?

Because ROI is designed to avoid auto-promoting weak or accidental patterns
without review.
