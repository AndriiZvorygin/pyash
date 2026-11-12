import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRecoveryCodexArgs,
  buildCodexEnvironment,
  inspectWordnetSweep,
  shouldInvokeCodexRecovery,
} from "../world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs";
import { mergeManagedCrontab } from "../world/house/refinery-watchdog/program/watchdog-lib.mjs";

async function makeSweepFixture({ remaining = 12, ageMs = 60_000, withLock = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-wordnet-watchdog-"));
  const artifacts = path.join(root, "artifacts", "target-run");
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, "worklist.pya"), `su text "meta:remaining-sense-count" ob text "${remaining}" ya\n`);
  const oldTime = new Date(Date.now() - ageMs);
  await fs.utimes(path.join(artifacts, "worklist.pya"), oldTime, oldTime);
  const lockPath = path.join(root, "artifacts", ".wordnet-sense-compound-refinery.lock");
  if (withLock) {
    await fs.writeFile(lockPath, "4321\n");
    await fs.utimes(lockPath, oldTime, oldTime);
  }
  return { root, artifacts, lockPath, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test("a live sweep with recent durable artifacts is healthy", async () => {
  const fixture = await makeSweepFixture();
  try {
    const status = await inspectWordnetSweep({
      repositoryRoot: fixture.root,
      artifactDirectory: fixture.artifacts,
      lockPath: fixture.lockPath,
      readProcess: () => ({
        alive: true,
        cwd: fixture.root,
        command: ["/usr/bin/node", "command/wordnet_sense_compound_refinery.mjs"],
      }),
    });
    assert.equal(status.state, "healthy");
    assert.equal(status.remainingSenseCount, 12);
    assert.equal(shouldInvokeCodexRecovery(status), false);
  } finally {
    await fixture.cleanup();
  }
});

test("a live sweep without durable progress beyond four hours is stalled", async () => {
  const fixture = await makeSweepFixture({ ageMs: 5 * 60 * 60 * 1000 });
  try {
    const status = await inspectWordnetSweep({
      repositoryRoot: fixture.root,
      artifactDirectory: fixture.artifacts,
      lockPath: fixture.lockPath,
      readProcess: () => ({
        alive: true,
        cwd: fixture.root,
        command: ["/usr/bin/node", "command/wordnet_sense_compound_refinery.mjs"],
      }),
    });
    assert.equal(status.state, "stalled");
    assert.equal(shouldInvokeCodexRecovery(status), true);
  } finally {
    await fixture.cleanup();
  }
});

test("a stopped incomplete sweep requests recovery while a completed one does not", async () => {
  const stopped = await makeSweepFixture({ withLock: false });
  const complete = await makeSweepFixture({ remaining: 0, withLock: false });
  try {
    const stoppedStatus = await inspectWordnetSweep({
      repositoryRoot: stopped.root,
      artifactDirectory: stopped.artifacts,
      lockPath: stopped.lockPath,
      readProcess: () => ({ alive: false, command: [], cwd: "" }),
    });
    const completeStatus = await inspectWordnetSweep({
      repositoryRoot: complete.root,
      artifactDirectory: complete.artifacts,
      lockPath: complete.lockPath,
      readProcess: () => ({ alive: false, command: [], cwd: "" }),
    });
    assert.equal(stoppedStatus.state, "stopped");
    assert.equal(shouldInvokeCodexRecovery(stoppedStatus), true);
    assert.equal(completeStatus.state, "complete");
    assert.equal(shouldInvokeCodexRecovery(completeStatus), false);
  } finally {
    await Promise.all([stopped.cleanup(), complete.cleanup()]);
  }
});

test("a live lock owned by another command is an incident, never treated as this sweep", async () => {
  const fixture = await makeSweepFixture();
  try {
    const status = await inspectWordnetSweep({
      repositoryRoot: fixture.root,
      artifactDirectory: fixture.artifacts,
      lockPath: fixture.lockPath,
      readProcess: () => ({ alive: true, cwd: fixture.root, command: ["node", "unrelated.mjs"] }),
    });
    assert.equal(status.state, "lock_conflict");
    assert.equal(status.active, false);
    assert.equal(shouldInvokeCodexRecovery(status), true);
  } finally {
    await fixture.cleanup();
  }
});

test("Codex recovery is pinned to Luna xhigh and the cron merge schedules every four hours", () => {
  const args = buildRecoveryCodexArgs({ prompt: "recover", outputPath: "/tmp/result.json", schemaPath: "/tmp/schema.json" });
  assert.deepEqual(args.slice(0, 7), [
    "exec",
    "--model", "gpt-6-luna",
    "--config", 'model_reasoning_effort="xhigh"',
    "--sandbox", "danger-full-access",
  ]);
  assert.ok(args.includes('approval_policy="never"'));
  const codexEnv = buildCodexEnvironment({
    PYA_MIND_RESPONSE: "fixture",
    PYA_GPU_HOUSEKEEPER_FIXTURE: "fixture",
    PYA_OTHER_FIXTURE: "fixture",
    PYA_GPU_HOUSEKEEPER_URL: "http://housekeeper.invalid",
    HOME: "/home/htaf",
  });
  assert.equal(codexEnv.PYA_MIND_RESPONSE, undefined);
  assert.equal(codexEnv.PYA_GPU_HOUSEKEEPER_FIXTURE, undefined);
  assert.equal(codexEnv.PYA_OTHER_FIXTURE, undefined);
  assert.equal(codexEnv.PYA_GPU_HOUSEKEEPER_URL, "http://housekeeper.invalid");
  assert.equal(codexEnv.PATH.split(path.delimiter)[0], path.dirname(process.execPath));
  const crontab = mergeManagedCrontab("# keep this\n11 1 * * * true\n", { nodeBin: "/usr/bin/node" });
  assert.match(crontab, /^11 1 \* \* \* true$/mu);
  assert.match(crontab, /^0 \*\/4 \* \* \* cd \/home\/htaf\/pyash && \/usr\/bin\/node .*run-wordnet-sweep-watchdog\.mjs/mu);
});
