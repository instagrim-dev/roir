#!/usr/bin/env node
/**
 * Local validation: Node engine + lifecycle helper verb manifest parity.
 *
 * Replaces the old `validate.mjs` which checked parity against
 * `src/server.mjs`. Now the canonical source of verb names is the
 * `VERBS` registry in `scripts/lifecycle.mjs` (no MCP server).
 *
 * Does not run the full test suite (use `pnpm test` in CI).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`validate: Node >= 24 required (got ${process.version})`);
  process.exit(1);
}

const fixturePath = path.join(root, "fixtures", "lifecycle-verbs.json");
if (!fs.existsSync(fixturePath)) {
  console.error("validate: missing fixtures/lifecycle-verbs.json — run: node scripts/sync-lifecycle-verbs.mjs");
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const helperPath = path.join(root, "scripts", "lifecycle.mjs");
const liveOutput = execFileSync(process.execPath, [helperPath, "--list-verbs"], {
  encoding: "utf8"
});
const live = liveOutput
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .sort();
const expected = [...fixture.verbs].sort();

if (live.length !== expected.length || live.some((n, i) => n !== expected[i])) {
  console.error("validate: fixtures/lifecycle-verbs.json is out of sync with lifecycle.mjs");
  console.error("Run: node scripts/sync-lifecycle-verbs.mjs");
  console.error(`live (${live.length}): ${live.join(", ")}`);
  console.error(`expected (${expected.length}): ${expected.join(", ")}`);
  process.exit(1);
}

const parityScript = path.join(root, "..", "scripts", "check_plan_intake_fixture_parity.mjs");
if (fs.existsSync(parityScript)) {
  try {
    execFileSync(process.execPath, [parityScript], {
      cwd: path.join(root, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message;
    console.error(`validate: plan-intake-fixture-parity failed: ${detail}`);
    process.exit(1);
  }
}

console.log(`validate: ok (${live.length} lifecycle verbs, Node ${process.version})`);
