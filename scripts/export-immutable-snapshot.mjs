#!/usr/bin/env node
import path from "node:path";
import { ImmutableExportError, exportImmutableSnapshot } from "../src/immutableExport.mjs";

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

// Drop a leading `--` separator so `pnpm run export:immutable -- --db … --mission-id …`
// works as documented; pnpm forwards the separator through to argv.
const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;
const db = flagValue(args, "--db");
const missionId = flagValue(args, "--mission-id");
if (!db || !missionId) {
  console.error("Usage: node scripts/export-immutable-snapshot.mjs --db <roi.sqlite> --mission-id <id>");
  process.exit(2);
}
try {
  console.log(JSON.stringify(exportImmutableSnapshot({ dbPath: path.resolve(db), missionId })));
} catch (error) {
  if (error instanceof ImmutableExportError) {
    console.error(`immutable-export ${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
