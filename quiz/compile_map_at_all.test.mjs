import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("compile at all map toggles vector elements", async () => {
  try {
    const pyash = [
      // Seed vector of zeros
      "exists subj name vec obj ve num 0 0 0 be vector ya",
      // Ceremony: val = this obj + 1
      "subj name toggle be ceremony def",
      "subj name val obj this obj be number ya",
      "obj num 1 be add do",
      "subj name val ret",
      "subj name toggle be ceremony prah",
      // Invoke at all (in-place)
      "obj name vec at name all be toggle do"
    ].join("\\n");

    const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
    const result = await interpret(sentence);
    let js = result?.obj?.text ?? result?.value?.text ?? "";
    if (js.startsWith("quoted.javascript.")) {
      js = js.slice("quoted.javascript.".length);
    }
    if (js.endsWith(".javascript.quoted")) {
      js = js.slice(0, -".javascript.quoted".length);
    }
    js = js.trim();

    const sandbox = { console: { log: () => {} } };
    vm.runInNewContext(js, sandbox);

    const vec = sandbox.vec ?? sandbox.globalThis?.vec;
    const values = Array.from(vec?.obj?.ve?.values ?? []);
    assert.ok(values.length, "vector should exist after runAtAll");
    assert.deepEqual(values, [1, 1, 1], "all elements should be incremented to 1");
  } catch (err) {
    console.error("compile_map_at_all failure", err);
    throw err;
  }
});
