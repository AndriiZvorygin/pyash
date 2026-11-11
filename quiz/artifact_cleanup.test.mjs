import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cleanArtifactStore } from "../program/library/artifact_cleanup.mjs";
import { registerArtifactRun } from "../program/library/artifact_store_lock.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-artifact-cleanup-"));
  await fs.mkdir(path.join(root, "newspaper"), { recursive: true });
  await fs.mkdir(path.join(root, "artifacts", "sha256"), { recursive: true });
  return root;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function putCas(root, bytes, extension = ".txt") {
  const hash = sha256(bytes);
  const filename = `${hash}${extension}`;
  const objectPath = path.join(root, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), filename);
  await fs.mkdir(path.dirname(objectPath), { recursive: true });
  await fs.writeFile(objectPath, bytes);
  return { hash, objectPath, size: bytes.length };
}

function artifactSentence({ hash, size, runId, filename = "artifact.txt" }) {
  return `exists su name artifact-001 ob name evoke-0 from name test to filename "artifacts/${runId}/${filename}" fromtext text "${hash}" accordingto name sha256 by num ${size} be artifact ya`;
}

function runNewspaper(runId, artifactLine = "", runRoot = "") {
  return [
    `exists su name ${runId} from time 2026-11-10T00:00:00Z be run ya`,
    runRoot ? `ob filename ${JSON.stringify(runRoot)} be run root ya` : "",
    artifactLine,
    `exists su name ${runId} be end ya`
  ].filter(Boolean).join("\n") + "\n";
}

async function writeRunDir(root, runId) {
  const directory = path.join(root, "artifacts", runId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "alias.txt"), "run-local alias");
  return directory;
}

async function exists(filename) {
  try {
    await fs.lstat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("artifact cleanup dry-run reports unpinned run folders and CAS without changing files", async () => {
  const root = await makeStore();
  const expiredId = "20261109-001-expired";
  const expiredDirectory = await writeRunDir(root, expiredId);
  const cas = await putCas(root, Buffer.from("unreferenced object"));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.applied, false);
  assert.deepEqual(report.runDirectories.map(item => item.runId), [expiredId]);
  assert.deepEqual(report.contentAddressedObjects.map(item => item.filename), [path.basename(cas.objectPath)]);
  assert.equal(await exists(expiredDirectory), true);
  assert.equal(await exists(cas.objectPath), true);
});

test("artifact cleanup recognizes historical four-digit run sequences", async () => {
  const root = await makeStore();
  const oldRunId = "20260204-1000-again-demo";
  const oldRunDirectory = await writeRunDir(root, oldRunId);

  const report = await cleanArtifactStore({ root });

  assert.ok(report.runDirectories.some(item => item.runId === oldRunId));
  assert.equal(await exists(oldRunDirectory), true);
});

test("valid Pyash map facts and map terminators are not malformed newspaper records", async () => {
  const root = await makeStore();
  const runId = "20261110-005-valid-map-facts";
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), [
    `exists su name ${runId} from time 2026-11-10T00:00:00Z be run ya`,
    'su name name ob text "map value" ya',
    'su name gate ob text "Approve?" be command propose',
    "Transcript payload: explanatory prose and Markdown from a tool response.",
    "prah",
    `exists su name ${runId} be end ya`
  ].join("\n"));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.blocked, false);
});

test("hash-shaped text in a parsed Pyash fact is not treated as an artifact reference", async () => {
  const root = await makeStore();
  const object = await putCas(root, Buffer.from("unreferenced despite mentioned digest"));
  const runId = "20261110-010-mentioned-digest";
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(
    runId,
    `su name commentary ob text ${JSON.stringify(`digest ${object.hash}; quoted words be artifact ya`)} be text ya`,
    root
  ));

  const plan = await cleanArtifactStore({ root });

  assert.equal(plan.blocked, false);
  assert.equal(plan.referencedContentAddressedObjects, 0);
  assert.equal(plan.contentAddressedObjects.some(item => item.path === object.objectPath), true);
});

