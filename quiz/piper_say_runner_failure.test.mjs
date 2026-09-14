import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("piper say runner fails when synthesis does not produce audio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-piper-runner-"));
  const outputPath = path.join(dir, "speech.wav");
  const result = spawnSync(process.execPath, [
    "command/piper_say_runner.mjs",
    "--bin",
    path.join(dir, "missing-piper"),
    "--voice",
    path.join(dir, "missing-voice.onnx"),
    "--output",
    outputPath,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYA_SAY_SILENT: "1",
    },
    input: "This must fail clearly.",
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing-piper|ENOENT|spawn/iu);
  assert.equal(fs.existsSync(outputPath), false);
});
