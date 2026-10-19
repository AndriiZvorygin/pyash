import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);
const skipWindows = process.platform === "win32";

function sourceLines(paths) {
  const { source, copy, renameSource, renamed } = paths;
  return [
    `be touch ob filename "${source}" do`,
    `ob text "stable" to filename "${source}" be write do`,
    `be touch ob filename "${source}" do`,
    `be touch ob filename "${copy}" do`,
    `ob text "old-copy" to filename "${copy}" be write do`,
    `be copy ob filename "${source}" to filename "${copy}" do`,
    `be copy ob filename "${source}" to filename "${source}" do`,
    `be touch ob filename "${renameSource}" do`,
    `ob text "rename-content" to filename "${renameSource}" be write do`,
    `be touch ob filename "${renamed}" do`,
    `ob text "old-rename" to filename "${renamed}" be write do`,
    `be rename ob filename "${renameSource}" to filename "${renamed}" do`,
    "ob name result be write do",
    `be delete ob filename "${source}" as wo file do`,
    `be delete ob filename "${renamed}" as wo file do`,
    `be exists ob filename "${source}" do`,
    "ob name result be write do",
    `be delete ob filename "${copy}" as wo file do`
  ];
}

async function runInterpreter(lines) {
  forget();
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(" "));
  try {
    for (const line of lines) await interpret(parse(line));
  } finally {
    console.log = originalLog;
  }
  return output;
}

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

