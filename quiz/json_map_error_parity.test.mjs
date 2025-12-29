import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

async function runProgram(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    await run(line);
  }
}

test("json map structural errors match across interpret/compile", async () => {
  const pyash = [
    "su name sample be json map def",
    "su name bad ob ve foo bar ya",
    "prah",
    "ob name sample to state json be write do"
  ].join("\n");

  forget();
  let interpretError;
  try {
    await runProgram(pyash);
  } catch (err) {
    interpretError = err;
  }

  assert.equal(interpretError?.sentence?.su?.name, "json map contents defective");

  let compileJsError;
  try {
    await run(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  } catch (err) {
    compileJsError = err;
  }

  assert.equal(compileJsError?.sentence?.su?.name, "json map contents defective");

  let compileCError;
  try {
    await run(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  } catch (err) {
    compileCError = err;
  }

  assert.equal(compileCError?.sentence?.su?.name, "json map contents defective");
});

test("json map def requires su and ob in entries across interpret/compile", async () => {
  const missingSu = [
    "su name sample be json map def",
    "ob num 1 ya",
    "prah"
  ].join("\n");

  forget();
  let interpretError;
  try {
    await runProgram(missingSu);
  } catch (err) {
    interpretError = err;
  }
  assert.equal(interpretError?.sentence?.su?.name, "json map sentence lost su");

  let compileJsError;
  try {
    await run(`from text quoted.pyash.${missingSu}.pyash.quoted to state javascript to text output be compile do`);
  } catch (err) {
    compileJsError = err;
  }
  assert.equal(compileJsError?.sentence?.su?.name, "json map sentence lost su");

  let compileCError;
  try {
    await run(`from text quoted.pyash.${missingSu}.pyash.quoted to state c to text output be compile do`);
  } catch (err) {
    compileCError = err;
  }
  assert.equal(compileCError?.sentence?.su?.name, "json map sentence lost su");

  const missingOb = [
    "su name sample be json map def",
    "su name alpha ya",
    "prah"
  ].join("\n");

  forget();
  interpretError = undefined;
  try {
    await runProgram(missingOb);
  } catch (err) {
    interpretError = err;
  }
  assert.equal(interpretError?.sentence?.su?.name, "json map sentence lost ob");

  compileJsError = undefined;
  try {
    await run(`from text quoted.pyash.${missingOb}.pyash.quoted to state javascript to text output be compile do`);
  } catch (err) {
    compileJsError = err;
  }
  assert.equal(compileJsError?.sentence?.su?.name, "json map sentence lost ob");

  compileCError = undefined;
  try {
    await run(`from text quoted.pyash.${missingOb}.pyash.quoted to state c to text output be compile do`);
  } catch (err) {
    compileCError = err;
  }
  assert.equal(compileCError?.sentence?.su?.name, "json map sentence lost ob");
});
