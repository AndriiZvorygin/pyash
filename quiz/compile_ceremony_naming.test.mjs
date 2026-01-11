import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile names ceremony function with signature words", async () => {
  forget();

  const program = [
    "su name plus two to name num target be ceremony def",
    "su name plus two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /function\s+be_plus_two_to_name_num\s*\(/, "function name should reflect ceremony signature words");
});

test("compile renders remember line from this->to genitive", async () => {
  forget();

  const program = [
    "su name plus two be ceremony def",
    "ob this ti to be remember to name produce exists do",
    "su name plus two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /let\s+produce\s*;/, "should declare produce");
  assert.match(unwrapped, /produce\s*=\s*remember\(sentence\.to\)/, "should remember sentence.to into produce");
});

test("compile renders simple plus into direct assignment when name provided", async () => {
  forget();

  const program = [
    "exists su name produce ob num 0 be number ya",
    "ob num 2 to name produce be plus do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /produce\.ob\.num\s*=\s*\(produce\.ob\.num \?\? 0\)\s*\+\s*2;/, "should emit direct plus assignment");
});

test("compile keeps math inside ceremony after remember", async () => {
  forget();

  const program = [
    "su name plus two be ceremony def",
    "ob this ti to be remember to name produce exists do",
    "ob num 2 to name produce be plus do",
    "su name plus two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /remember\(sentence\.to\)/, "remember line should be present");
  assert.match(unwrapped, /produce\.ob\.num\s*=\s*\(produce\.ob\.num\s*\?\?\s*0\)\s*\+\s*2;/, "plus line should remain in ceremony body");
});

test("compile emits ceremony invocation as sentence object", async () => {
  forget();

  const program = [
    "exists su name bucket ob num 0 be number ya",
    "su name plus two to name num target be ceremony def",
    "ob num 2 to name num be plus do",
    "su name plus two be ceremony prah",
    "be plus two to bucket do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(
    unwrapped,
    /be_plus_two_to_name_num\(\{\s*mood:\s*"do",\s*be:\s*"plus two",\s*to:\s*(bucket|\{\s*name:\s*(bucket|"bucket")\s*\})\s*\}\);?/,
    "should invoke ceremony with sentence object and bucket reference"
  );
});
