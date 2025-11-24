import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/parser/index.mjs";
import { dumpMemory, resetMemory } from "../program/memory/index.mjs";

test("compile verb reads Pyash file and stores JSON", async () => {
  resetMemory();

  const program = [
    "subj name alpha obj num 1 be number ya",
    "subj name beta obj num 2 be number ya"
  ].join("\n");

  // store input text and placeholder output
  await interpret(
    parse(`subj name input obj text quoted.pyash.${program}.pyash.quoted be text ya`)
  );
  await interpret(parse("subj name output be text ya"));

  const sentence = parse(
    "obj name input from state pyash to state JSON to name output be compile do"
  );
  const result = await interpret(sentence);

  const mem = dumpMemory();
  const out = mem.find(s => s.subj?.name === "output");

  assert.ok(result, "compile should return result");
  assert.ok(out, "compile should store to output");
  assert.ok(Array.isArray(out.obj?.sentences));
  assert.equal(out.obj.sentences.length, 2);
  assert.match(out.obj.text, /alpha/);

  const parsed = JSON.parse(out.obj.text);
  assert.equal(parsed[0].subj.name, "alpha");
});
