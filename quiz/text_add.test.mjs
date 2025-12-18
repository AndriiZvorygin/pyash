import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("add concatenates text into a named text target", async () => {
  forget();
  await interpret(parse("exists subj name greeting obj text hello be text ya"));
  await interpret(parse("obj text world to name greeting be add do"));
  assert.equal(remember("greeting")?.obj?.text, "helloworld");
});

