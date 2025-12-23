import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(lines) {
  for (const line of lines) {
    const sentence = parse(line);
    if (sentence) await interpret(sentence);
  }
}

test("later ceremony definition takes priority and warns", async () => {
  forget();

  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    await run([
      "exists su name counter ob num 0 be number ya",
      "su name bump to name num counter be ceremony def",
      "ob num 1 to name counter be add do",
      "su name bump be ceremony prah",
      "su name bump to name num counter be ceremony def",
      "ob num 2 to name counter be add do",
      "su name bump be ceremony prah",
      "to name counter be bump do"
    ]);
  } finally {
    console.warn = prevWarn;
  }

  const counter = remember("counter");
  assert.equal(counter?.ob?.num, 2);
  assert.ok(warnings.some(msg => msg.includes("ceremony redefined: bump")));
});
