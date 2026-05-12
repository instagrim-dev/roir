# roi:drive Dogfood Findings

Date: 2026-05-27
Mode: compound actuation (mission mission_75b9925a-dd02-4d2b-8baa-0bf5f4ea25d5)
DB: /Users/jmh/dev/gh/agent-cli/roi/.data/roi.sqlite
Drive only: false

## Tool call trace

status_get → (dogfood-roi-go.mjs when roi:go first) → status_get → evidence_list → verify_evaluate? → status_get

## Findings

- **[PASS]** `status_get-initial`: next_actions: roi:go, roi:edit, roi:inspect
- **[PASS]** `compound-go`: dogfood-roi-go.mjs exited 0
- **[INFO]** `status_get-after-go`: next_actions: roi:go, roi:edit, roi:inspect
- **[INFO]** `roi-go-evidence`: plans with roi:go rows: 4, substantive pass: 0
- **[FAIL]** `verify-blocked`: implementation proof still owed — will not verify_evaluate(pass)

## Skill observations

- Compound drive must chain `roi:go` when `next_actions` leads with `roi:go`, then re-enter drive.
- Dogfood refuses `verify_evaluate(pass)` when substantive `roi:go` proof is still missing.
- U2 oracles: `go test ./internal/mcp/server/... -run TestMCPServerHubSmoke` and `TestInprocessMCP` in cmd (latter may be follow-up).