test("stage manifest artifacts retain their run directory without being treated as CAS references", async () => {
  const root = await makeStore();
  const newspaperRunId = "20261110-011-stage-manifest";
  const referencedRunId = "20261110-012-manifest-target";
  const newspaperDirectory = await writeRunDir(root, newspaperRunId);
  const referencedDirectory = await writeRunDir(root, referencedRunId);
  await fs.writeFile(path.join(root, "newspaper", `${newspaperRunId}.pya`), [
    `exists su name ${newspaperRunId} from time 2026-11-10T00:00:00Z be run ya`,
    `su name cut itinerary manifest ob filename ${JSON.stringify(path.join(root, "artifacts", referencedRunId, "cuts.series.pya"))} accordingto name cut-stage-001 be artifact ya`
  ].join("\n"));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.blocked, false);
  assert.equal(report.contentAddressedObjects.length, 0);
  assert.equal(report.runDirectories.some(item => item.path === newspaperDirectory), false);
  assert.equal(report.runDirectories.some(item => item.path === referencedDirectory), false);
});

test("a malformed newspaper artifact locator is recovered only from its matching audit digest", async () => {
  const root = await makeStore();
  const runId = "20261110-008-audited-newspaper";
  const bytes = Buffer.from("audited newspaper artifact");
  const cas = await putCas(root, bytes);
  const malformedArtifact = `exists su name newspaper-001 ob name evoke-0 from name newspaper to text "---text-stdin---y-ratio-0.42---max-width-ratio-0/newspaper/text-000001.txt as name text fromtext text " accordingto name sha256 by num ${cas.size} be artifact ya`;
  const auditResult = `su name command audit 000001 as name result totext text "artifact newspaper-001 sha256:${cas.hash}" be command audit ya`;
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(runId, `${malformedArtifact}\n${auditResult}`, root));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.blocked, false);
  assert.equal(report.referencedContentAddressedObjects, 1);
  assert.equal(report.contentAddressedObjects.some(item => item.filename === path.basename(cas.objectPath)), false);
});

test("a malformed newspaper artifact locator without a matching audit remains blocked", async () => {
  const root = await makeStore();
  const runId = "20261110-009-unaudited-newspaper";
  const bytes = Buffer.from("unaudited newspaper artifact");
  const cas = await putCas(root, bytes);
  const malformedArtifact = `exists su name newspaper-001 ob name evoke-0 from name newspaper to text "---text-stdin---y-ratio-0.42---max-width-ratio-0/newspaper/text-000001.txt as name text fromtext text " accordingto name sha256 by num ${cas.size} be artifact ya`;
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(runId, malformedArtifact, root));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.blocked, true);
  assert.ok(report.blockers.some(item => item.includes("invalid SHA-256 reference")));
  assert.equal(report.contentAddressedObjects.some(item => item.filename === path.basename(cas.objectPath)), true);
});

test("external newspaper run roots do not block local artifact cleanup", async () => {
  const root = await makeStore();
  const orphanId = "20261110-013-local-orphan";
  const orphanDirectory = await writeRunDir(root, orphanId);
  await fs.writeFile(path.join(root, "newspaper", "20261110-014-external-run.pya"), [
    "exists su name 20261110-014-external-run from time 2026-11-10T00:00:00Z be run ya",
    "ob filename /workplace be run root ya",
    "exists su name malformed ob text \"missing sha reference\" be artifact ya"
  ].join("\n"));

  const report = await cleanArtifactStore({ root });

  assert.equal(report.blocked, false);
  assert.equal(report.externalArtifactRoots.includes("/workplace"), true);
  assert.equal(report.runDirectories.some(item => item.path === orphanDirectory), true);
});

test("apply cleans verified stores while preserving a store with unresolved newspaper references", async () => {
  const root = await makeStore();
  const worldRoot = path.join(root, "world");
  await fs.mkdir(path.join(worldRoot, "artifacts", "sha256"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "newspaper"), { recursive: true });
  const blockedRun = "20261110-015-blocked-store";
  const safeRun = "20261110-016-safe-store";
  const blockedDirectory = await writeRunDir(root, "20261110-017-main-orphan");
  const safeDirectory = await writeRunDir(worldRoot, "20261110-018-world-orphan");
  const safeCas = await putCas(worldRoot, Buffer.from("safe unreferenced CAS"));
  await fs.writeFile(path.join(root, "newspaper", `${blockedRun}.pya`), runNewspaper(
    blockedRun,
    `exists su name artifact-001 ob name evoke-0 from name test to filename "artifacts/${blockedRun}/artifact.txt" fromtext text "bad-hash" accordingto name sha256 by num 3 be artifact ya`,
    root
  ));
  await fs.writeFile(path.join(worldRoot, "newspaper", `${safeRun}.pya`), runNewspaper(safeRun));

  const report = await cleanArtifactStore({ root, apply: true });

  assert.equal(report.applied, true);
  assert.equal(report.blocked, true);
  assert.deepEqual(report.blockedStoreRoots, [root]);
  assert.equal(report.removedRunDirectories.length, 1);
  assert.equal(report.removedContentAddressedObjects.length, 1);
  assert.equal(await exists(blockedDirectory), true);
  assert.equal(await exists(safeDirectory), false);
  assert.equal(await exists(safeCas.objectPath), false);
});

