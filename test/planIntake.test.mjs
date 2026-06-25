import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { normalizeInlinePlan } from "../src/planIntake.mjs";

const sharedFixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../bmo/internal/plancompass/testdata/intake_fixtures.json"
);
const sharedFixtures = JSON.parse(readFileSync(sharedFixturesPath, "utf8"));

test("normalizeInlinePlan extracts Codex plan steps and verification", () => {
  const normalized = normalizeInlinePlan({
    stage: "go",
    text: `
## My request for Codex:
Plan
1. Add a source normalizer.
2. Wire roi:go to persist normalized plans.
- Verification: pnpm test
`,
  });

  assert.equal(normalized.source_kind, "codex");
  assert.equal(normalized.stage, "go");
  assert.equal(normalized.plans.length, 2);
  assert.deepEqual(normalized.plans[0].actions, ["Add a source normalizer."]);
  assert.deepEqual(normalized.plans[1].verification_targets, ["pnpm test"]);
});

test("normalizeInlinePlan strips Claude-style checkboxes", () => {
  const normalized = normalizeInlinePlan({
    source_kind: "claude",
    text: `
### Implementation Plan
- [ ] Update the outline skill intake contract
- [ ] Document lifecycle helper behavior
`,
  });

  assert.equal(normalized.source_kind, "claude");
  assert.equal(normalized.plans.length, 2);
  assert.equal(normalized.plans[0].name, "Update the outline skill intake contract");
  assert.equal(normalized.requires_verification_targets, true);
  assert.deepEqual(normalized.plans[0].verification_targets, []);
  assert.match(normalized.warnings[0], /No verification targets/);
});

test("normalizeInlinePlan keeps run-prefixed tasks as actions outside validation sections", () => {
  const normalized = normalizeInlinePlan({
    text: `
Plan
1. Run the migration script.
2. Check in generated lockfile.
Validation
- pnpm test
`,
  });

  assert.deepEqual(
    normalized.plans.map((plan) => plan.actions[0]),
    ["Run the migration script.", "Check in generated lockfile."]
  );
  assert.deepEqual(normalized.plans[0].verification_targets, ["pnpm test"]);
  assert.equal(normalized.requires_verification_targets, false);
  assert.deepEqual(normalized.warnings, []);
});

test("normalizeInlinePlan does not fabricate shell commands when validation is absent", () => {
  const normalized = normalizeInlinePlan({
    text: `
Plan
1. Add parser.
`,
  });

  assert.equal(normalized.requires_verification_targets, true);
  assert.deepEqual(normalized.plans[0].verification_targets, []);
  assert.match(normalized.warnings[0], /must add runnable verification_targets/);
});

test("normalizeInlinePlan ends validation capture at the next prose section", () => {
  const normalized = normalizeInlinePlan({
    text: `
Plan
1. Add parser.
Acceptance Criteria
- pnpm test
Notes
- Keep the helper non-persistent.
`,
  });

  assert.deepEqual(normalized.plans[0].actions, ["Add parser."]);
  assert.deepEqual(normalized.plans[0].verification_targets, ["pnpm test"]);
  assert.equal(normalized.plans.length, 1);
});

test("normalizeInlinePlan returns a low-confidence warning without steps", () => {
  const normalized = normalizeInlinePlan({ text: "We should probably improve this later." });
  assert.equal(normalized.confidence, "low");
  assert.deepEqual(normalized.plans, []);
  assert.equal(normalized.warnings.length, 1);
});

for (const fixture of sharedFixtures) {
  test(`shared intake fixture: ${fixture.name}`, () => {
    const normalized = normalizeInlinePlan({
      text: fixture.text,
      source_kind: fixture.source_kind || undefined,
    });
    if (fixture.want_source_kind) {
      assert.equal(normalized.source_kind, fixture.want_source_kind);
    }
    const actions = normalized.plans.flatMap((plan) => plan.actions);
    assert.deepEqual(actions, fixture.want_actions);
    const verification = [
      ...new Set(normalized.plans.flatMap((plan) => plan.verification_targets)),
    ];
    assert.deepEqual(verification, fixture.want_verification);
    if (fixture.want_requires_verification !== undefined) {
      assert.equal(normalized.requires_verification_targets, fixture.want_requires_verification);
    }
  });
}
