import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { analyzeTeachingSectionSceneLock } from "../command/verify_teaching_section_scene_lock.mjs";

async function writeSection(base, {
  section = "paragraph-0",
  alignedCount = 1,
  cutCount = 1,
  drawCount = 1
} = {}) {
  const dir = path.join(base, "sections", section);
  await fs.mkdir(path.join(dir, "draw"), { recursive: true });
  const alignedRows = [];
  for (let i = 1; i <= alignedCount; i += 1) {
    alignedRows.push(`${i}\n00:00:0${i},000 --> 00:00:0${i},500\nline ${i}\n`);
  }
  await fs.writeFile(path.join(dir, "captions-aligned.srt"), `${alignedRows.join("\n")}\n`, "utf8");
  const cutRows = ["su name section cuts itinerary be series def"];
  for (let i = 1; i <= cutCount; i += 1) {
    cutRows.push(`su name cut ${String(i).padStart(3, "0")} since num ${i}.000 until num ${i}.500 ob text "line ${i}" ya`);
  }
  await fs.writeFile(path.join(dir, "section-cuts.series.pya"), `${cutRows.join("\n")}\n`, "utf8");
  for (let i = 1; i <= drawCount; i += 1) {
    await fs.writeFile(path.join(dir, "draw", `section-draw-stage-cut-${String(i).padStart(3, "0")}.png`), "", "utf8");
  }
}

test("teaching section scene lock verifier passes on matched aligned/cut/draw counts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scene-lock-pass-"));
  try {
    await writeSection(root, { section: "paragraph-0", alignedCount: 2, cutCount: 2, drawCount: 2 });
    await writeSection(root, { section: "paragraph-1", alignedCount: 1, cutCount: 1, drawCount: 1 });
    const result = await analyzeTeachingSectionSceneLock(root);
    assert.equal(result.ok, true);
    assert.equal(result.sections.length, 2);
    assert.ok(result.sections.every((row) => row.ok));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("teaching section scene lock verifier fails when a section collapses to one draw", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scene-lock-fail-"));
  try {
    await writeSection(root, { section: "paragraph-0", alignedCount: 2, cutCount: 2, drawCount: 1 });
    const result = await analyzeTeachingSectionSceneLock(root);
    assert.equal(result.ok, false);
    assert.equal(result.sections[0]?.ok, false);
    assert.equal(result.sections[0]?.alignedCount, 2);
    assert.equal(result.sections[0]?.cutCount, 2);
    assert.equal(result.sections[0]?.drawCount, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

