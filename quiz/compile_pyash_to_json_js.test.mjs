import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile pyash map def chain to canonical json and run (js)", async () => {
  forget();

  const sentence = parse(`from filename "examples/pyash/pyash-to-json-canonical.pya" from state pyash to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  assert.deepEqual(logs, ['{"age":36,"name":"Ada"}']);
});
