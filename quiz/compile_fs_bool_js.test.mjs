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

test("compile JS handles list/copy/exists/ecology/license", { skip: skipWindows }, async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-fs-"));
  const root = path.join(tmpDir, "root");
  await fs.mkdir(root);
  const alpha = path.join(root, "alpha.txt");
  const source = path.join(root, "source.txt");
  const dest = path.join(root, "dest.txt");
  const betaDir = path.join(root, "beta");
  await fs.writeFile(alpha, "alpha", "utf8");
  await fs.writeFile(source, "hello", "utf8");
  await fs.mkdir(betaDir);

  const pyash = [
    `su name entries be list from filename "${root}" as wo all do`,
    "ob name entries be write do",
    `be copy ob filename "${source}" to filename "${dest}" do`,
    `be exists ob filename "${dest}" do`,
    "ob name result be write do",
    "su name PYA_ECOLOGY_TEST be ecology ob text \"alpha\" do",
    "ob name PYA_ECOLOGY_TEST be write do",
    `be license ob filename "${dest}" as num 644 do`
  ].join("\\n");

  const js = await compileToJs(pyash);
  const out = await runJs(js);
  const lines = out.split(/\r?\n/).filter(Boolean);
  assert.equal(lines[0], "su name entries ob ve text alpha.txt beta source.txt be list ya");
  assert.equal(lines[1], "truth");
  assert.equal(lines[2], "alpha");

  const copied = await fs.readFile(dest, "utf8");
  assert.equal(copied, "hello");
  const mode = (await fs.stat(dest)).mode & 0o777;
  assert.equal(mode, 0o644);
});
