---
name: roi-verify
description: Evaluate run outputs and record verification evidence.
---

Use `verify_evaluate` (logical `verify.evaluate`) to create a verification verdict for the target run.
Surface pass, partial, fail, or inconclusive clearly and report any reopened
work.

| Flag | When |
|------|------|
| **`require_verified_proof: true`** | `pass` blocked unless run plans have substantive **`roi:go`** with `verified_by: mcp` (use with `roi:drive` strict) |
| **`run_oracles: true`** (D2-D) | MCP runs each run plan's `verification_targets` and stamps `content.verify_gate` (`verified_by: mcp`); `pass` blocked if any target fails |
| **`allow_partial_verification: true`** | **`verdict: pass` only** — checkpoint pass when ≥1 run plan has substantive `roi:go` but mission is incomplete. Stamps `verify_gate.partial_mission`; `next_actions` stay `roi:go` / `roi:inspect` (no `roi:publish`). With `run_oracles`, only **substantive** plans' targets run. Not a substitute for `verdict: partial`. |

Read `status_get.summary.partial_verification_eligible` before choosing checkpoint pass vs full pass.

`run_oracles` on verify is **independent** of `roi:go` — use it when the gate should re-run targets at verify time. For implement proof, still use **`roi:go`** (optionally with `run_oracles: true` on `evidence.record`).