test("newspapers pin shared CAS objects and complete run directories until the last newspaper is removed", async () => {
  const root = await makeStore();
  const firstId = "20261110-001-first";
  const secondId = "20261110-002-second";
  const firstDirectory = await writeRunDir(root, firstId);
  const secondDirectory = await writeRunDir(root, secondId);
  const cas = await putCas(root, Buffer.from("shared object"));
  const line = artifactSentence({ hash: cas.hash, size: cas.size, runId: firstId });
  await fs.writeFile(path.join(root, "newspaper", `${firstId}.pya`), runNewspaper(firstId, line, root));
  await fs.mkdir(path.join(root, "world", "newspaper"), { recursive: true });
  await fs.writeFile(path.join(root, "world", "newspaper", `${secondId}.pya`), runNewspaper(secondId, artifactSentence({
    hash: cas.hash,
    size: cas.size,
    runId: secondId
  }), root));
  await fs.mkdir(path.join(root, "know", "produce"), { recursive: true });
  await fs.link(cas.objectPath, path.join(root, "know", "produce", "kept-output.txt"));

  const firstSweep = await cleanArtifactStore({ root, apply: true });
  assert.equal(firstSweep.blocked, false);
  assert.equal(await exists(firstDirectory), true);
  assert.equal(await exists(secondDirectory), true);
  assert.equal(await exists(cas.objectPath), true);

  await fs.rm(path.join(root, "world", "newspaper", `${secondId}.pya`));
  const secondSweep = await cleanArtifactStore({ root, apply: true });
  assert.equal(await exists(firstDirectory), true);
  assert.equal(await exists(secondDirectory), false);
  assert.equal(await exists(cas.objectPath), true);

  await fs.rm(path.join(root, "newspaper", `${firstId}.pya`));
  const thirdSweep = await cleanArtifactStore({ root, apply: true });
  assert.equal(await exists(firstDirectory), false);
  assert.equal(await exists(cas.objectPath), false);
  assert.equal(await fs.readFile(path.join(root, "know", "produce", "kept-output.txt"), "utf8"), "shared object");
  assert.equal(thirdSweep.blocked, false);
});

test("malformed newspapers and hash mismatches block destructive cleanup", async () => {
  const root = await makeStore();
  const runId = "20261110-001-uncertain";
  const directory = await writeRunDir(root, runId);
  const cas = await putCas(root, Buffer.from("damaged object"));
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), `exists su name damaged ob name artifact be artifact ya\n${runNewspaper(runId, artifactSentence({
    hash: cas.hash,
    size: cas.size,
    runId
  }), root)}`);

  const report = await cleanArtifactStore({ root, apply: true });

  assert.equal(report.blocked, true);
  assert.ok(report.blockers.some(item => item.includes("invalid SHA-256 reference")));
  assert.equal(await exists(directory), true);
  assert.equal(await exists(cas.objectPath), true);

  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(runId, artifactSentence({
    hash: cas.hash,
    size: cas.size,
    runId
  }), root));
  await fs.writeFile(cas.objectPath, "Damaged object");
  const mismatch = await cleanArtifactStore({ root, apply: true });
  assert.equal(mismatch.blocked, true);
  assert.ok(mismatch.blockers.some(item => item.includes("hash mismatch")));
  assert.equal(await exists(directory), true);
});

test("a newspaper reference to a missing CAS object blocks cleanup", async () => {
  const root = await makeStore();
  const runId = "20261110-004-missing-object";
  const runDirectory = await writeRunDir(root, runId);
  const missingBytes = Buffer.from("missing object");
  const hash = sha256(missingBytes);
  await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(runId, artifactSentence({
    hash,
    size: missingBytes.length,
    runId
  }), root));

  const report = await cleanArtifactStore({ root, apply: true });

  assert.equal(report.blocked, true);
  assert.ok(report.blockers.some(item => item.includes("references missing content-addressed artifact")));
  assert.equal(await exists(runDirectory), true);
});

