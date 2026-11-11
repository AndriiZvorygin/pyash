import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readNewspaperLimits, rotateWorldNewspapers, verifyNewspaperSet } from "../program/agent/newspaper_retention.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { parse } from "../program/understand/index.mjs";

function mapRecord(id, payload = "") {
  return [
    `su name record ${id} be json map def`,
    `su name marker ob text "record-${id}-${payload}" ya`,
    `su name nested ${id} be json map def`,
    `su name detail ob text "nested-${id}" ya`,
    `su name nested ${id} prah`,
    "prah",
    ""
  ].join("\n");
}

test("default newspaper retention settings include a thirty-day maximum age", async () => {
  const limits = await readNewspaperLimits(path.resolve("."));
  assert.equal(limits.maximumAgeDays, 30);
});

async function makeWorld() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-retention-"));
  const operational = path.join(root, "world", "newspaper");
  const saddle = path.join(root, "world", "coding-saddle-projects", "project-1", "newspaper");
  await fs.mkdir(operational, { recursive: true });
  await fs.mkdir(saddle, { recursive: true });
  return { root, worldRoot: path.join(root, "world"), operational, saddle };
}

async function parseablePyaFiles(directories) {
  const output = [];
  for (const directory of directories) {
    for (const name of await fs.readdir(directory)) {
      if (!name.endsWith(".pya")) continue;
      const filename = path.join(directory, name);
      const source = await fs.readFile(filename, "utf8");
      for (const sentence of splitSentences(source, { includeThen: true })) {
        assert.doesNotThrow(() => parse(sentence.trim()), `${filename}: ${sentence}`);
      }
      output.push({ filename, name, source, bytes: Buffer.byteLength(source) });
    }
  }
  return output;
}

test("newspaper rotation keeps the newest complete Pyash records under both configured caps", async () => {
  const fixture = await makeWorld();
  const oldPath = path.join(fixture.operational, "20261109-old.pya");
  const newPath = path.join(fixture.saddle, "20261110-coding-saddle.pya");
  const oldContent = Array.from({ length: 7 }, (_, index) => mapRecord(`old-${index}`, "o".repeat(38))).join("");
  const newContent = [
    ...Array.from({ length: 7 }, (_, index) => mapRecord(`new-${index}`, "n".repeat(38))),
    "su name note ob text quoted.text.\nbe json map def\n.text.quoted ya\n"
  ].join("");
  await fs.writeFile(oldPath, oldContent);
  await fs.writeFile(newPath, newContent);
  await fs.utimes(oldPath, new Date("2026-11-09T12:00:00Z"), new Date("2026-11-09T12:00:00Z"));
  await fs.utimes(newPath, new Date("2026-11-10T12:00:00Z"), new Date("2026-11-10T12:00:00Z"));
  const session = path.join(fixture.worldRoot, "coding-saddle-projects", "project-1", "house", "house", "session");
  const artifactNewspaper = path.join(fixture.worldRoot, "artifacts", "run-1", "newspaper");
  await fs.mkdir(session, { recursive: true });
  await fs.mkdir(artifactNewspaper, { recursive: true });
  await fs.writeFile(path.join(session, "history.pya"), "canonical history\n");
  await fs.writeFile(path.join(artifactNewspaper, "run.pya"), "artifact newspaper\n");

  try {
    const result = await rotateWorldNewspapers({
      worldRoot: fixture.worldRoot,
      configRoot: path.resolve("."),
      maximumBytes: 1050,
      segmentMaximumBytes: 300,
      apply: true
    });
    assert.ok(result.beforeBytes > 1050);
    assert.ok(result.retainedBytes <= 1050);
    assert.ok(result.generatedParts > 1);
    const verification = await verifyNewspaperSet({
      worldRoot: fixture.worldRoot,
      maximumBytes: 1050,
      segmentMaximumBytes: 300
    });
    assert.equal(verification.files, result.generatedParts);
    assert.ok(verification.recordCount > 1);
    assert.equal(await fs.readFile(path.join(session, "history.pya"), "utf8"), "canonical history\n");
    assert.equal(await fs.readFile(path.join(artifactNewspaper, "run.pya"), "utf8"), "artifact newspaper\n");

    const parts = await parseablePyaFiles([fixture.operational, fixture.saddle]);
    assert.ok(parts.length > 1);
    for (const part of parts) {
      assert.match(part.name, /^\d{8}-\d{4}-.+\.pya$/u);
      assert.ok(part.bytes <= 300, `${part.name}: ${part.bytes}`);
    }
    assert.ok(parts.some((part) => part.source.includes("record-new-6")), "newest record was retained");
    assert.ok(!parts.some((part) => part.source.includes("record-old-0")), "oldest records were pruned first");
    assert.equal(parts.reduce((sum, part) => sum + part.bytes, 0), result.retainedBytes);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("newspaper rotation summarizes oversized records and leaves originals intact during planning", async () => {
  const fixture = await makeWorld();
  const filename = path.join(fixture.operational, "20261110-large.pya");
  const original = mapRecord("large", "x".repeat(600));
  await fs.writeFile(filename, original);
  try {
    const plan = await rotateWorldNewspapers({
      worldRoot: fixture.worldRoot,
      configRoot: path.resolve("."),
      maximumBytes: 900,
      segmentMaximumBytes: 300,
      apply: false
    });
    assert.ok(plan.retainedBytes <= 300);
    assert.equal(await fs.readFile(filename, "utf8"), original);
    assert.deepEqual((await fs.readdir(fixture.operational)).sort(), ["20261110-large.pya"]);

    await rotateWorldNewspapers({
      worldRoot: fixture.worldRoot,
      configRoot: path.resolve("."),
      maximumBytes: 900,
      segmentMaximumBytes: 300,
      apply: true
    });
    const [part] = await parseablePyaFiles([fixture.operational]);
    assert.ok(part.bytes <= 300);
    assert.match(part.source, /oversized record/u);
    assert.match(part.source, /sha256/u);
    assert.doesNotMatch(part.source, /x{100}/u);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
