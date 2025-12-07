import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("quoted.pyash multiline blocks parse as single text without literal \\n tokens", async () => {
  forget();

  const program = [
    "subj name alpha obj num 1 be number ya",
    "subj name beta obj num 2 be number ya"
  ].join("\n");

  const sentence = parse(
    `subj name input obj text quoted.pyash.${program}.pyash.quoted be text ya`
  );

  assert.ok(sentence?.obj?.text);
  assert.equal(sentence.obj.text.includes("\\n"), false, "should retain real newlines, not literal \\n");
  assert.equal(sentence.obj.text.split("\n").length, 2, "should preserve line breaks inside quoted block");

  await interpret(sentence);
});
