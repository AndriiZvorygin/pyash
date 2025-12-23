import test from "node:test";
import assert from "node:assert/strict";
import { buildProgram } from "../program/program.mjs";

test("buildProgram preserves multiline quoted text blocks", () => {
  const source = [
    'ob text quoted.text.',
    'line one',
    'line two',
    '.text.quoted to name output be add do',
  ].join("\n");

  const program = buildProgram(source);
  assert.equal(program.sentences.length, 1);
  assert.equal(program.sentences[0].ob?.text, "\nline one\nline two\n");
});
