#!/usr/bin/env node
/**
 * Regenerates fixtures/lifecycle-verbs.json from the lifecycle helper's
 * `--list-verbs` output. Run after adding or renaming verbs in
 * `roi/scripts/lifecycle.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const helperPath = path.join(root, "scripts", "lifecycle.mjs");

const verbsRaw = execFileSync(process.execPath, [helperPath, "--list-verbs"], {
  encoding: "utf8"
});
const verbs = verbsRaw
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .sort();

const out = {
  package_version: pkg.version,
  helper_path: "scripts/lifecycle.mjs",
  verbs
};

const dest = path.join(root, "fixtures", "lifecycle-verbs.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${verbs.length} verbs to fixtures/lifecycle-verbs.json`);
