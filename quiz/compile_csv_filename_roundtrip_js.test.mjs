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

test("compile csv filename roundtrip to javascript and run", async () => {
  forget();

  const csvPath = path.resolve("quiz/fixtures/Bank Transaction.csv");

  const pyash = [
    `from filename "${csvPath}" from state csv to name people be read do`,
    "ob name people to state csv be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-js-"));
  const jsPath = path.join(tmpDir, "out.mjs");
  const outPath = path.join(tmpDir, "out.txt");
  await fs.writeFile(jsPath, js, "utf8");

  await execFileAsync("bash", ["-c", `node ${jsPath} > ${outPath}`], { timeout: 120000 });
  const stdout = await fs.readFile(outPath, "utf8");
  assert.deepEqual(stdout.split(/\r?\n/).filter(Boolean), ["Name,Age", "Ada,36", "Turing,"]);
});
