import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile names ceremony function with signature words", async () => {
  forget();

  const program = [
    "subj name add two to name num be ceremony def",
    "subj name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /function\s+be_add_two_to_name_num\s*\(/, "function name should reflect ceremony signature words");
});

test("compile renders remember line from this->to genitive", async () => {
  forget();

  const program = [
    "subj name add two be ceremony def",
    "obj this ti to be remember to name produce exists do",
    "subj name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /let\s+produce\s*;/, "should declare produce");
  assert.match(unwrapped, /produce\s*=\s*remember\(sentence\.to\)/, "should remember sentence.to into produce");
});

test("compile renders simple add into direct assignment when name provided", async () => {
  forget();

  const program = [
    "exists subj name produce obj num 0 be number ya",
    "obj num 2 to name produce be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /produce\.obj\.num\s*=\s*\(produce\.obj\.num \?\? 0\)\s*\+\s*2;/, "should emit direct add assignment");
});

test("compile keeps math inside ceremony after remember", async () => {
  forget();

  const program = [
    "subj name add two be ceremony def",
    "obj this ti to be remember to name produce exists do",
    "obj num 2 to name produce be add do",
    "subj name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.match(unwrapped, /remember\(sentence\.to\)/, "remember line should be present");
  assert.match(unwrapped, /produce\.obj\.num\s*=\s*\(produce\.obj\.num\s*\?\?\s*0\)\s*\+\s*2;/, "add line should remain in ceremony body");
});

test("compile emits ceremony invocation as sentence object", async () => {
  forget();

  const program = [
    "exists subj name bucket obj num 0 be number ya",
    "subj name add two to name num be ceremony def",
    "obj num 2 to name num be add do",
    "subj name add two be ceremony prah",
    "be add two to bucket do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js.replace(/^quoted\\.javascript\\.\\n?/, "").replace(/\\.javascript\\.quoted\\s*$/, "");

  assert.ok(
    unwrapped.includes('be_add_two_to_name_num({ mood: "do", be: "add two", to: { name: bucket } })') ||
      unwrapped.includes('be_add_two_to_name_num({mood:"do",be:"add two",to:{name: bucket}})'),
    "should invoke ceremony with sentence object and inline bucket reference"
  );
});
