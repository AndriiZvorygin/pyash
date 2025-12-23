import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("compile json->pyash example to C and run", async () => {
  forget();

  const pyash = await fs.readFile("examples/pyash/compile-json-to-pyash.pya", "utf8");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = wrapped.replace(/^\s*quoted\.c\.\s*/, "").replace(/\s*\.c\.quoted\s*$/, "");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-json-to-pyash-"));
  const cPath = path.join(tmp, "out.c");
  const exePath = path.join(tmp, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath]);
  const { stdout } = await execFileAsync(exePath, []);

  assert.match(stdout, /quoted\.pyash\./);
  assert.match(stdout, /su name profile be json map def/);
  assert.match(stdout, /\bprah\b/);
});
