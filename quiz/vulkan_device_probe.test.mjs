import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "rust/pyac-gpu/probe-vulkan-device.sh");

function runProbe({ computeQueue = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-vulkan-probe-test-"));
  try {
    const gpu = path.join(temp, "nvidia-smi");
    const vulkan = path.join(temp, "vulkaninfo");
    fs.writeFileSync(gpu, "#!/bin/sh\necho 'NVIDIA GeForce RTX 3060, 535.247.01, 12288, 11934, 0'\n");
    fs.writeFileSync(vulkan, [
      "#!/bin/sh",
      "cat <<'OUTPUT'",
      "apiVersion = 1.3.242",
      "deviceType = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU",
      "deviceName = NVIDIA GeForce RTX 3060",
      `queueFlags = QUEUE_GRAPHICS | ${computeQueue ? "QUEUE_COMPUTE | " : ""}QUEUE_TRANSFER`,
      "OUTPUT",
      "",
    ].join("\n"));
    fs.chmodSync(gpu, 0o755);
    fs.chmodSync(vulkan, 0o755);
    return spawnSync("bash", [script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${temp}:${process.env.PATH}` },
      timeout: 15000,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test("Vulkan probe accepts a visible discrete NVIDIA compute device", () => {
  const result = runProbe();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: discrete NVIDIA Vulkan 1\.2\+ compute device/u);
  assert.match(result.stdout, /does not build shaders/u);
});

test("Vulkan probe rejects an adapter without a compute queue", () => {
  const result = runProbe({ computeQueue: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no Vulkan compute queue/u);
});