test("artifact records with invalid hashes or byte sizes block cleanup", async () => {
  for (const [runId, artifactLine] of [
    ["20261110-006-invalid-hash", 'exists su name artifact-001 ob name evoke-0 from name test to filename "artifacts/20261110-006-invalid-hash/artifact.txt" fromtext text "bad-hash" accordingto name sha256 by num 3 be artifact ya'],
    ["20261110-007-invalid-size", `exists su name artifact-001 ob name evoke-0 from name test to filename "artifacts/20261110-007-invalid-size/artifact.txt" fromtext text "${"a".repeat(64)}" accordingto name sha256 by num 1.5 be artifact ya`]
  ]) {
    const root = await makeStore();
    const runDirectory = await writeRunDir(root, runId);
    await fs.writeFile(path.join(root, "newspaper", `${runId}.pya`), runNewspaper(runId, artifactLine, root));

    const report = await cleanArtifactStore({ root, apply: true });

    assert.equal(report.blocked, true, runId);
    assert.equal(await exists(runDirectory), true, runId);
  }
});

test("world newspapers pin artifacts in their corresponding world artifact store", async () => {
  const root = await makeStore();
  const worldRoot = path.join(root, "world");
  const runId = "20261110-003-saddle-world";
  const runDirectory = await writeRunDir(worldRoot, runId);
  const cas = await putCas(worldRoot, Buffer.from("world-scoped artifact"));
  const newspaperDirectory = path.join(worldRoot, "newspaper");
  await fs.mkdir(newspaperDirectory, { recursive: true });
  await fs.writeFile(path.join(newspaperDirectory, `${runId}.pya`), runNewspaper(runId, artifactSentence({
    hash: cas.hash,
    size: cas.size,
    runId
  })));

  const pinned = await cleanArtifactStore({ root, apply: true });
  assert.equal(await exists(runDirectory), true);
  assert.equal(await exists(cas.objectPath), true);
  assert.equal(pinned.referencedContentAddressedObjects, 1);

  await fs.rm(path.join(newspaperDirectory, `${runId}.pya`));
  await cleanArtifactStore({ root, apply: true });
  assert.equal(await exists(runDirectory), false);
  assert.equal(await exists(cas.objectPath), false);
});

test("collector preserves unknown artifact roots and refuses apply while a run lease is active", async () => {
  const root = await makeStore();
  const unknown = path.join(root, "artifacts", "downloads");
  await fs.mkdir(unknown, { recursive: true });
  await fs.writeFile(path.join(unknown, "keep.bin"), "keep");
  const active = path.join(root, "artifacts", ".active-runs");
  await fs.mkdir(active, { recursive: true });
  await fs.writeFile(path.join(active, `${process.pid}-20261110-001-active.pya`), `su name process id ob num ${process.pid} be number ya\n`);
  const orphanDirectory = await writeRunDir(root, "20261109-001-orphan");

  const report = await cleanArtifactStore({ root, apply: true });

  assert.equal(report.blocked, true);
  assert.ok(report.blockers.some(item => item.includes("active run")));
  assert.equal(await exists(orphanDirectory), true);
  assert.equal(await fs.readFile(path.join(unknown, "keep.bin"), "utf8"), "keep");
});

test("a registered live-run lease blocks cleanup until released", async () => {
  const root = await makeStore();
  const runId = "20261110-011-leased-run";
  await writeRunDir(root, "20261109-011-orphan");
  const lease = await registerArtifactRun({ root, runId });
  try {
    const report = await cleanArtifactStore({ root, apply: true });
    assert.equal(report.blocked, true);
    assert.equal(report.activeRuns.length, 1);
    assert.equal(await exists(lease.markerPath), true);
  } finally {
    lease.cleanup();
  }

  const afterRelease = await cleanArtifactStore({ root, apply: true });
  assert.equal(afterRelease.blocked, false);
  assert.equal(await exists(path.join(root, "artifacts", "20260909-011-orphan")), false);
});

test("collector refuses to traverse a symlinked CAS root", async () => {
  const root = await makeStore();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-cas-outside-"));
  await fs.rm(path.join(root, "artifacts", "sha256"), { recursive: true });
  await fs.symlink(outside, path.join(root, "artifacts", "sha256"), "dir");
  await fs.writeFile(path.join(outside, "keep.bin"), "outside");

  const report = await cleanArtifactStore({ root, apply: true });

  assert.equal(report.blocked, true);
  assert.ok(report.blockers.some(item => item.includes("CAS root is not a real directory")));
  assert.equal(await fs.readFile(path.join(outside, "keep.bin"), "utf8"), "outside");
});
