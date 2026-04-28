import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function runCheckpoint(args = []) {
  return spawnSync("node", ["command/thumbnail_checkpoint_from_metadata.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("thumbnail checkpoint writes schema source and pya checkpoint from metadata", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-thumb-checkpoint-"));
  try {
    const metadataPath = path.join(tmp, "video.metadata.pya");
    const sourcePath = path.join(tmp, "source.txt");
    const sourceOut = path.join(tmp, "thumbnail-input-source.txt");
    const checkpointOut = path.join(tmp, "thumbnail-checkpoint.pya");

    await fs.writeFile(metadataPath, [
      "su name video metadata be map def",
      "su name title ob text \"A Title\" ya",
      "su name heading ob text \"A Heading\" ya",
      "su name summary ob text \"A Summary\" ya",
      "su name description ob text \"A Description\" ya",
      "prah",
      ""
    ].join("\n"), "utf8");
    await fs.writeFile(sourcePath, "source body text\n", "utf8");

    const run = runCheckpoint([metadataPath, sourcePath, sourcePath, sourceOut, checkpointOut]);
    assert.equal(run.status, 0, run.stderr || "checkpoint command should pass");

    const sourceOutText = await fs.readFile(sourceOut, "utf8");
    assert.match(sourceOutText, /^HOOK_SUBJECT:/m);
    assert.match(sourceOutText, /^EMOTION:/m);
    assert.match(sourceOutText, /^FRAMING:/m);
    assert.match(sourceOutText, /^BACKGROUND:/m);
    assert.match(sourceOutText, /^OVERLAY_TEXT:/m);
    assert.match(sourceOutText, /^COLOUR_CONTRAST:/m);
    assert.match(sourceOutText, /^STYLE:/m);
    assert.match(sourceOutText, /^CLARITY_RULES:/m);
    assert.match(sourceOutText, /^NEGATIVE_PROMPT:/m);

    const checkpointText = await fs.readFile(checkpointOut, "utf8");
    assert.match(checkpointText, /su name thumbnail checkpoint be map def/);
    assert.match(checkpointText, /su name HOOK_SUBJECT ob text/);
    assert.match(checkpointText, /su name OVERLAY_TEXT ob text/);
    assert.match(checkpointText, /su name NEGATIVE_PROMPT ob text/);

    const overlayLine = sourceOutText.split(/\r?\n/).find((line) => line.startsWith("OVERLAY_TEXT:")) || "";
    const overlayWords = overlayLine.replace(/^OVERLAY_TEXT:\s*/i, "").trim().split(/\s+/).filter(Boolean);
    assert.ok(overlayWords.length >= 2 && overlayWords.length <= 5, `expected 2-5 overlay words, got ${overlayWords.length}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("thumbnail checkpoint fails with clear error when required metadata is missing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-thumb-checkpoint-missing-"));
  try {
    const metadataPath = path.join(tmp, "video.metadata.pya");
    const sourcePath = path.join(tmp, "source.txt");
    const sourceOut = path.join(tmp, "thumbnail-input-source.txt");
    const checkpointOut = path.join(tmp, "thumbnail-checkpoint.pya");

    await fs.writeFile(metadataPath, [
      "su name video metadata be map def",
      "su name title ob text \"\" ya",
      "su name heading ob text \"\" ya",
      "su name summary ob text \"\" ya",
      "su name description ob text \"\" ya",
      "prah",
      ""
    ].join("\n"), "utf8");
    await fs.writeFile(sourcePath, "source body text\n", "utf8");

    const run = runCheckpoint([metadataPath, sourcePath, sourcePath, sourceOut, checkpointOut]);
    assert.notEqual(run.status, 0, "checkpoint command should fail");
    assert.match(String(run.stderr || ""), /thumbnail checkpoint defective: missing required metadata fields/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("thumbnail checkpoint fixture test using wide-one-sentence metadata path", async (t) => {
  const metadataPath = path.join(repoRoot, "know", "produce", "wide-one-sentence-10.metadata.pya");
  try {
    await fs.access(metadataPath);
  } catch {
    t.skip("fixture metadata path not present");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-thumb-checkpoint-fixture-"));
  try {
    const sourcePath = path.join(repoRoot, "know", "input", "wide-one-sentence.txt");
    const sourceOut = path.join(tmp, "thumbnail-input-source.txt");
    const checkpointOut = path.join(tmp, "thumbnail-checkpoint.pya");

    const run = runCheckpoint([metadataPath, sourcePath, sourcePath, sourceOut, checkpointOut]);
    assert.equal(run.status, 0, run.stderr || "fixture checkpoint command should pass");

    const checkpointText = await fs.readFile(checkpointOut, "utf8");
    for (const key of ["HOOK_SUBJECT", "EMOTION", "FRAMING", "BACKGROUND", "OVERLAY_TEXT", "COLOUR_CONTRAST", "STYLE", "CLARITY_RULES", "NEGATIVE_PROMPT"]) {
      assert.match(checkpointText, new RegExp(`su name ${key} ob text`));
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
