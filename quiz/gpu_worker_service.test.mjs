import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("default config and system service connect learn's local GPU queue", async () => {
  const [defaults, service, compose, dockerfile, macInstaller, tunnel, webServer, strataHelper] = await Promise.all([
    fs.readFile(new URL("../configure/default.pya", import.meta.url), "utf8"),
    fs.readFile(new URL("../service/pyash-gpu-worker.service", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/service/compose.gpu.yaml", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/Dockerfile", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/command/install-macos.sh", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/command/macstudio-peer-tunnel.sh", import.meta.url), "utf8"),
    fs.readFile(new URL("../command/pyash_web_server.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../command/strata_prepare_gpu.py", import.meta.url), "utf8"),
  ]);

  assert.match(defaults, /exists su name gpu housekeeper url ob text "http:\/\/localhost:18886" be default ya/u);
  assert.match(service, /^Environment=PYA_GPU_HOUSEKEEPER_URL=http:\/\/localhost:18886$/mu);
  assert.match(compose, /"--port", "18886"/u);
  assert.match(compose, /GPU_HOUSEKEEPER_PUBLISH_PORT:-18886\}:18886/u);
  assert.match(compose, /"8090:18886"/u);
  assert.match(dockerfile, /EXPOSE 18886/u);
  assert.match(macInstaller, /GPU_HOUSEKEEPER_PORT:-18886/u);
  assert.match(tunnel, /GPU_HOUSEKEEPER_TUNNEL_REMOTE_PORT:-18886/u);
  assert.match(tunnel, /GPU_HOUSEKEEPER_TUNNEL_LOCAL_PORT:-18887/u);
  assert.match(webServer, /\|\| "http:\/\/localhost:18886"/u);
  assert.match(strataHelper, /PYASH_GPU_HOUSEKEEPER_URL", "http:\/\/127\.0\.0\.1:18886"/u);
  assert.match(service, /^Environment=PYA_GPU_WORKER_CONCURRENCY=1$/mu);
  assert.match(service, /command\/gpu_worker\.mjs .*--interval-ms 400/u);
  assert.doesNotMatch(service, /--once/u);
});
