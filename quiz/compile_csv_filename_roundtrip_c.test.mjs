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

test("compile csv filename roundtrip to C and run", async () => {
  forget();

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const csvPath = path.join(outDir, "Sample Sheet.csv");
  const outPath = path.join(outDir, "roundtrip.csv");
  const csvText = "Name,Age\nAda,36\nTuring,\n";
  await fs.writeFile(csvPath, csvText, "utf8");

  const pyash = [
    `from filename "${csvPath}" from state csv to name people be read do`,
    `ob name people to state csv to filename "${outPath}" be write do`
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const cPath = path.join(outDir, "out.c");
  const exePath = path.join(outDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  const needsCsv = /PYA_CSV_RUNTIME/.test(c);
  const zsvFlags = needsCsv ? ["-Icaterer/zsv/include", "-Icaterer/zsv/src"] : [];
  const zsvSrc = needsCsv ? ["caterer/zsv/src/zsv.c"] : [];
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, ...zsvFlags, cPath, ...zsvSrc, "-lm"], { timeout: 120000 });
  await execFileAsync(exePath, [], { timeout: 120000 });
  const stdout = await fs.readFile(outPath, "utf8");
  assert.equal(stdout, csvText);
});
