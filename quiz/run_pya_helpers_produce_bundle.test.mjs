import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { deriveKnowProduceBundle, formatRunDurationMs } from "../command/run_pya_helpers.mjs";

test("formatRunDurationMs prints clock style durations", () => {
  assert.equal(formatRunDurationMs(0), "00:00.000");
  assert.equal(formatRunDurationMs(12153), "00:12.153");
  assert.equal(formatRunDurationMs(125678), "02:05.678");
  assert.equal(formatRunDurationMs(3723004), "01:02:03.004");
});

test("deriveKnowProduceBundle prefers run video artifacts when result is text", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-produce-bundle-"));
  try {
    const runId = "20260311-999-teaching-video-from-filename";
    const inputFile = path.join(tmp, "know", "input", "crassus.txt");
    const videoFile = path.join(tmp, "artifacts", runId, "final-concatenate-stage.mp4");
    const metadataFile = path.join(tmp, "artifacts", runId, "final-concatenate-stage.metadata.pya");

    await fs.mkdir(path.dirname(inputFile), { recursive: true });
    await fs.mkdir(path.dirname(videoFile), { recursive: true });
    await fs.writeFile(inputFile, "source", "utf8");
    await fs.writeFile(videoFile, "video", "utf8");
    await fs.writeFile(metadataFile, "meta", "utf8");

    const bundle = await deriveKnowProduceBundle({
      cwd: tmp,
      bindingFacts: [{ transport: "filename", value: "know/input/crassus.txt" }],
      result: { ob: { text: "teaching demo" } },
      runId,
      memoryFacts: [{
        be: "artifact",
        as: { name: "video" },
        to: { filename: `artifacts/${runId}/final-concatenate-stage.mp4` }
      }]
    });

    assert.equal(bundle.some((entry) => entry.kind === "text"), false);
    assert.equal(bundle.length, 2);
    assert.equal(bundle.some((entry) => entry.ext === ".mp4"), true);
    assert.equal(bundle.some((entry) => entry.middleSuffix === ".metadata" && entry.ext === ".pya"), true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("deriveKnowProduceBundle can recover video artifact from newspaper lines", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-produce-bundle-news-"));
  try {
    const runId = "20260311-998-teaching-video-from-filename";
    const inputFile = path.join(tmp, "know", "input", "rome_short.txt");
    const videoFile = path.join(tmp, "artifacts", runId, "final-concatenate-stage.mp4");
    const metadataFile = path.join(tmp, "artifacts", runId, "final-concatenate-stage.metadata.pya");

    await fs.mkdir(path.dirname(inputFile), { recursive: true });
    await fs.mkdir(path.dirname(videoFile), { recursive: true });
    await fs.writeFile(inputFile, "source", "utf8");
    await fs.writeFile(videoFile, "video", "utf8");
    await fs.writeFile(metadataFile, "meta", "utf8");

    const bundle = await deriveKnowProduceBundle({
      cwd: tmp,
      bindingFacts: [{ transport: "filename", value: "know/input/rome_short.txt" }],
      result: { ob: { text: "teaching demo" } },
      runId,
      newspaperLines: [
        `exists su name final-concatenate-stage-001 ob name evoke-13 from name final concatenate stage to filename artifacts/${runId}/final-concatenate-stage.mp4 as name video fromtext text "abc" accordingto name sha256 by num 100 be artifact ya`
      ]
    });

    assert.equal(bundle.some((entry) => entry.kind === "text"), false);
    assert.equal(bundle.some((entry) => entry.ext === ".mp4"), true);
    assert.equal(bundle.some((entry) => entry.middleSuffix === ".metadata" && entry.ext === ".pya"), true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
