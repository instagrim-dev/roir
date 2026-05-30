# Adversarial Review — Changeset Delta
Scope: current unstaged delta migrating ROI from MCP-server-centered execution to the lifecycle helper (`scripts/lifecycle.mjs`) and in-process service wiring. Owning seam reviewed first: operator-facing runtime contract (commands, host setup, release validation) and test coverage of that contract.

## Findings
### 1) Operator contract is broken by runtime/docs drift after script and asset removal
- **Severity**: high
- **Certainty**: definite bug
- **Exact file reference**:
  - `package.json:32-43`
  - `README.md:93,98,140,156-160`
  - `CONTRIBUTING.md:25,33-34,47,50-51`
  - `docs/troubleshooting.md:16,25,37-38,50-51`
- **What is wrong**:
  - Runtime scripts now expose `smoke:integration` and `sync:lifecycle-verbs` (no `start`, no `smoke`, no `sync:mcp-tools`) in `package.json:32-43`.
  - User-facing docs still instruct removed flows (`pnpm start`, `pnpm run smoke`, MCP-server pathing via `src/server.mjs`, and legacy MCP config artifacts) across README/contributing/troubleshooting.
- **Why it matters operationally**:
  - A maintainer following docs hits immediate command/file failures during onboarding, debugging, and local validation.
  - This creates false recovery guidance at exactly the point operators rely on docs for incident handling.
- **Concrete fix direction**:
  - Update all operator docs to the lifecycle-helper contract:
    - `node scripts/lifecycle.mjs <verb> ...`
    - `pnpm run smoke:integration`
    - `pnpm run sync:lifecycle-verbs`
  - Remove or rewrite MCP-server startup and removed-file instructions in these documents to match the current executable surface.

### 2) Installation and release docs still assert MCP-era assets/validation that no longer match the shipped gate
- **Severity**: high
- **Certainty**: definite bug
- **Exact file reference**:
  - `docs/installation.md:16,45,73,76,88,101,123,126,155,163,173,188,198,203,209,210,269,280,287,301`
  - `docs/release-validation.md:39-44,81`
  - `scripts/release-check.mjs:189-192`
  - `scripts/validate.mjs:25-31,44-46`
- **What is wrong**:
  - Installation docs continue to prescribe MCP-server config paths/commands and server entrypoints.
  - Release-validation doc still claims MCP tool manifest parity and MCP startup smoke lanes.
  - Actual release gate now validates lifecycle-verb parity and runs integration smoke; MCP startup smoke is no longer executed.
- **Why it matters operationally**:
  - Release sign-off can be performed against stale criteria, producing a false sense of coverage.
  - Host setup instructions can direct users into non-existent or obsolete setup paths.
- **Concrete fix direction**:
  - Rewrite installation + release-validation docs to describe the lifecycle-helper-first surface and current gate steps exactly as executed by `scripts/release-check.mjs` and `scripts/validate.mjs`.
  - Ensure listed commands/artifacts are mechanically verifiable (e.g., docs lint/check that each referenced command exists in `package.json` scripts and each referenced file exists).

### 3) Regression suite now bypasses canonical lifecycle helper dispatch and has map drift risk
- **Severity**: medium
- **Certainty**: likely risk
- **Exact file reference**:
  - `test/_helper-test-driver.mjs:14-44`
  - `scripts/lifecycle.mjs:35-109`
  - `test/convergence-loop.test.mjs:11-140`
  - `test/editorial-loop.test.mjs:11-287`
- **What is wrong**:
  - Convergence/editorial tests now call ROIService via a test-local verb map instead of executing `scripts/lifecycle.mjs`.
  - The test map is independently maintained and already diverges in shape/risk from the helper registry approach, making contract drift easier to miss.
- **Why it matters operationally**:
  - Helper-level regressions (argument parsing, dispatch behavior, stderr/exit semantics) can slip through while core lifecycle tests still pass.
  - This weakens confidence in the actual operator path (skills shelling to lifecycle helper).
- **Concrete fix direction**:
  - Keep fast in-process tests if desired, but add/expand contract tests that execute `scripts/lifecycle.mjs` for editorial/convergence critical paths (not only basic smoke phases).
  - Generate the test verb map from the helper registry or fixture to eliminate manual drift.

## Residual risk
- Additional docs outside the files above likely still contain MCP/server-era language; this review focused on high-impact operator and release surfaces first.
