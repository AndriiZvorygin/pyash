import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

test("ceremony keeps target be when returning a gross chip series", async () => {
  forget();
  await interpret(parse('from filename "./quiz/fixtures/series_wrap_module.pya" ob name wrap to name wrap be import do'));
  await interpret(parse('from text "alpha beta" to name text chips be wrap do'));

  const chips = remember("chips");
  assert.equal(chips?.be, "series");
  assert.ok(Array.isArray(chips?.ob?.series));

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('ob name chips to filename "out.txt" be write do'), { remember })
  );
  assert.equal(signature, "be write ob name series to filename");
});
