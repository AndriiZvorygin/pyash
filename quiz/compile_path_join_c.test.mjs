import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile to C lowers concatenate become wo filename to deterministic snprintf", async () => {
  forget();

  const pyash = [
    "ob ve text \"artifacts\" \"./run-001\" \"video.mp4\" to name text out be concatenate become wo filename do"
  ].join("\n");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  assert.match(c, /char out\[PYA_TEXT_CAP\] = "";/);
  assert.match(c, /snprintf\(out, PYA_TEXT_CAP, "%s", "artifacts\/run-001\/video\.mp4"\);/);
});

test("compile to C supports filename-typed concatenate become wo filename targets", async () => {
  forget();

  const pyash = [
    "ob ve text \"artifacts\" \"run-001\" \"video.mp4\" to name filename out file be concatenate become wo filename do"
  ].join("\n");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  assert.match(c, /char out_file\[PYA_TEXT_CAP\] = "";/);
  assert.match(c, /snprintf\(out_file, PYA_TEXT_CAP, "%s", "artifacts\/run-001\/video\.mp4"\);/);
});
