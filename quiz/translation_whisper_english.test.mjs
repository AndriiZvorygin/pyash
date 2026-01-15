import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation from whisper english to pyash sentences", async () => {
  forget();

  const whisperText = [
    "do be plus object number 5 to name result",
    "subject name alpha be text ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${whisperText}.pyash.quoted from state whisper-english to state pyash to name output be translation do`
  );

  const result = await interpret(sentence);
  const out = result?.ob ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  assert.equal(out.sentences[0].be, "plus");
  assert.equal(out.sentences[0].ob.num, 5);
  assert.equal(out.sentences[0].to.name, "result");
  assert.equal(out.sentences[1].su.name, "alpha");
  assert.equal(out.sentences[1].be, "text");
  assert.equal(out.sentences[1].mood, "ya");
});
