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
const skipWindows = process.platform === "win32";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

async function compileToJs(pyash) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");
}

async function runJs(source) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-js-"));
  const jsPath = path.join(tmpDir, "out.js");
  const outPath = path.join(tmpDir, "out.txt");
  await fs.writeFile(jsPath, source, "utf8");
  await execFileAsync("bash", ["-c", `node ${jsPath} > ${outPath}`], { timeout: 120000 });
  const stdout = await fs.readFile(outPath, "utf8");
  return stdout.trim();
}

test("compile JS adds days to a date", { skip: skipWindows }, async () => {
  forget();
  const pyash = [
    "exists su name base ob date 2025-01-20T00:00:00Z be record ya",
    "ob day 3 to name base be plus do",
    "ob name base be write do"
  ].join("\\n");
  const js = await compileToJs(pyash);
  const out = await runJs(js);
  assert.equal(out, "2025-01-23T00:00:00.000Z");
});
