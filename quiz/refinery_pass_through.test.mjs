import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("refinery passes stdout between stages via fromtext", async () => {
  forget();

  const lines = [
    "su name pipe be refinery def",
    "su name seed ob text \"echo hello\" to name text seed stdout be command do",
    "su name echo from ve name seed ob text \"cat\" to name text echo stdout fromtext text of seed stdout be command do",
    "prah",
    "from name pipe be refinery do"
  ];

  for (const line of lines) {
    await run(line);
  }

  const out = remember("echo stdout")?.ob?.text ?? "";
  assert.equal(out.trim(), "hello");
});

test("command accepts from genitive input", async () => {
  forget();

  await run("su name seed ob text \"echo hello\" to name text seed stdout be command do");
  await run("su name echo from text of seed stdout ob text \"cat\" to name text echo stdout be command do");

  const out = remember("echo stdout")?.ob?.text ?? "";
  assert.equal(out.trim(), "hello");
});
