import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile converts Pyash file to JavaScript file", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile.txt";
  const outputFile = "quiz/sandpit/compile-output.js";
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.ob?.text ?? result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  assert.match(fileText, /let alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*ob:\s*\{\s*num:\s*1/s);
  assert.match(fileText, /let beta = \{[\s\S]*su:\s*\{\s*name:\s*"beta"\s*\}[\s\S]*ob:\s*\{\s*num:\s*2/s);

  await fs.rm(outputFile, { force: true });
});

test("file-based compile outputs runnable JS with write", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile-write.txt";
  const outputFile = "quiz/sandpit/compile-write-output.js";

  await fs.writeFile(inputFile, "ob text hello be write do\n", "utf8");
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  await interpret(sentence);

  const fileText = await fs.readFile(outputFile, "utf8");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args.join(" ")) } };
  context.globalThis = context;
  vm.runInNewContext(fileText, context);

  assert.ok(logs.includes("hello"), "compiled JS should log hello");

  await fs.rm(inputFile, { force: true });
  await fs.rm(outputFile, { force: true });
});

test("file-based compile with math, ceremony, and write logs final value", async () => {
  forget();

  const inputFile = "examples/pyash/compile-math-write.txt";
  const outputFile = "examples/out/compile-math-write-output.js";

  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  await interpret(sentence);

  const fileText = await fs.readFile(outputFile, "utf8");

  const logs = [];
  const context = {
    console: {
      log: (...args) => {
        try {
          logs.push(JSON.parse(JSON.stringify(args[0])));
        } catch {
          logs.push(args[0]);
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fileText, context);

  assert.equal(logs.length, 2, "should log twice");
  assert.equal(logs[0], 2, "first log after plus/subtract is 2");
  assert.equal(logs[1], 5, "second log after ceremony is 5");

  await fs.rm(outputFile, { force: true });
});
