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
