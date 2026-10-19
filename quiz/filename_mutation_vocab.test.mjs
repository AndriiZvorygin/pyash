import test from "node:test";
import assert from "node:assert/strict";
import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("filename mutation example passes vocabulary suggestions", async () => {
  const lines = [];
  const result = await runVocabSuggest(["examples/pyash/file-touch-copy-rename-delete.pya"], {
    report: line => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0, lines.join("\n"));
});
