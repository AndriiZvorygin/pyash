import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile to C: fromindex/toindex loop invokes ceremony body (gcc + run)", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop body fromindex num 0 be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop body be ceremony prah",
    // stop-when-equal loop: 3,2,1 then stop at 0
    "fromindex num 3 toindex num 0 be loop body do",
    "obj name counter be say do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.obj?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "3");
});
