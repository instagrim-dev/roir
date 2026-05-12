# Security Policy

## Security Posture

ROI is a local-first reference implementation, not a hardened production
platform.

Current trust assumptions:

- local SQLite persistence
- local stdio MCP runtime
- optional remote A2A delegation under operator control
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
