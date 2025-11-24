import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { dumpMemory, resetMemory } from "../program/memory/index.mjs";

test("read verb loads file content into text obj", async () => {
  resetMemory();

  const sentence = parse('subj name file be read from filename "quiz/sandpit/compile.txt" do');
  await interpret(sentence);

  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "file" && s.be === "text");

  assert.ok(fact, "fact stored");
  assert.equal(fact.be, "text");
  assert.ok(fact.obj?.text?.includes("alpha"));
});
