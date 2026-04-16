import test from "node:test";
import assert from "node:assert/strict";

import { createGpuHousekeeperAdapter } from "../../../program/runtime/gpu/housekeeper_adapter.mjs";

function makeJsonResponse({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function withMockFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), options: { ...options } };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("housekeeper adapter getHealth calls GET /health and parses response", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { status: "ok", timestamp: "2026-04-01T00:00:00.000Z" } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090/" });
      const result = await adapter.getHealth();

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/health");
      assert.equal(calls[0].options.method, "GET");
      assert.deepEqual(result, { status: "ok", timestamp: "2026-04-01T00:00:00.000Z" });
    }
  );
});

test("housekeeper adapter getSnapshot calls GET /snapshot", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { hostId: "renderbox", queueDepth: 0, devices: [], profiles: [] } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090" });
      const result = await adapter.getSnapshot();

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/snapshot");
      assert.equal(calls[0].options.method, "GET");
      assert.equal(result.hostId, "renderbox");
    }
  );
});

test("housekeeper adapter getQueue calls GET /queue", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { queueDepth: 1, jobs: [{ remoteJobId: "job-1" }] } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090" });
      const result = await adapter.getQueue();

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/queue");
      assert.equal(calls[0].options.method, "GET");
      assert.equal(result.queueDepth, 1);
    }
  );
});

test("housekeeper adapter submitJob posts expected payload", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { remoteJobId: "job-abc", accepted: true } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090", hostId: "renderbox" });
      const result = await adapter.submitJob({
        handleId: "h-1",
        runtimeName: "ollama",
        profileName: "qwen2.5",
        jobSpec: { prompt: "hello" }
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/submit");
      assert.equal(calls[0].options.method, "POST");
      assert.equal(calls[0].options.headers["content-type"], "application/json");
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        handleId: "h-1",
        runtimeName: "ollama",
        profileName: "qwen2.5",
        jobSpec: { prompt: "hello" },
        hostId: "renderbox"
      });
      assert.deepEqual(result, { remoteJobId: "job-abc", accepted: true });
    }
  );
});

test("housekeeper adapter getJobStatus calls GET /job/<id>", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { status: "running", message: "working", startedAt: "", finishedAt: "" } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090" });
      const result = await adapter.getJobStatus({ remoteJobId: "job/one" });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/job/job%2Fone");
      assert.equal(calls[0].options.method, "GET");
      assert.equal(result.status, "running");
    }
  );
});

test("housekeeper adapter discharge posts expected payload", async () => {
  await withMockFetch(
    async () => makeJsonResponse({ body: { success: true } }),
    async (calls) => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090", hostId: "renderbox" });
      const result = await adapter.discharge({ profileName: "qwen2.5" });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://housekeeper:8090/discharge");
      assert.equal(calls[0].options.method, "POST");
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        profileName: "qwen2.5",
        hostId: "renderbox"
      });
      assert.deepEqual(result, { success: true });
    }
  );
});

test("housekeeper adapter throws on non-200 responses", async () => {
  await withMockFetch(
    async (call, index) => {
      if (index === 0) return makeJsonResponse({ status: 500, body: { error: "boom" } });
      return makeJsonResponse({ status: 404, body: { error: "missing" } });
    },
    async () => {
      const adapter = createGpuHousekeeperAdapter({ baseUrl: "http://housekeeper:8090" });
      await assert.rejects(
        () => adapter.getHealth(),
        /gpu housekeeper adapter defective \(500\)/
      );
      await assert.rejects(
        () => adapter.submitJob({ handleId: "h", runtimeName: "r", profileName: "p", jobSpec: {} }),
        /gpu housekeeper adapter defective \(404\)/
      );
    }
  );
});
