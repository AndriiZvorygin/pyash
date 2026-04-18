import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thumbnail-select-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runSelector({ metadataPath, sourcePath, filenameFallback, outputPath, debugPath }) {
  return spawnSync(
    "node",
    [
      "command/thumbnail_input_select_from_metadata.mjs",
      metadataPath,
      sourcePath,
      filenameFallback,
      outputPath,
      debugPath
    ],
    { encoding: "utf8" }
  );
}

test("thumbnail input selector prefers generated hook/title over other sources", async () => {
  await withTempDir(async (dir) => {
    const metadataPath = path.join(dir, "metadata.pya");
    const sourcePath = path.join(dir, "source.txt");
    const outputPath = path.join(dir, "thumbnail-input.txt");
    const debugPath = path.join(dir, "thumbnail-input-selection.json");

    await fs.writeFile(
      metadataPath,
      [
        "su name video metadata be map def",
        "su name title ob text \"How Cooperation Scales\" ya",
        "su name heading ob text \"Family To Planetary\" ya",
        "su name summary ob text \"Scaling summary text\" ya",
        "su name description ob text \"Description text\" ya",
        "prah"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(sourcePath, "Raw manuscript fallback text.", "utf8");

    const run = runSelector({
      metadataPath,
      sourcePath,
      filenameFallback: "know/input/family_to_planetary.txt",
      outputPath,
      debugPath
    });

    assert.equal(run.status, 0, run.stderr || "selector should pass");
    const text = await fs.readFile(outputPath, "utf8");
    const debug = JSON.parse(await fs.readFile(debugPath, "utf8"));

    assert.match(text, /PRIMARY_THUMBNAIL_SIGNAL: Family To Planetary/);
    assert.equal(debug.selected_primary.source, "generated_title_hook");
    assert.deepEqual(debug.priority_order, [
      "generated title \/ hook",
      "generated summary \/ description",
      "source text fallback",
      "filename only"
    ]);
  });
});

test("thumbnail input selector falls back through summary, source text, then filename", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "source.txt");
    await fs.writeFile(sourcePath, "Source fallback sentence about cooperation scales.", "utf8");

    const metadataSummaryPath = path.join(dir, "metadata-summary.pya");
    await fs.writeFile(
      metadataSummaryPath,
      [
        "su name video metadata be map def",
        "su name summary ob text \"Summary wins here\" ya",
        "prah"
      ].join("\n"),
      "utf8"
    );

    const outSummary = path.join(dir, "out-summary.txt");
    const dbgSummary = path.join(dir, "dbg-summary.json");
    const runSummary = runSelector({
      metadataPath: metadataSummaryPath,
      sourcePath,
      filenameFallback: "know/input/family_to_planetary.txt",
      outputPath: outSummary,
      debugPath: dbgSummary
    });
    assert.equal(runSummary.status, 0, runSummary.stderr || "summary fallback should pass");
    const debugSummary = JSON.parse(await fs.readFile(dbgSummary, "utf8"));
    assert.equal(debugSummary.selected_primary.source, "generated_summary_description");

    const metadataEmptyPath = path.join(dir, "metadata-empty.pya");
    await fs.writeFile(metadataEmptyPath, "su name video metadata be map def\nprah\n", "utf8");

    const outSource = path.join(dir, "out-source.txt");
    const dbgSource = path.join(dir, "dbg-source.json");
    const runSource = runSelector({
      metadataPath: metadataEmptyPath,
      sourcePath,
      filenameFallback: "know/input/family_to_planetary.txt",
      outputPath: outSource,
      debugPath: dbgSource
    });
    assert.equal(runSource.status, 0, runSource.stderr || "source fallback should pass");
    const debugSource = JSON.parse(await fs.readFile(dbgSource, "utf8"));
    assert.equal(debugSource.selected_primary.source, "source_text");

    const emptySourcePath = path.join(dir, "empty-source.txt");
    await fs.writeFile(emptySourcePath, "", "utf8");
    const outFile = path.join(dir, "out-file.txt");
    const dbgFile = path.join(dir, "dbg-file.json");
    const runFile = runSelector({
      metadataPath: metadataEmptyPath,
      sourcePath: emptySourcePath,
      filenameFallback: "know/input/family_to_planetary.txt",
      outputPath: outFile,
      debugPath: dbgFile
    });
    assert.equal(runFile.status, 0, runFile.stderr || "filename fallback should pass");
    const debugFile = JSON.parse(await fs.readFile(dbgFile, "utf8"));
    assert.equal(debugFile.selected_primary.source, "filename_only");
  });
});
