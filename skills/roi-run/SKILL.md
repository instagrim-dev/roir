---
name: roi-run
description: Create and execute an ROI run locally or through A2A delegation.
---

Use `run_create` (logical `run.create`) with:

| `mode` | Behavior |
|--------|----------|
| **`local`** | Stub implement (`LOCAL_EXECUTION_COMPLETED`); pair with **`roi:go`** for real repo work |
| **`agent`** | Host handoff (`AGENT_IMPLEMENT_HANDOFF`); run pauses until **`roi:go`** + **`run_resume`** |
| **`a2a`** | Remote delegation via agent card URL |

Report task state, trace references, evidence, and next actions.
