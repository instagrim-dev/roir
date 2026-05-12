---
name: roi-work
description: Open a new ROI mission and seed the first working brief.
---

**Direct:** calls `mission_create` (logical `mission.create`) once and returns.

Use `mission_create` to open the mission with a title and goal. The server
automatically seeds the first brief revision.

Summarize the new mission ID, goal, and next action.

Next action: `roi:brief` to refine scope, constraints, and success criteria.
