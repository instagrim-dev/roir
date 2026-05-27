# roi:go Dogfood Findings

Date: 2026-05-27
Outline: /Users/jmh/dev/gh/agent-cli/roi/artifacts/2026-05-26-mcp-server-serve-mcp-18-outline.json
DB: /Users/jmh/dev/gh/agent-cli/roi/.data/roi.sqlite
Execute verification: true

## Tool call trace

outline load → status_get → plan_list → evidence_list → evidence_record (×N) → evidence_list

## Findings

- **[PASS]** `outline-load`: mission_id: mission_75b9925a-dd02-4d2b-8baa-0bf5f4ea25d5, plans in artifact: 4
- **[PASS]** `status_get`: runs: 1, evidence_count: 35
- **[INFO]** `active-run`: run_7622bc01-d16e-4d19-8989-3a2549438950 status=paused
- **[PASS]** `plan_list`: 4 plan(s) to process
- **[INFO]** `evidence-before`: 35 item(s)
- **[PASS]** `plan-plan_7683d1bc-8b4a-4f14-aed0-d27248509a6a`: result=pass
- **[PASS]** `plan-plan_f44060ae-2759-4ff4-8baa-7e7eba809b8e`: result=pass
- **[FAIL]** `oracle-plan_332777a1-6635-4959-998a-2a092c08464c`: cd bmo && go test -race ./internal/mcp/server/... -run TestMCPServerShutdown -count=1 failed
- **[FAIL]** `plan-plan_332777a1-6635-4959-998a-2a092c08464c`: result=fail
- **[FAIL]** `oracle-plan_02786207-0229-47bd-8bc0-a477cacacd58`: cd bmo && go test ./internal/cmd/... -run TestConfigShowMCPServer -count=1 failed
- **[FAIL]** `oracle-plan_02786207-0229-47bd-8bc0-a477cacacd58`: cd bmo && go test ./internal/ui/model/... -run 'TestSlashServeMCP|ServeMCP' -count=1 failed
- **[FAIL]** `plan-plan_02786207-0229-47bd-8bc0-a477cacacd58`: result=fail
- **[PASS]** `evidence-after`: total=39, roi:go source=34

## Skill observations

- `roi:go` correctly does not call `run_create`; evidence attaches to paused run when present.
- Oracle cwd must be workspace root for `bmo/...` paths (fixed in runner).
- `go test -run` with zero matches exits 0; runner treats `[no tests to run]` as fail.
- D1: `evidence_record(pass)` requires oracles OK + non-empty product-tree diff when plan has actions (`--allow-oracle-only` overrides for dry runs).
- Decision doc: `docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`.
