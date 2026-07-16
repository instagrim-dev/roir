/**
 * Data-driven product-tree registry.
 *
 * A "product tree" names a repository subtree that ROI proves implementation
 * against: `paths_touched` prefixes, `product_tree` selection, oracle working
 * directory, and git-porcelain cross-checks all resolve through this registry.
 *
 * Historically ROI hardcoded exactly two trees (`bmo`, `roi`) for the
 * `agent-cli/` container layout. That model is preserved as built-ins so
 * existing behavior is unchanged, but additional trees can now be registered
 * without editing source, so a fresh ROI checkout can drive an arbitrary
 * project.
 *
 * Extra trees are loaded (highest precedence last) from:
 *   1. `roi.config.json` at the workspace root — `{ "product_trees": [...] }`
 *   2. `ROI_PRODUCT_TREES` env var — JSON array of tree descriptors
 *
 * A tree descriptor is:
 *   {
 *     "key": "webapp",           // required: lowercase paths_touched prefix
 *     "subdir": "packages/web",  // optional: path under workspace root (default: key)
 *     "cwd": "self"              // optional: "self" (run oracles in the tree,
 *   }                            //   default) | "workspace" | "package"
 *
 * The two built-ins keep their special roots: `roi` resolves to the ROI package
 * root (which may be the workspace root itself when ROI is unpacked standalone),
 * and `bmo` resolves to a sibling `bmo/` dir and routes oracle cwd to the
 * workspace root (its `cd bmo && …` targets self-locate).
 */

import fs from "node:fs";
import path from "node:path";

export const CWD_SELF = "self";
export const CWD_WORKSPACE = "workspace";
export const CWD_PACKAGE = "package";

const VALID_CWD = new Set([CWD_SELF, CWD_WORKSPACE, CWD_PACKAGE]);

/**
 * Built-in trees. `root: null` means "resolved specially by the caller"
 * (roi → package root, bmo → sibling bmo dir), preserving legacy behavior.
 */
const BUILTIN_TREES = Object.freeze([
  Object.freeze({ key: "roi", subdir: "roi", cwd: CWD_PACKAGE, builtin: true }),
  Object.freeze({ key: "bmo", subdir: "bmo", cwd: CWD_WORKSPACE, builtin: true })
]);

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function coerceDescriptor(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const key = normalizeKey(raw.key);
  if (!key || !/^[a-z0-9][a-z0-9._-]*$/.test(key)) {
    return null;
  }
  const subdir = String(raw.subdir ?? key).trim() || key;
  if (path.isAbsolute(subdir) || subdir.split(/[\\/]/).includes("..")) {
    return null;
  }
  let cwd = String(raw.cwd ?? CWD_SELF).trim().toLowerCase();
  if (!VALID_CWD.has(cwd)) {
    cwd = CWD_SELF;
  }
  return { key, subdir, cwd, builtin: false };
}

function readConfigTrees(workspaceRoot) {
  const root = String(workspaceRoot ?? "").trim();
  if (!root) {
    return [];
  }
  const configPath = path.join(root, "roi.config.json");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.product_trees) ? parsed.product_trees : [];
  return list.map(coerceDescriptor).filter(Boolean);
}

function readEnvTrees() {
  const raw = process.env.ROI_PRODUCT_TREES;
  if (!raw || !raw.trim()) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.product_trees) ? parsed.product_trees : [];
  return list.map(coerceDescriptor).filter(Boolean);
}

/**
 * Resolve the effective registry for a workspace root. Built-ins first, then
 * config-file trees, then env trees; later entries override earlier ones by
 * key. Built-ins cannot be removed, but their `subdir`/`cwd` can be overridden.
 */
export function productTreeRegistry(workspaceRoot) {
  const byKey = new Map();
  for (const tree of BUILTIN_TREES) {
    byKey.set(tree.key, { ...tree });
  }
  for (const tree of [...readConfigTrees(workspaceRoot), ...readEnvTrees()]) {
    const existing = byKey.get(tree.key);
    byKey.set(tree.key, {
      ...tree,
      // A built-in override keeps its builtin flag (roi/bmo special roots).
      builtin: existing?.builtin ?? false
    });
  }
  return byKey;
}

export function productTreeKeys(workspaceRoot) {
  return new Set(productTreeRegistry(workspaceRoot).keys());
}

export function isProductTreeKey(key, workspaceRoot) {
  return productTreeRegistry(workspaceRoot).has(normalizeKey(key));
}

export function getProductTree(key, workspaceRoot) {
  return productTreeRegistry(workspaceRoot).get(normalizeKey(key)) ?? null;
}
