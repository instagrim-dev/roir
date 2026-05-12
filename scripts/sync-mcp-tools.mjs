#!/usr/bin/env node
/**
 * Regenerates fixtures/mcp-tools.json from src/server.mjs tool registration.
 * Run after adding or renaming MCP tools.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRegisteredToolNames } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const names = getRegisteredToolNames();

const out = {
  package_version: pkg.version,
  mcp_server_version: "0.1.0",
  tools: names
};

fs.writeFileSync(path.join(root, "fixtures", "mcp-tools.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${names.length} tool names to fixtures/mcp-tools.json`);
