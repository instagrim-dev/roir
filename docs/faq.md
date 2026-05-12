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

## Can I use the MCP backend without the local integration files?

Yes. The stdio MCP server is the core runtime surface. The surrounding files
are there to expose ROI in a local host environment, not to define ROI's
identity.

## Where does state live?

By default, in `roi/.data/roi.sqlite`.

## Why does `roi:draft` pause instead of just finishing?

Because verification is a required workflow gate. ROI treats “awaiting
verification” as a real state, not a hidden follow-up note.

## Why is capability promotion human-gated?

Because ROI is designed to avoid auto-promoting weak or accidental patterns
without review.
