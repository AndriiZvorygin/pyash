import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("GPU worker service loads the secret Housekeeper endpoint", async () => {
  const [defaults, secret, service] = await Promise.all([
    fs.readFile(new URL("../configure/default.pya", import.meta.url), "utf8"),
    fs.readFile(new URL("../configure/secret.pya", import.meta.url), "utf8"),
    fs.readFile(new URL("../service/pyash-gpu-worker.service", import.meta.url), "utf8"),
  ]);

  assert.match(defaults, /exists su name gpu housekeeper url ob text "http:\/\/localhost:8090" be default ya/u);
  assert.match(secret, /exists su name gpu housekeeper url ob text "http:\/\/mriczo:8090" be default ya/u);
  assert.match(service, /^WorkingDirectory=\/home\/htaf\/pyash$/mu);
  assert.doesNotMatch(service, /^Environment=PYA_GPU_HOUSEKEEPER_URL=/mu);
  assert.doesNotMatch(service, /\/home\/htaf\/pyac\/pyash/u);
  assert.match(service, /^Environment=PYA_GPU_WORKER_CONCURRENCY=1$/mu);
  assert.match(service, /command\/gpu_worker\.mjs .*--interval-ms 400/u);
  assert.doesNotMatch(service, /--once/u);
});
