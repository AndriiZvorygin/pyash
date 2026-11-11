import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(".");

test("run streams verbose output when the flag follows the program path", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-cli-stream-"));
  const program = path.join(directory, "slow.pya");
  await fs.writeFile(program, 'ob text "sleep 2" be command do\nob text "printf late" be command do\n', "utf8");

  const child = spawn("./run", [program, "--verbose"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let firstChunk = null;
  const closePromise = new Promise((resolve) => child.on("close", resolve));
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (firstChunk === null) firstChunk = text;
    output += text;
  });
  const status = await closePromise;

  assert.equal(status, 0, output);
  assert.match(firstChunk ?? "", /exists su name/u, output);
  assert.doesNotMatch(firstChunk ?? "", /late/u, output);
  assert.match(output, /late/u);
});
