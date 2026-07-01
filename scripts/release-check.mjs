#!/usr/bin/env node
/**
 * Release gate for ROI.
 *
 * Enforces the contract documented in docs/release-validation.md:
 * - pnpm validation/test/smoke lanes
 * - host installer dry-runs
 * - production dependency audit
 * - package tarball allowlist inspection
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const currentFile = fileURLToPath(import.meta.url);
const root = path.join(__dirname, "..");

const forbiddenPackagePaths = [
  { label: "bmo-import mirror", prefix: "package/bmo-import/" },
  { label: "generated artifacts", prefix: "package/artifacts/" },
  { label: "local data", prefix: "package/.data/" },
  { label: "vendored node_modules", prefix: "package/node_modules/" },
  { label: "npm lockfile", exact: "package/package-lock.json" },
];

const requiredPackagePaths = [
  { label: "runtime source", prefix: "package/src/" },
  { label: "skills", prefix: "package/skills/" },
  { label: "agents", prefix: "package/agents/" },
  { label: "cursor vocabulary rule", exact: "package/.cursor/rules/roi-commands.mdc" },
  { label: "hooks", prefix: "package/hooks/" },
  { label: "docs", prefix: "package/docs/" },
  { label: "fixtures", prefix: "package/fixtures/" },
  { label: "scripts", prefix: "package/scripts/" },
  { label: "package metadata", exact: "package/package.json" },
];

const expectedMarketplace = {
  name: "roi-plugin",
  pluginName: "roi",
  installation: "AVAILABLE",
  authentication: "ON_INSTALL",
};

function step(label) {
  console.log(`\n==> ${label}`);
}

function run(label, command, args, options = {}) {
  step(label);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status ?? "unknown"}`);
  }
}

function capture(label, command, args) {
  step(label);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

function archivePathFromPackOutput(output, tmpDir) {
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.endsWith(".tgz"))
    .at(-1);

  if (!line) {
    throw new Error("pnpm pack did not print a .tgz archive path");
  }

  return path.isAbsolute(line) ? line : path.join(tmpDir, line);
}

function matches(entry, rule) {
  if (rule.exact) return entry === rule.exact;
  return entry.startsWith(rule.prefix);
}

function inspectMarketplaceContract() {
  step("Validate Codex marketplace contract");

  const marketplacePath = path.join(root, ".agents/plugins/marketplace.json");
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  if (marketplace.name !== expectedMarketplace.name) {
    throw new Error(
      `.agents marketplace name must be ${expectedMarketplace.name}, got ${marketplace.name}`
    );
  }

  const plugin = marketplace.plugins?.find(
    (candidate) => candidate.name === expectedMarketplace.pluginName
  );
  if (!plugin) {
    throw new Error(`.agents marketplace is missing ${expectedMarketplace.pluginName} plugin`);
  }
  if (plugin.policy?.installation !== expectedMarketplace.installation) {
    throw new Error(
      `Codex marketplace installation policy must be ${expectedMarketplace.installation}`
    );
  }
  if (plugin.policy?.authentication !== expectedMarketplace.authentication) {
    throw new Error(
      `Codex marketplace authentication must be ${expectedMarketplace.authentication}`
    );
  }

  const installer = fs.readFileSync(path.join(root, "scripts/install-agent-skills.sh"), "utf8");
  for (const snippet of [
    `"name": "${expectedMarketplace.name}"`,
    `"authentication": "${expectedMarketplace.authentication}"`,
  ]) {
    if (!installer.includes(snippet)) {
      throw new Error(`installer-generated marketplace is missing ${snippet}`);
    }
  }

  console.log("marketplace ok: roi-plugin uses ON_INSTALL");
}

export function requiredPayloadTextChecks(rootDir = root) {
  const checks = [
    {
      file: "AGENTS.md",
      snippets: [
        "Source Contract Preservation",
        "manual_review",
        "requires_source_contract_check"
      ]
    },
    {
      file: "skills/roi-go/SKILL.md",
      snippets: [
        "source_contract",
        "manual-review proof artifact",
        "independent source-contract review"
      ]
    },
    {
      file: "skills/roi-verify/SKILL.md",
      snippets: [
        "require_independent_source_contract_review",
        "independent_reviewed"
      ]
    },
    {
      file: "docs/limitations.md",
      snippets: [
        "manual-review evidence",
        "independent_reviewed"
      ]
    },
    {
      file: "docs/installation.md",
      snippets: [
        "Re-run `scripts/install-agent-skills.sh codex`",
        "refresh the symlinks"
      ]
    }
  ];
  for (const check of checks) {
    const filePath = path.join(rootDir, check.file);
    const text = fs.readFileSync(filePath, "utf8");
    for (const snippet of check.snippets) {
      if (!text.includes(snippet)) {
        throw new Error(`release payload ${check.file} is missing required text: ${snippet}`);
      }
    }
  }
  console.log("payload text ok: source-contract proof guidance present");
}

function inspectPackage() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-release-pack-"));
  try {
    const output = capture("Build package tarball", "pnpm", [
      "pack",
      "--pack-destination",
      tmpDir,
    ]);
    const archivePath = archivePathFromPackOutput(output, tmpDir);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`package archive not found: ${archivePath}`);
    }

    run("Extract package tarball", "tar", ["-xzf", archivePath, "-C", tmpDir]);
    const listing = capture("Inspect package tarball", "tar", ["-tzf", archivePath])
      .split(/\r?\n/)
      .filter(Boolean);
    const unpackedPackageDir = path.join(tmpDir, "package");

    const forbiddenHits = forbiddenPackagePaths.flatMap((rule) =>
      listing.filter((entry) => matches(entry, rule)).map((entry) => ({ rule, entry }))
    );
    if (forbiddenHits.length > 0) {
      const sample = forbiddenHits
        .slice(0, 20)
        .map(({ rule, entry }) => `- ${rule.label}: ${entry}`)
        .join("\n");
      throw new Error(`package contains forbidden paths:\n${sample}`);
    }

    const missing = requiredPackagePaths.filter(
      (rule) => !listing.some((entry) => matches(entry, rule))
    );
    if (missing.length > 0) {
      throw new Error(
        `package is missing required paths: ${missing.map((rule) => rule.label).join(", ")}`
      );
    }
    requiredPayloadTextChecks(unpackedPackageDir);

    const stats = fs.statSync(archivePath);
    console.log(
      `package ok: ${listing.length} entries, ${(stats.size / 1024).toFixed(1)} KiB, ${archivePath}`
    );

    run("Install extracted package dependencies", "pnpm", ["install", "--no-frozen-lockfile"], {
      cwd: unpackedPackageDir,
    });
    run("Smoke extracted package", "pnpm", ["run", "smoke:integration"], {
      cwd: unpackedPackageDir,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function main() {
  try {
    run("Validate lifecycle verb manifest", "pnpm", ["run", "validate"]);
    inspectMarketplaceContract();
    requiredPayloadTextChecks();
    run("Run test suite", "pnpm", ["test"]);
    run("Run integration smoke", "pnpm", ["run", "smoke:integration"]);
    run("Dry-run Claude skill install", "bash", [
      "scripts/install-agent-skills.sh",
      "claude-user",
      "--dry-run",
    ]);
    run("Dry-run Codex skill install", "bash", [
      "scripts/install-agent-skills.sh",
      "codex",
      "--dry-run",
    ]);
    run("Dry-run Copilot skill install", "bash", [
      "scripts/install-agent-skills.sh",
      "copilot",
      "--dry-run",
    ]);
    run("Audit production dependencies", "pnpm", ["audit", "--prod"]);
    inspectPackage();

    console.log("\nrelease-check: ok");
  } catch (err) {
    console.error(`\nrelease-check: failed: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
