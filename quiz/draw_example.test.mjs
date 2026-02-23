import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

test("draw text-to-image example runs with fixture output", async () => {
  const outputPath = path.resolve("examples/out/draw-text-to-image.png");
  await fs.rm(outputPath, { force: true });

  await execFileAsync("./run", ["examples/pyash/draw-text-to-image.pya"], {
    cwd: path.resolve("."),
    timeout: 120000,
    env: {
      ...process.env,
      PYA_DRAW_FIXTURE_FILE: "quiz/fixtures/pyash_raven.png"
    }
  });

  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 0);
});
