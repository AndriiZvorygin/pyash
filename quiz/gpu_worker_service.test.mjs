import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("default config and system service connect learn's local GPU queue", async () => {
  const [defaults, service] = await Promise.all([
    fs.readFile(new URL("../configure/default.pya", import.meta.url), "utf8"),
    fs.readFile(new URL("../service/pyash-gpu-worker.service", import.meta.url), "utf8"),
  ]);

  assert.match(defaults, /exists su name gpu housekeeper url ob text "http:\/\/localhost:8090" be default ya/u);
  assert.match(service, /^Environment=PYA_GPU_HOUSEKEEPER_URL=http:\/\/localhost:8090$/mu);
  assert.match(service, /^Environment=PYA_GPU_WORKER_CONCURRENCY=1$/mu);
  assert.match(service, /command\/gpu_worker\.mjs .*--interval-ms 400/u);
  assert.doesNotMatch(service, /--once/u);
});
