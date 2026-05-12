#!/usr/bin/env node
/**
 * Local validation: Node engine, MCP tool manifest parity with server.mjs.
 * Does not run the full test suite (use pnpm test in CI).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRegisteredToolNames } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`validate: Node >= 24 required (got ${process.version})`);
  process.exit(1);
}

const fixturePath = path.join(root, "fixtures", "mcp-tools.json");
if (!fs.existsSync(fixturePath)) {
  console.error("validate: missing fixtures/mcp-tools.json — run: node scripts/sync-mcp-tools.mjs");
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const live = getRegisteredToolNames();
const expected = [...fixture.tools].sort();

if (live.length !== expected.length || live.some((n, i) => n !== expected[i])) {
  console.error("validate: fixtures/mcp-tools.json is out of sync with server.mjs");
  console.error("Run: node scripts/sync-mcp-tools.mjs");
  process.exit(1);
}

console.log(`validate: ok (${live.length} MCP tools, Node ${process.version})`);
