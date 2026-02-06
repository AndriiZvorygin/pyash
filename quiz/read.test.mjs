import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";

test("read verb returns raw filename reference", async () => {
  forget();

  const sentence = parse('su name file be read from filename "quiz/sandpit/compile.txt" do');
  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "file" && s.be === "read" && s.mood === "ya");

  assert.ok(fact, "fact stored");
  assert.equal(fact.be, "read");
  assert.equal(fact.ob?.filename, path.resolve("quiz/sandpit/compile.txt"));
});
