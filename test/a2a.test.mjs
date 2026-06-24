import assert from "node:assert/strict";
import test from "node:test";
import { A2AExecutor, assertSafeAgentCardUrl } from "../src/a2a.mjs";

test("assertSafeAgentCardUrl rejects non-http(s) schemes", () => {
  assert.throws(() => assertSafeAgentCardUrl("file:///etc/passwd"), /scheme must be http or https/);
  assert.throws(() => assertSafeAgentCardUrl("ftp://example.test/card"), /scheme must be http or https/);
  assert.throws(() => assertSafeAgentCardUrl("not a url"), /not a valid URL/);
});

test("assertSafeAgentCardUrl blocks cloud-metadata and private targets by default", () => {
  // Canonical SSRF target.
  assert.throws(() => assertSafeAgentCardUrl("http://169.254.169.254/latest/meta-data/"), /blocked private\/loopback/);
  assert.throws(() => assertSafeAgentCardUrl("http://metadata.google.internal/"), /blocked private\/loopback/);
  // RFC1918 ranges.
  assert.throws(() => assertSafeAgentCardUrl("http://10.0.0.5:8080/card"), /blocked private\/loopback/);
  assert.throws(() => assertSafeAgentCardUrl("http://172.16.0.1/card"), /blocked private\/loopback/);
  assert.throws(() => assertSafeAgentCardUrl("http://192.168.1.10/card"), /blocked private\/loopback/);
  // Link-local + IPv6 unique-local.
  assert.throws(() => assertSafeAgentCardUrl("http://169.254.10.10/card"), /blocked private\/loopback/);
  assert.throws(() => assertSafeAgentCardUrl("http://[fd00::1]/card"), /blocked private\/loopback/);
});

test("assertSafeAgentCardUrl allows loopback by default (local-first happy path)", () => {
  // Loopback only reaches the operator's own machine — this is the documented
  // normal A2A delegation case (SECURITY.md), not an SSRF escape.
  assert.doesNotThrow(() => assertSafeAgentCardUrl("http://127.0.0.1:41234/a2a"));
  assert.doesNotThrow(() => assertSafeAgentCardUrl("http://localhost:41234/a2a"));
  assert.doesNotThrow(() => assertSafeAgentCardUrl("http://[::1]:41234/a2a"));
  // A public host is always fine.
  assert.doesNotThrow(() => assertSafeAgentCardUrl("https://agent.example.com/card"));
});

test("assertSafeAgentCardUrl honors allowPrivate to permit RFC1918 peers", () => {
  assert.doesNotThrow(() => assertSafeAgentCardUrl("http://10.0.0.5/card", { allowPrivate: true }));
  assert.doesNotThrow(() =>
    assertSafeAgentCardUrl("http://169.254.169.254/", { allowPrivate: true })
  );
});

test("A2AExecutor.invoke rejects a blocked target before constructing a client", async () => {
  let createdClient = false;
  const clientFactory = {
    async createFromUrl() {
      createdClient = true;
      return {};
    }
  };
  const executor = new A2AExecutor({ clientFactory });
  await assert.rejects(
    () => executor.invoke({ agentCardUrl: "http://169.254.169.254/", message: "hi" }),
    /blocked private\/loopback/
  );
  assert.equal(createdClient, false, "must not reach the SDK client for a blocked URL");
});

test("A2AExecutor.invoke rejects hostnames that resolve to private or link-local addresses", async () => {
  for (const address of ["10.1.2.3", "172.16.2.3", "192.168.2.3", "169.254.169.254", "fd00::1", "fe80::1"]) {
    let createdClient = false;
    const clientFactory = {
      async createFromUrl() {
        createdClient = true;
        return {};
      }
    };
    const executor = new A2AExecutor({
      clientFactory,
      dnsLookup: async () => [{ address, family: 4 }]
    });
    await assert.rejects(
      () => executor.invoke({ agentCardUrl: "https://delegated-agent.example.test/card", message: "hi" }),
      /blocked private\/loopback/
    );
    assert.equal(createdClient, false, `must not reach the SDK client when DNS resolves to ${address}`);
  }
});

test("A2AExecutor.invoke allows a hostname that resolves to a public address", async () => {
  let lookedUpHost = "";
  let createdClient = false;
  const clientFactory = {
    async createFromUrl(url) {
      createdClient = true;
      assert.equal(url, "https://delegated-agent.example.test/card");
      return {
        async sendMessage() {
          return {
            taskId: "task-public",
            contextId: "ctx-public",
            parts: [{ kind: "text", text: "ok" }]
          };
        }
      };
    }
  };
  const executor = new A2AExecutor({
    clientFactory,
    dnsLookup: async (hostname, options) => {
      lookedUpHost = hostname;
      assert.deepEqual(options, { all: true, verbatim: true });
      return [{ address: "93.184.216.34", family: 4 }];
    }
  });

  const result = await executor.invoke({
    agentCardUrl: "https://delegated-agent.example.test/card",
    message: "hi"
  });

  assert.equal(lookedUpHost, "delegated-agent.example.test");
  assert.equal(createdClient, true);
  assert.equal(result.text, "ok");
});

test("A2AExecutor.invoke honors allowPrivate for hostnames resolving to private addresses", async () => {
  let createdClient = false;
  const clientFactory = {
    async createFromUrl() {
      createdClient = true;
      return {
        async sendMessage() {
          return {
            taskId: "task-private",
            contextId: "ctx-private",
            parts: [{ kind: "text", text: "ok" }]
          };
        }
      };
    }
  };
  const executor = new A2AExecutor({
    allowPrivate: true,
    clientFactory,
    dnsLookup: async () => [{ address: "10.1.2.3", family: 4 }]
  });

  const result = await executor.invoke({
    agentCardUrl: "https://delegated-agent.example.test/card",
    message: "hi"
  });

  assert.equal(createdClient, true);
  assert.equal(result.text, "ok");
});

test("A2AExecutor.invoke requires an agent card URL", async () => {
  const executor = new A2AExecutor({ clientFactory: { async createFromUrl() { return {}; } } });
  await assert.rejects(() => executor.invoke({ agentCardUrl: "" }), /is required for A2A execution/);
});

// Characterizing test (Cluster E — A2A RUNNING-wedge). This documents the CURRENT
// behavior: if the remote A2A call throws (e.g. the operator's process dies / the
// network drops mid-await) the executor surfaces the error to the caller rather
// than silently wedging. Recovery from a half-applied remote task (resume after a
// crash that lost the in-flight invoke) is NOT yet modeled here; the persisted
// WAITING_ON_EXTERNAL task is the durable sink that a future resume path would
// reconcile. See SECURITY.md / roi:run resume semantics.
test("A2AExecutor.invoke propagates a transport failure (characterizes RUNNING-wedge surface)", async () => {
  const clientFactory = {
    async createFromUrl() {
      return {
        async sendMessage() {
          throw new Error("ECONNRESET: remote agent process died mid-task");
        }
      };
    }
  };
  const executor = new A2AExecutor({ clientFactory });
  await assert.rejects(
    () => executor.invoke({ agentCardUrl: "http://127.0.0.1:9/a2a", message: "do work" }),
    /ECONNRESET/
  );
});
