import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile warns when a ceremony is redefined", async () => {
  forget();

  const source = [
    "exists subj name counter obj num 0 be number ya",
    "subj name bump to name num counter be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name bump be ceremony prah",
    "subj name bump to name num counter be ceremony def",
    "obj num 2 to name counter be add do",
    "subj name bump be ceremony prah",
    "to name counter be bump do"
  ].join("\n");

  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const sentence = parse(`from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`);
    await interpret(sentence);
  } finally {
    console.warn = prevWarn;
  }

  assert.ok(warnings.some(msg => msg.includes("ceremony redefined: bump")));
});
