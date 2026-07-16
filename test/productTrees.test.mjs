import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  productTreeRegistry,
  productTreeKeys,
  isProductTreeKey,
  getProductTree,
  CWD_SELF,
  CWD_WORKSPACE,
  CWD_PACKAGE
} from "../src/productTrees.mjs";

function withEnvTrees(value, fn) {
  const prev = process.env.ROI_PRODUCT_TREES;
  if (value === undefined) {
    delete process.env.ROI_PRODUCT_TREES;
  } else {
    process.env.ROI_PRODUCT_TREES = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.ROI_PRODUCT_TREES;
    } else {
      process.env.ROI_PRODUCT_TREES = prev;
    }
  }
}

test("registry ships bmo and roi built-ins", () => {
  withEnvTrees(undefined, () => {
    const keys = productTreeKeys("/tmp/does-not-exist");
    assert.ok(keys.has("bmo"));
    assert.ok(keys.has("roi"));
    assert.equal(getProductTree("roi", "/tmp/x").cwd, CWD_PACKAGE);
    assert.equal(getProductTree("bmo", "/tmp/x").cwd, CWD_WORKSPACE);
  });
});

test("ROI_PRODUCT_TREES registers additional trees", () => {
  withEnvTrees(
    JSON.stringify([{ key: "webapp", subdir: "packages/web", cwd: "self" }]),
    () => {
      assert.ok(isProductTreeKey("webapp", "/tmp/x"));
      const tree = getProductTree("webapp", "/tmp/x");
      assert.equal(tree.subdir, "packages/web");
      assert.equal(tree.cwd, CWD_SELF);
      assert.equal(tree.builtin, false);
    }
  );
});

test("env trees may override a built-in subdir/cwd but keep builtin flag", () => {
  withEnvTrees(JSON.stringify([{ key: "bmo", subdir: "bmo-fork", cwd: "self" }]), () => {
    const tree = getProductTree("bmo", "/tmp/x");
    assert.equal(tree.subdir, "bmo-fork");
    assert.equal(tree.cwd, CWD_SELF);
    assert.equal(tree.builtin, true);
  });
});

test("descriptors with unsafe subdir or bad key are dropped", () => {
  withEnvTrees(
    JSON.stringify([
      { key: "bad key with spaces", subdir: "x" },
      { key: "escape", subdir: "../outside" },
      { key: "ABS", subdir: "/etc" },
      { key: "ok", subdir: "fine" }
    ]),
    () => {
      const keys = productTreeKeys("/tmp/x");
      assert.ok(!keys.has("bad key with spaces"));
      assert.ok(!keys.has("escape"));
      assert.ok(!keys.has("abs"));
      assert.ok(keys.has("ok"));
    }
  );
});

test("roi.config.json at workspace root registers trees", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-config-"));
  try {
    fs.writeFileSync(
      path.join(dir, "roi.config.json"),
      JSON.stringify({ product_trees: [{ key: "svc", subdir: "services/api" }] })
    );
    withEnvTrees(undefined, () => {
      assert.ok(isProductTreeKey("svc", dir));
      assert.equal(getProductTree("svc", dir).subdir, "services/api");
      // default cwd is self
      assert.equal(getProductTree("svc", dir).cwd, CWD_SELF);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("env trees take precedence over config-file trees by key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-config-"));
  try {
    fs.writeFileSync(
      path.join(dir, "roi.config.json"),
      JSON.stringify({ product_trees: [{ key: "svc", subdir: "from-config" }] })
    );
    withEnvTrees(JSON.stringify([{ key: "svc", subdir: "from-env" }]), () => {
      assert.equal(getProductTree("svc", dir).subdir, "from-env");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed config/env JSON is ignored without throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-config-"));
  try {
    fs.writeFileSync(path.join(dir, "roi.config.json"), "{ not json ");
    withEnvTrees("also not json", () => {
      const keys = productTreeKeys(dir);
      assert.ok(keys.has("bmo"));
      assert.ok(keys.has("roi"));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
