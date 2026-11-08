import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

// configure/secret.pya holds real credentials and is git-ignored, so it is
// absent in a fresh checkout. The tracked example carries the same shape, and
// the invariant under test (no hardcoded remote housekeeper URL) has to hold
// for the example as well.
async function readSecretConfig() {
  try {
    return await fs.readFile(new URL("../configure/secret.pya", import.meta.url), "utf8");
  } catch {
    return await fs.readFile(new URL("../configure/secret.pya.example", import.meta.url), "utf8");
  }
}

test("default config and system service connect the local GPU queue", async () => {
  const [defaults, secret, service, compose, dockerfile, macInstaller, tunnel, webServer, strataHelper, worker, begin] = await Promise.all([
    fs.readFile(new URL("../configure/default.pya", import.meta.url), "utf8"),
    readSecretConfig(),
    fs.readFile(new URL("../service/pyash-gpu-worker.service", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/service/compose.gpu.yaml", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/Dockerfile", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/command/install-macos.sh", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/command/macstudio-peer-tunnel.sh", import.meta.url), "utf8"),
    fs.readFile(new URL("../command/pyash_web_server.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../command/strata_prepare_gpu.py", import.meta.url), "utf8"),
    fs.readFile(new URL("../command/gpu_worker.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../container/gpu-housekeeper/command/begin.sh", import.meta.url), "utf8"),
  ]);

  assert.match(defaults, /exists su name gpu housekeeper url ob text "http:\/\/localhost:18886" be default ya/u);
  assert.doesNotMatch(secret, /http:\/\/mriczo:8090/u);
  assert.match(service, /^WorkingDirectory=\/home\/htaf\/pyash$/mu);
  assert.match(service, /^Environment=PYA_GPU_HOUSEKEEPER_URL=http:\/\/localhost:18886$/mu);
  assert.match(compose, /"--port", "18886"/u);
  assert.match(compose, /GPU_HOUSEKEEPER_PUBLISH_PORT:-18886\}:18886/u);
  assert.match(compose, /enable_ipv6: true/u);
  assert.match(compose, /GPU_HOUSEKEEPER_IPV6_SUBNET/u);
  assert.match(begin, /docker network inspect bridge/u);
  assert.match(begin, /housekeeper_ipv6_subnet\.py/u);
  assert.match(begin, /GPU_HOUSEKEEPER_ENV_FILE/u);
  assert.match(begin, /refusing IPv6 network migration/u);
  assert.match(begin, /\/queue/u);
  assert.match(begin, /network_migration_needed=true/u);
  assert.ok(
    begin.indexOf('docker compose "${COMPOSE_ENV_ARGS[@]}" -p gpu-housekeeper -f "$COMPOSE_FILE" down')
      < begin.indexOf('docker compose "${COMPOSE_ENV_ARGS[@]}" -p gpu-housekeeper -f "$COMPOSE_FILE" up'),
    "an idle network migration must remove the old project network before compose up"
  );
  assert.doesNotMatch(compose, /8090/u);
  assert.match(dockerfile, /EXPOSE 18886/u);
  assert.match(macInstaller, /GPU_HOUSEKEEPER_PORT:-18886/u);
  assert.match(macInstaller, /GPU_HOUSEKEEPER_STRATA_ACTION_TIMEOUT_SEC:-1800/u);
  assert.match(macInstaller, /"runtimeActionTimeoutSec": int\(os\.environ\["STRATA_ACTION_TIMEOUT_SEC"\]\)/u);
  assert.match(tunnel, /GPU_HOUSEKEEPER_TUNNEL_REMOTE_PORT:-18886/u);
  assert.match(tunnel, /GPU_HOUSEKEEPER_TUNNEL_LOCAL_PORT:-18887/u);
  assert.match(webServer, /DEFAULT_GPU_HOUSEKEEPER_URL/u);
  assert.match(strataHelper, /PYASH_GPU_HOUSEKEEPER_URL", "http:\/\/127\.0\.0\.1:18886"/u);
  assert.doesNotMatch(service, /^Environment=PYA_GPU_WORKER_CONCURRENCY=/mu);
  assert.match(worker, /discoverGpuWorkerCapacity\(\{ housekeeperUrl \}\)/u);
  assert.match(service, /command\/gpu_worker\.mjs .*--interval-ms 400/u);
  assert.doesNotMatch(service, /--once/u);
});

test("Housekeeper IPv6 subnet derives the Kwon word from each Docker host prefix", () => {
  const helper = new URL("../container/gpu-housekeeper/command/housekeeper_ipv6_subnet.py", import.meta.url);
  const derive = (bridgeSubnet) => execFileSync("python3", [helper.pathname], {
    input: JSON.stringify([
      { Subnet: "172.17.0.0/16" },
      { Subnet: bridgeSubnet },
    ]),
    encoding: "utf8",
  }).trim();

  assert.equal(derive("eb22:3b21:2100:e8c1:6bb0::/96"), "eb22:3b21:2100:e8c1:49c6::/80");
  assert.equal(derive("eb22:3b21:2100:e929:6bb0::/96"), "eb22:3b21:2100:e929:49c6::/80");
  assert.throws(() => execFileSync("python3", [helper.pathname], {
    input: JSON.stringify([{ Subnet: "172.17.0.0/16" }]),
    encoding: "utf8",
  }), /Docker bridge has no IPv6 subnet/u);
});
