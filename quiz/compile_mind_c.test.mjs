import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

async function compileToC(pyash) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const res = await interpret(sentence);
  return unwrapQuoted(res?.ob?.text ?? res?.value?.text ?? "", "c");
}

test("compile mind to C uses PYA_MIND_RESPONSE", async () => {
  const pyash = [
    "exists su name helper be mind via state \"qwen3\" ya",
    "su name answer ob text \"Hello\" to name helper be mind do"
  ].join("\n");
  const c = await compileToC(pyash);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c);
  await execFileAsync("gcc", [
    "-std=c11",
    "-O0",
    "-Icaterer/curl/include",
    "-o",
    exePath,
    cPath,
    "-lcurl"
  ], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], {
    env: { ...process.env, PYA_MIND_RESPONSE: "OK" }
  });
  assert.equal(stdout.trim(), "OK");
});
