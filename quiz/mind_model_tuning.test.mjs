import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("mind auto-loads model tuning file and strips think block for qwq-32b", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "mind model" }, ob: { text: "qwq-32b" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({
    mood: "ya",
    su: { name: "mind response" },
    ob: { text: "<think>step by step</think>\nFinal answer." },
    be: "default"
  });
  const out = await interpret(parse('su name answer ob text "2+2?" for name mind to name text out be write do'));
  const text = String(out?.ob?.text ?? out?.value?.text ?? out?.result?.text ?? "");
  assert.equal(text, "Final answer.");
});
