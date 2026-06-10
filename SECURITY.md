# Security Policy

## Security Posture

ROI is a local-first reference implementation, not a hardened production
platform.

Current trust assumptions:

- local SQLite persistence
- local lifecycle-helper runtime (skills shell to `scripts/lifecycle.mjs`; there
  is no network-exposed MCP server or daemon)
- plan `verification_targets` execute as local commands during `roi:go` /
  verify oracles: they run argv-style via `execFileSync` against a binary
  allowlist (no shell), and only fall back to a real shell when
  `ROI_ORACLE_ALLOW_UNSAFE=1` is set. Treat plan content as a code-execution
  surface and only run oracles on plans you trust.
- optional remote A2A delegation under operator control: agent-card URLs are
  validated (http/https only). Loopback targets (`127.0.0.0/8`, `::1`,
  `localhost`) are allowed by default because delegating to a service on the
  operator's own machine is the documented local-first case; cloud-metadata
  (`169.254.169.254`), link-local, and RFC1918 private ranges are refused unless
  `ROI_A2A_ALLOW_PRIVATE=1` is set. The guard is a hostname/literal-IP check, not
  resolve-then-connect socket pinning, so it does not defend against DNS
  rebinding. A2A requests are unauthenticated, and remote response text is
  persisted as evidence.
- human-gated capability promotion

## Appropriate Use

ROI is suitable for:

- local experimentation
- architecture study
- development-time workflow prototyping

ROI is not currently suitable for:

- sensitive production workloads
- multi-tenant hosted deployments
- environments that require mature secrets, auth, and operational hardening

## Reporting A Vulnerability

Please avoid opening a public issue for a suspected security problem.

Preferred path:

- use GitHub Security Advisories or private security reporting if available for
  the repository

If no private reporting path exists yet, contact the maintainers privately
before disclosure.

## What To Include

When reporting a security concern, include:

- affected ROI version or commit
- clear reproduction steps
- impact assessment
- any known mitigation
