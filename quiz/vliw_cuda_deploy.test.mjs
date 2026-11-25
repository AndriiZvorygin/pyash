import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Building the CUDA image needs Docker, the host CUDA toolkit, and network
// access for the pinned toolchain. It is off by default so an ordinary quiz run
// stays fast and offline-safe. PYA_VLIW_DEPLOY_TEST=1 builds the image;
// PYA_VLIW_DEPLOY_TEST=deploy also deploys and runs the conformance matrix.
const mode = String(process.env.PYA_VLIW_DEPLOY_TEST ?? "").toLowerCase();
const enabled = mode === "1" || mode === "true" || mode === "deploy";
const wantsDeploy = mode === "deploy";

const hasDocker = spawnSync("docker", ["--version"], { encoding: "utf8" }).status === 0;
const hasPtxas = fs.existsSync("/usr/local/cuda/bin/ptxas");
const unavailable = !hasDocker ? "docker is not installed"
  : !hasPtxas ? "/usr/local/cuda/bin/ptxas is not present"
  : null;

const skipReason = !enabled
  ? "set PYA_VLIW_DEPLOY_TEST=1 to build the CUDA runtime image"
  : unavailable || false;

test("CUDA runtime builds from the current tree", { skip: skipReason }, () => {
  const root = path.resolve(import.meta.dirname, "..");
  const args = ["container/pyac-vliw-runtime/command/build-and-deploy.sh"];
  if (wantsDeploy) args.push("--deploy");
  const result = spawnSync("bash", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^CUBIN_SHA256=[0-9a-f]{64}$/mu, result.stdout);
  assert.match(result.stdout, /^SOURCE_REVISION=[0-9a-f]{40}$/mu, result.stdout);
  if (wantsDeploy) {
    assert.match(result.stdout, /^DEPLOYED=1$/mu, result.stdout);
  }
});
