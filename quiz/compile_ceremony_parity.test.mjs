import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);
const examplePath = path.resolve("examples/pyash/compile-ceremony-parity.pya");
const goldenPath = path.resolve("quiz/fixtures/compile_ceremony_parity.js");

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

function errorIdentity(error) {
  return {
    kind: error?.sentence?.su?.name ?? error?.name,
    message: error?.sentence?.ob?.text ?? error?.message
  };
}

async function runInterpreter(source) {
  forget();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    for (const raw of splitSentences(source)) {
      if (!raw.trim()) continue;
      await interpret(parse(raw));
    }
  } finally {
    console.log = originalLog;
  }
  return {
    logs,
    first: remember("first"),
    second: remember("second")
  };
}

async function runSource(source) {
  forget();
  for (const raw of splitSentences(source)) {
    if (!raw.trim()) continue;
    await interpret(parse(raw));
  }
  return remember("result");
}

async function compileSource(source) {
  forget();
  const result = await interpret(parse(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`
  ));
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? result?.value?.value?.text ?? "", "javascript");
}

async function compileToJavaScript(sourcePath) {
  forget();
  const result = await interpret(parse(
    `from filename "${sourcePath}" to state javascript to text output be compile do`
  ));
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");
}

async function runNode(source) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ceremony-parity-"));
  const jsPath = path.join(tempDir, "program.mjs");
  await fs.writeFile(jsPath, source, "utf8");
  const { stdout } = await execFileAsync("node", [jsPath], { timeout: 120000 });
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

const canonicalSource = await fs.readFile(examplePath, "utf8");

test("typed multi-word ceremony preserves interpreter and JavaScript call frames", async () => {
  const interpreted = await runInterpreter(canonicalSource);
  const js = await compileToJavaScript(examplePath);
  const golden = await fs.readFile(goldenPath, "utf8");
  const jsLogs = await runNode(js);

  const jsBody = js.replace(/\n\/\/# sourceMappingURL=[\s\S]*$/, "");
  assert.equal(jsBody, golden);
  assert.deepEqual(interpreted.logs, ["5", "10"]);
  assert.deepEqual(jsLogs, interpreted.logs);

  const context = { console: { log() {} } };
  vm.runInNewContext(js, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify({ first: context.first?.ob, second: context.second?.ob })),
    { first: interpreted.first?.ob, second: interpreted.second?.ob }
  );
  assert.equal(context.first?.su?.name, "first");
  assert.equal(context.second?.su?.name, "second");
});

test("typed ceremony rejects an incompatible argument in both paths", async () => {
  const badSource = canonicalSource.replace(
    "ob num 3 to name num first be plus two do",
    "ob text bad to name num first be plus two do"
  );

  let interpreterError;
  try {
    await runInterpreter(badSource);
  } catch (error) {
    interpreterError = errorIdentity(error);
  }
  assert.deepEqual(interpreterError, {
    kind: "signature inconsistency",
    message: "Ceremony signature inconsistency: expected be plus two ob num to name num, got be plus two ob text to name num"
  });

  const tempSource = path.join(os.tmpdir(), "pyash-ceremony-parity-bad.pya");
  await fs.writeFile(tempSource, badSource, "utf8");
  const js = await compileToJavaScript(tempSource);
  let javascriptError;
  try {
    vm.runInNewContext(js, { console: { log() {} } });
  } catch (error) {
    javascriptError = errorIdentity(error);
  }
  assert.deepEqual(javascriptError, interpreterError);
});

test("nested typed ceremony initializes an undeclared local target in both paths", async () => {
  const source = [
    "exists su name result ob num 0 be number ya",
    "su name plus two ob num 0 to name num input be ceremony def",
    "exists su name input ob num of ob of this be number ya",
    "ob num 1 to name input be plus do",
    "this ob name input ret",
    "su name plus two be ceremony prah",
    "su name plus three ob num 0 to name num input be ceremony def",
    "ob num 4 to name num local be plus two do",
    "this ob name local ret",
    "su name plus three be ceremony prah",
    "ob num 9 to name result be plus three do"
  ].join("\n");

  const interpreted = await runSource(source);
  const js = await compileSource(source);
  const context = { console: { log() {} } };
  vm.runInNewContext(js, context);

  assert.deepEqual(JSON.parse(JSON.stringify(context.result?.ob)), interpreted?.ob);
  assert.equal(context.result?.su?.name, "result");
});
