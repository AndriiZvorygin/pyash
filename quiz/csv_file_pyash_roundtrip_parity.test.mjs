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
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);

function splitPyashBlocks(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const blocks = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    if (line.trim() === "prah") {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function normalizeCsvBlock(block) {
  return block
    .filter((line) => !line.startsWith("exists su name header raw ") && !line.startsWith("su name header raw "))
    .map((line) => {
      if (/^su name .+ be csv map def$/.test(line)) {
        return "su name map be csv map def";
      }
      return line;
    });
}

function buildProgram(fixturePath, outPath, pyashPathFirst, pyashPathSecond) {
  return [
    `from filename "${fixturePath}" from state csv to name first be read do`,
    `ob name first to state csv to filename "${outPath}" be write do`,
    `from filename "${outPath}" from state csv to name second be read do`,
    `ob name first to filename "${pyashPathFirst}" be write do`,
    `ob name second to filename "${pyashPathSecond}" be write do`,
  ].join("\n");
}

test("csv file -> pyash -> csv -> pyash roundtrip parity (interpret)", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Payment Entry.csv");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-pyash-"));
  const outPath = path.join(tmpDir, "payment-entry.pyash-roundtrip.csv");
  const pyashPathFirst = path.join(tmpDir, "payment-entry.first.pyash");
  const pyashPathSecond = path.join(tmpDir, "payment-entry.second.pyash");
  const pyash = buildProgram(fixturePath, outPath, pyashPathFirst, pyashPathSecond);

  forget();
  const lines = splitSentences(pyash);
  for (const line of lines) {
    if (!line.trim()) continue;
    await interpret(parse(line));
  }

  const firstText = await fs.readFile(pyashPathFirst, "utf8");
  const secondText = await fs.readFile(pyashPathSecond, "utf8");
  const first = splitPyashBlocks(firstText).map(normalizeCsvBlock);
  const second = splitPyashBlocks(secondText).map(normalizeCsvBlock);
  assert.deepEqual(second, first);
});

test("csv file -> pyash -> csv -> pyash roundtrip parity (compiled JS)", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Payment Entry.csv");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-pyash-js-"));
  const outPath = path.join(tmpDir, "payment-entry.pyash-roundtrip.csv");
  const pyashPathFirst = path.join(tmpDir, "payment-entry.first.pyash");
  const pyashPathSecond = path.join(tmpDir, "payment-entry.second.pyash");
  const pyash = buildProgram(fixturePath, outPath, pyashPathFirst, pyashPathSecond);

  forget();
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const jsPath = path.join(tmpDir, "out.mjs");
  await fs.writeFile(jsPath, js, "utf8");
  await execFileAsync("node", [jsPath], { timeout: 120000 });

  const firstText = await fs.readFile(pyashPathFirst, "utf8");
  const secondText = await fs.readFile(pyashPathSecond, "utf8");
  const first = splitPyashBlocks(firstText).map(normalizeCsvBlock);
  const second = splitPyashBlocks(secondText).map(normalizeCsvBlock);
  assert.deepEqual(second, first);
});

test("csv file -> pyash -> csv -> pyash roundtrip parity (compiled C)", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Payment Entry.csv");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-pyash-c-"));
  const outPath = path.join(tmpDir, "payment-entry.pyash-roundtrip.csv");
  const pyashPathFirst = path.join(tmpDir, "payment-entry.first.pyash");
  const pyashPathSecond = path.join(tmpDir, "payment-entry.second.pyash");
  const pyash = buildProgram(fixturePath, outPath, pyashPathFirst, pyashPathSecond);

  forget();
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = wrapped.replace(/^\s*quoted\.c\.\s*/, "").replace(/\s*\.c\.quoted\s*$/, "");

  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  const needsCsv = /PYA_CSV_RUNTIME/.test(c);
  const zsvFlags = needsCsv ? ["-Icaterer/zsv/include", "-Icaterer/zsv/src"] : [];
  const zsvSrc = needsCsv ? ["caterer/zsv/src/zsv.c"] : [];
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, ...zsvFlags, cPath, ...zsvSrc, "-lm"]);
  await execFileAsync(exePath, [], { timeout: 120000 });

  const firstText = await fs.readFile(pyashPathFirst, "utf8");
  const secondText = await fs.readFile(pyashPathSecond, "utf8");
  const first = splitPyashBlocks(firstText).map(normalizeCsvBlock);
  const second = splitPyashBlocks(secondText).map(normalizeCsvBlock);
  assert.deepEqual(second, first);
});
