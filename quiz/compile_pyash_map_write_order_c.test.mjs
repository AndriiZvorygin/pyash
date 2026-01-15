import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

test("compile pyash map write preserves official key order (c)", async () => {
  forget();

  const pyash = [
    "su name sample be map def",
    "exists su name b ob num 2 be number ya",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "prah",
    "ob name sample be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = wrapped.replace(/^\s*quoted\.c\.\s*/, "").replace(/\s*\.c\.quoted\s*$/, "");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-map-order-"));
  const cPath = path.join(tmp, "out.c");
  const exePath = path.join(tmp, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath]);
  const { stdout } = await execFileAsync(exePath, []);

  const outputLines = stdout.split("\n").filter(Boolean);
  assert.deepEqual(outputLines, [
    "su name sample be map def",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "exists su name b ob num 2 be number ya",
    "prah"
  ]);
});
