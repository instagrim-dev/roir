import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPackageListingAllowed, requiredPayloadTextChecks } from "../scripts/release-check.mjs";

function writeFixture(root, file, text) {
  const filePath = path.join(root, file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeCompletePayload(root, overrides = {}) {
  const files = {
    "AGENTS.md": "Source Contract Preservation\nmanual_review\nrequires_source_contract_check\n",
    "skills/roi-go/SKILL.md":
      "source_contract\nmanual-review proof artifact\nindependent source-contract review\n",
    "skills/roi-verify/SKILL.md":
      "require_independent_source_contract_review\nindependent_reviewed\n",
    "docs/limitations.md": "manual-review evidence\nindependent_reviewed\n",
    "docs/installation.md":
      "Re-run `scripts/install-agent-skills.sh codex`\nrefresh the symlinks\n",
    ...overrides,
  };
  for (const [file, text] of Object.entries(files)) {
    writeFixture(root, file, text);
  }
}

test("requiredPayloadTextChecks rejects packaged payload missing source-contract guidance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-release-check-missing-"));
  try {
    writeCompletePayload(dir, {
      "skills/roi-go/SKILL.md": "source_contract\nmanual-review proof artifact\n",
    });
    assert.throws(
      () => requiredPayloadTextChecks(dir),
      /skills\/roi-go\/SKILL\.md.*independent source-contract review/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("requiredPayloadTextChecks accepts payload with source-contract proof guidance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-release-check-ok-"));
  try {
    writeCompletePayload(dir);
    assert.doesNotThrow(() => requiredPayloadTextChecks(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertPackageListingAllowed rejects internal docs plans in package payload", () => {
  assert.throws(
    () =>
      assertPackageListingAllowed([
        "package/src/service.mjs",
        "package/skills/roi-go/SKILL.md",
        "package/agents/planner.md",
        "package/.cursor/rules/roi-commands.mdc",
        "package/hooks/policy-preflight.sh",
        "package/docs/installation.md",
        "package/docs/plans/2026-07-01-001-fix-source-contract-residual-risks-plan.md",
        "package/fixtures/lifecycle-verbs.json",
        "package/scripts/release-check.mjs",
        "package/package.json"
      ]),
    /internal plans/
  );
});

test("assertPackageListingAllowed accepts operator docs without docs plans", () => {
  assert.doesNotThrow(() =>
    assertPackageListingAllowed([
      "package/src/service.mjs",
      "package/skills/roi-go/SKILL.md",
      "package/agents/planner.md",
      "package/.cursor/rules/roi-commands.mdc",
      "package/hooks/policy-preflight.sh",
      "package/docs/installation.md",
      "package/fixtures/lifecycle-verbs.json",
      "package/scripts/release-check.mjs",
      "package/package.json"
    ])
  );
});
