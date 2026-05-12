# roi:go Dogfood Findings

Date: 2026-05-27
Outline: /Users/jmh/dev/gh/agent-cli/roi/artifacts/2026-05-26-mcp-server-serve-mcp-18-outline.json
DB: /Users/jmh/dev/gh/agent-cli/roi/.data/roi.sqlite
Execute verification: true

## Tool call trace

outline load → status_get → plan_list → evidence_list → evidence_record (×N) → evidence_list

## Findings

- **[PASS]** `outline-load`: mission_id: mission_75b9925a-dd02-4d2b-8baa-0bf5f4ea25d5, plans in artifact: 4
- **[PASS]** `status_get`: runs: 1, evidence_count: 22
- **[INFO]** `active-run`: run_7622bc01-d16e-4d19-8989-3a2549438950 status=paused
- **[PASS]** `plan_list`: 2 plan(s) to process
- **[INFO]** `evidence-before`: 22 item(s)
- **[PASS]** `plan-plan_7683d1bc-8b4a-4f14-aed0-d27248509a6a`: result=pass
- **[PASS]** `plan-plan_f44060ae-2759-4ff4-8baa-7e7eba809b8e`: result=pass
- **[PASS]** `evidence-after`: total=24, roi:go source=20

## Skill observations

- `roi:go` correctly does not call `run_create`; evidence attaches to paused run when present.
- Oracle cwd must be workspace root for `bmo/...` paths (fixed in runner).
- `go test -run` with zero matches exits 0; runner treats `[no tests to run]` as fail.
- D1: `evidence_record(pass)` requires oracles OK + non-empty product-tree diff when plan has actions (`--allow-oracle-only` overrides for dry runs).
- Decision doc: `docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`.
