import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWordNetSenseCompoundRefinerySweepCommand } from "../command/wordnet_sense_compound_refinery.mjs";

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-sense-compound-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function completedChunk() {
  return {
    selectedSenseCount: 0,
    remainingSenseCount: 0,
    candidateCount: 0,
    translationFailureCount: 0,
    checkpointPath: "",
    result: { "promoted-sense-count": 0 }
  };
}

test("compound sweep reclaims a lock whose owner process has exited", async (t) => {
  const root = await temporaryRoot(t);
  const artifactRoot = path.join(root, "artifacts");
  await fs.mkdir(artifactRoot, { recursive: true });
  const lockPath = path.join(artifactRoot, ".wordnet-sense-compound-refinery.lock");
  await fs.writeFile(lockPath, "2147483647\n");

  const result = await runWordNetSenseCompoundRefinerySweepCommand({
    repositoryRoot: root,
    artifactRoot,
    runId: "stale-lock-test",
    report: () => {},
    dependencies: {
      prepareAllocation: async () => ({ sourceHash: "test-source" }),
      runChunk: async () => completedChunk()
    }
  });

  assert.equal(result.sweepComplete, true);
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  await assert.rejects(fs.access(`${lockPath}.recovery`), { code: "ENOENT" });
});

test("compound sweep preserves a lock owned by a live process", async (t) => {
  const root = await temporaryRoot(t);
  const artifactRoot = path.join(root, "artifacts");
  await fs.mkdir(artifactRoot, { recursive: true });
  const lockPath = path.join(artifactRoot, ".wordnet-sense-compound-refinery.lock");
  await fs.writeFile(lockPath, `${process.pid}\n`);
  let prepared = false;

  await assert.rejects(runWordNetSenseCompoundRefinerySweepCommand({
    repositoryRoot: root,
    artifactRoot,
    runId: "live-lock-test",
    report: () => {},
    dependencies: {
      prepareAllocation: async () => {
        prepared = true;
        return { sourceHash: "test-source" };
      }
    }
  }), /already active/u);

  assert.equal(prepared, false);
  assert.equal(await fs.readFile(lockPath, "utf8"), `${process.pid}\n`);
});
