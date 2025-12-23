import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("quoted.pyash multiline blocks parse as single text without literal \\n tokens", async () => {
  forget();

  const program = [
    "su name alpha ob num 1 be number ya",
    "su name beta ob num 2 be number ya"
  ].join("\n");

  const sentence = parse(
    `su name input ob text quoted.pyash.${program}.pyash.quoted be text ya`
  );

  assert.ok(sentence?.ob?.text);
  assert.equal(sentence.ob.text.includes("\\n"), false, "should retain real newlines, not literal \\n");
  assert.equal(sentence.ob.text.split("\n").length, 2, "should preserve line breaks inside quoted block");

  await interpret(sentence);
});
