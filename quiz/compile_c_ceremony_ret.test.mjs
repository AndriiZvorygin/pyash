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

test("compile to C: ceremony ret updates target via to-name", async () => {
  forget();

  const pyash = [
    "exists su name result ob num 0 be number ya",
    "su name plus two ob num 0 to name num acc be ceremony def",
    "exists su name acc ob num of ob of this be number ya",
    "ob num 2 to name acc be plus do",
    "this ob name acc ret",
    "su name plus two be ceremony prah",
    "ob num 5 to name result be plus two do",
    "ob name result be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "7");
});

test("compile to C: ceremony ret defaults to this ob when no source", async () => {
  forget();

  const pyash = [
    "exists su name result ob num 0 be number ya",
    "su name echo ob num 0 be ceremony def",
    "this ret",
    "su name echo be ceremony prah",
    "ob num 5 to name result be echo do",
    "ob name result be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "5");
});

test("compile to C: ceremony ret supports text return", async () => {
  forget();

  const pyash = [
    "exists su name output ob text quoted.text..text.quoted be text ya",
    "su name echo ob text 0 to name text out be ceremony def",
    "this ret",
    "su name echo be ceremony prah",
    "ob text \"hello\" to name output be echo do",
    "ob name output be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "hello");
});

test("compile to C: ceremony ret supports local text binding", async () => {
  forget();

  const pyash = [
    "exists su name output ob text quoted.text..text.quoted be text ya",
    "su name echo local ob text 0 to name text out be ceremony def",
    "exists su name phrase ob text \"hello\" be text ya",
    "ob name phrase ret",
    "su name echo local be ceremony prah",
    "ob text \"ignored\" to name output be echo local do",
    "ob name output be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "hello");
});

test("compile to C: ceremony uses ob/from/by registers", async () => {
  forget();

  const pyash = [
    "exists su name result ob num 0 be number ya",
    "su name sum regs ob num 0 from num 0 by num 0 to name num out be ceremony def",
    "exists su name total ob num of ob of this be number ya",
    "ob name total by num of from of this to name total be multiply do",
    "ob name total by num of by of this to name total be multiply do",
    "ob name total ret",
    "su name sum regs be ceremony prah",
    "ob num 5 from num 2 by num 3 to name result be sum regs do",
    "ob name result be write do",
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  assert.equal(stdout.trim(), "30");
});
