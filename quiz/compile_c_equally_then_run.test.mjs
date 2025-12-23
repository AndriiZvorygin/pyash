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

test("compile to C: equally then controls execution (gcc + run)", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "obj name counter be equally from num 0 then obj num 1 to name counter be add do",
    "obj name counter be write do",
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
  assert.equal(stdout.trim(), "1");
});

test("compile to C: equally compares text", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "obj text truth be equally from text truth then obj num 1 to name counter be add do",
    "obj name counter be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.obj?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "1");
});
