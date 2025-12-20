import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

function expectedFizzBuzz(limit) {
  const out = [];
  for (let i = 1; i <= limit; i++) {
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else out.push(String(i));
  }
  return out;
}

test("compile fizzbuzz (1..100) to javascript and run", async () => {
  forget();

  const pyash = await fs.readFile("examples/pyash/compile-fizzbuzz-100.txt", "utf8");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);

  const result = await interpret(sentence);
  const wrapped = result?.obj?.text ?? result?.value?.text ?? "";
  const js = unwrapQuoted(wrapped, "javascript");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  assert.deepEqual(logs.map(String), expectedFizzBuzz(100));
});
