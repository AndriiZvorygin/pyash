import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectWordnetSweep,
  pyaFacts,
  shouldInvokeRecovery,
} from "../world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs";
import { readSweepRecoveryConfig } from "../world/house/refinery-watchdog/program/wordnet-sweep-recovery.mjs";
import {
  mergeManagedCrontab,
  parseKwonLookupIndexRefreshSchedule
} from "../world/house/refinery-watchdog/program/watchdog-lib.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    assert.equal(shouldInvokeRecovery(status), false);
  } finally {
    await fixture.cleanup();
  }
});

test("watchdog Pyash facts must preserve the requested subject name when parsed", () => {
  assert.match(pyaFacts({ "WordNet recovery restart verified time": "2026-11-13T05:17:32Z" }), /restart verified time/u);
  assert.throws(() => pyaFacts({ "WordNet recovery restart verified at": "2026-11-13T05:17:32Z" }), /does not round-trip/u);
});

test("the watchdog recognizes its documented resume entry point as the sweep owner", async () => {
  const fixture = await makeSweepFixture();
  try {
    const status = await inspectWordnetSweep({
      repositoryRoot: fixture.root,
      artifactDirectory: fixture.artifacts,
      lockPath: fixture.lockPath,
      readProcess: () => ({
        alive: true,
        cwd: fixture.root,
        command: ["/usr/bin/node", "world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs"],
      }),
    });
    assert.equal(status.state, "healthy");
    assert.equal(status.active, true);
    assert.equal(status.conflictingLiveLock, false);
    assert.equal(shouldInvokeRecovery(status), false);
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
    assert.equal(shouldInvokeRecovery(status), true);
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
    assert.equal(shouldInvokeRecovery(stoppedStatus), true);
    assert.equal(completeStatus.state, "complete");
    assert.equal(shouldInvokeRecovery(completeStatus), false);
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
    assert.equal(shouldInvokeRecovery(status), true);
  } finally {
    await fixture.cleanup();
  }
});

test("recovery uses its Pyash-selected Spark-X model and the cron merge schedules hourly checks", () => {
  const config = readSweepRecoveryConfig();
  assert.equal(config.model, "SparkLLM/Spark-X2.6-4B:q4_k_m");
  assert.match(config.context.resumeProcedure, /same run id/u);
  assert.match(config.context.resumeProcedure, /Housekeeper queue for every model call/u);
  assert.match(config.context.postRestartReview, /root cause/u);
  const crontab = mergeManagedCrontab("# keep this\n11 1 * * * true\n", { nodeBin: "/usr/bin/node" });
  assert.match(crontab, /^11 1 \* \* \* true$/mu);
  assert.ok(crontab.includes(
    `0 * * * * cd ${REPOSITORY_ROOT} && /usr/bin/node ${path.join(REPOSITORY_ROOT, "world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs")} >> ${path.join(REPOSITORY_ROOT, "world/house/refinery-watchdog/artifacts/cron.log")} 2>&1`,
  ));
  assert.ok(crontab.includes(
    `17 * * * * /usr/bin/flock -n /tmp/pyash-kwon-lookup-index-refresh.lock /usr/bin/node ${path.join(REPOSITORY_ROOT, "command/vocab_lookup_index.mjs")} >> ${path.join(REPOSITORY_ROOT, "world/house/refinery-watchdog/artifacts/cron.log")} 2>&1`,
  ));
});

test("Kwon index refresh schedule is managed through its Pyash calendar value", () => {
  assert.equal(parseKwonLookupIndexRefreshSchedule("minute 17 every hour"), "17 * * * *");
  assert.equal(parseKwonLookupIndexRefreshSchedule("disabled"), null);
  assert.throws(() => parseKwonLookupIndexRefreshSchedule("whenever"), /invalid kwon lookup index refresh schedule/u);
});
