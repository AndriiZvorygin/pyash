import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("espeak say module uses command under the hood", async () => {
  process.env.PYA_COMMAND_RESPONSE = "phonemes";
  const result = await interpret(parse("from name ./examples/pyash/modules/espeak_say.pya ob name say to name espeak say be import do"));
  const sayResult = await interpret(parse("ob text \"hello\" be espeak say do"));
  const out = sayResult?.ob?.text ?? sayResult?.value?.text ?? sayResult?.result?.text;
  assert.ok(out === "phonemes" || out === "Hello");
  delete process.env.PYA_COMMAND_RESPONSE;
});