async function compileProgram(lines, lang) {
  forget();
  const pyash = lines.join("\\n");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state ${lang} to text output be compile do`);
  const result = await interpret(sentence);
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", lang);
}

async function runCompiled(lines, lang, root) {
  const source = await compileProgram(lines, lang);
  if (lang === "javascript") {
    const filename = path.join(root, "program.mjs");
    await fs.writeFile(filename, source, "utf8");
    return (await execFileAsync("node", [filename], { encoding: "utf8" })).stdout.trim().split(/\r?\n/).filter(Boolean);
  }
  const filename = path.join(root, "program.c");
  const executable = path.join(root, "program");
  await fs.writeFile(filename, source, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", executable, filename]);
  return (await execFileAsync(executable, [], { encoding: "utf8" })).stdout.trim().split(/\r?\n/).filter(Boolean);
}

async function makePaths(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    source: path.join(root, "source.txt"),
    copy: path.join(root, "nested", "copy.txt"),
    renameSource: path.join(root, "rename-source.txt"),
    renamed: path.join(root, "nested", "renamed.txt"),
    directory: path.join(root, "directory")
  };
}

async function assertHappyPath(runner, prefix) {
  const paths = await makePaths(prefix);
  const output = await runner(sourceLines(paths), paths);
  assert.equal(await fs.stat(paths.source).then(() => false, () => true), true);
  assert.equal(await fs.stat(paths.copy).then(() => false, () => true), true);
  assert.equal(await fs.stat(paths.renamed).then(() => false, () => true), true);
  assert.deepEqual(output.slice(-2), [paths.renamed, "lie"]);
}

async function runForBackend(label, lines, paths) {
  if (label === "interpreter") return runInterpreter(lines);
  return runCompiled(lines, label, paths.root);
}

test("filename mutation has equivalent interpreter, JavaScript, and C happy paths", { skip: skipWindows }, async () => {
  await assertHappyPath(async lines => runInterpreter(lines), "pyash-parity-interpreter-");
  await assertHappyPath(async (lines, paths) => runCompiled(lines, "javascript", paths.root), "pyash-parity-js-");
  await assertHappyPath(async (lines, paths) => runCompiled(lines, "c", paths.root), "pyash-parity-c-");
});

test("touch preserves contents, copy overwrites and copies to self", { skip: skipWindows }, async () => {
  for (const [label, runner] of [
    ["interpreter", async (lines) => runInterpreter(lines)],
    ["javascript", async (lines, paths) => runCompiled(lines, "javascript", paths.root)],
    ["c", async (lines, paths) => runCompiled(lines, "c", paths.root)]
  ]) {
    const paths = await makePaths(`pyash-${label}-details-`);
    const lines = [
      `be touch ob filename "${paths.source}" do`,
      `ob text "stable" to filename "${paths.source}" be write do`,
      `be touch ob filename "${paths.source}" do`,
      `be touch ob filename "${paths.copy}" do`,
      `ob text "old" to filename "${paths.copy}" be write do`,
      `be copy ob filename "${paths.source}" to filename "${paths.copy}" do`,
      `be copy ob filename "${paths.source}" to filename "${paths.source}" do`
    ];
    await runner(lines, paths);
    assert.equal(await fs.readFile(paths.source, "utf8"), "stable", label);
    assert.equal(await fs.readFile(paths.copy, "utf8"), "stable", label);
  }
});

test("touch updates modification time in every backend", { skip: skipWindows }, async () => {
  for (const label of ["interpreter", "javascript", "c"]) {
    const paths = await makePaths(`pyash-${label}-mtime-`);
    const touch = [`be touch ob filename "${paths.source}" do`];
    await runForBackend(label, touch, paths);
    const first = await fs.stat(paths.source);
    await new Promise(resolve => setTimeout(resolve, 25));
    await runForBackend(label, touch, paths);
    const second = await fs.stat(paths.source);
    assert.ok(second.mtimeMs > first.mtimeMs, `${label}: touch must update mtime`);
  }
});

test("rename overwrites regular-file contents and returns resolved targets", { skip: skipWindows }, async () => {
  for (const label of ["interpreter", "javascript", "c"]) {
    const paths = await makePaths(`pyash-${label}-rename-overwrite-`);
    await runForBackend(label, [
      `be touch ob filename "${paths.renameSource}" do`,
      `ob text "new-contents" to filename "${paths.renameSource}" be write do`,
      `be touch ob filename "${paths.renamed}" do`,
      `ob text "old-contents" to filename "${paths.renamed}" be write do`,
      `be rename ob filename "${paths.renameSource}" to filename "${paths.renamed}" do`
    ], paths);
    assert.equal(await fs.readFile(paths.renamed, "utf8"), "new-contents", label);
    await assert.rejects(() => fs.stat(paths.renameSource), label);
  }
});

test("mutation result filenames resolve consistently for every backend", { skip: skipWindows }, async () => {
  for (const label of ["interpreter", "javascript", "c"]) {
    const paths = await makePaths(`pyash-${label}-results-`);
    const output = await runForBackend(label, [
      `be touch ob filename "${paths.source}" do`,
      "ob name result be write do",
      `be copy ob filename "${paths.source}" to filename "${paths.copy}" do`,
      "ob name result be write do",
      `be rename ob filename "${paths.copy}" to filename "${paths.renamed}" do`,
      "ob name result be write do",
      `be delete as wo file ob filename "${paths.source}" do`,
      "ob name result be write do",
      `be delete as wo file ob filename "${paths.renamed}" do`
    ], paths);
    assert.deepEqual(output.slice(-4), [paths.source, paths.copy, paths.renamed, paths.source], label);
  }
});

test("C touch compiles and runs without an exchange-triggering write", { skip: skipWindows }, async () => {
  const paths = await makePaths("pyash-c-standalone-touch-");
  const source = await compileProgram([
    `be touch ob filename "${paths.source}" do`
  ], "c");
  assert.match(source, /#define _POSIX_C_SOURCE 200809L/u);
  assert.match(source, /#include <fcntl\.h>/u);
  assert.match(source, /#include <time\.h>/u);
  assert.doesNotMatch(source, /pya_exchange_record_file/u);
  const cFile = path.join(paths.root, "touch.c");
  const executable = path.join(paths.root, "touch");
  await fs.writeFile(cFile, source, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", executable, cFile]);
  await execFileAsync(executable, [], { encoding: "utf8" });
  assert.equal((await fs.stat(paths.source)).isFile(), true);
});

test("C, JavaScript, and interpreter normalize relative and name filename paths", { skip: skipWindows }, async () => {
  const base = path.join("artifacts", `pyash-relative-mutation-${process.pid}-${Date.now()}`);
  const expected = {
    source: path.resolve(base, "source.txt"),
    copy: path.resolve(base, "copy.txt"),
    renamed: path.resolve(base, "renamed.txt")
  };
  const lines = [
    `ob ve text "${base}" "source.txt" to name filename source file be concatenate become wo filename do`,
    `ob ve text "${base}" "./copy.txt" to name filename copy file be concatenate become wo filename do`,
    `ob ve text "${base}" "renamed.txt" to name filename renamed file be concatenate become wo filename do`,
    "be touch ob name source file do",
    "ob name result be write do",
    `be copy ob name source file to filename "./${base}/copy.txt" do`,
    "ob name result be write do",
    "be rename ob name copy file to name renamed file do",
    "ob name result be write do",
    "be delete as wo file ob name source file do",
    "ob name result be write do",
    "be delete as wo file ob name renamed file do"
  ];
  const compileRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-relative-compile-"));
  try {
    for (const label of ["interpreter", "javascript", "c"]) {
      const output = label === "interpreter"
        ? await runInterpreter(lines)
        : await runCompiled(lines, label, compileRoot);
      assert.deepEqual(output.slice(-4), [expected.source, expected.copy, expected.renamed, expected.source], label);
    }
  } finally {
    await fs.rm(path.resolve(base), { recursive: true, force: true });
    await fs.rm(compileRoot, { recursive: true, force: true });
  }
});

async function runFailure(lines, lang, root) {
  if (lang === "interpreter") {
    forget();
    try {
      for (const line of lines) await interpret(parse(line));
    } catch (error) {
      return error?.sentence?.ob?.text ?? error.message;
    }
    return "";
  }
  try {
    await runCompiled(lines, lang, root);
  } catch (error) {
    return `${error.stderr || ""}${error.stdout || ""}${error.message || ""}`;
  }
  return "";
}

test("rename missing-source and file-mode directory guards keep error categories", { skip: skipWindows }, async () => {
  for (const lang of ["interpreter", "javascript", "c"]) {
    const paths = await makePaths(`pyash-${lang}-guards-`);
    await fs.mkdir(paths.directory, { recursive: true });
    const missing = await runFailure([
      `be rename ob filename "${paths.renameSource}" to filename "${paths.renamed}" do`
    ], lang, paths.root);
    const directory = await runFailure([
      `be delete ob filename "${paths.directory}" as wo file do`
    ], lang, paths.root);
    assert.match(missing, /rename target missing/u, lang);
    assert.match(directory, /delete target defective/u, lang);
    assert.equal(await fs.stat(paths.directory).then(() => true, () => false), true);
  }
});
