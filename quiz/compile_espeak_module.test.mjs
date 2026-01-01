import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("compile espeak module uses this ob.text as command input", async () => {
  const sentence = parse(
    `from filename "examples/pyash/modules/espeak_say.pya" to state javascript to text output be compile do`
  );
  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  assert.match(js, /this\.ob\.text|sentence\.ob\.text/, "compiled module should read this.ob.text");
});
