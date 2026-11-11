import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("direct vocabulary checks resolve staged grammar, lemma, and compound paths", async () => {
  const cases = [
    ["someone", /someone: grammar -> cyahtlih/u],
    ["walked", /walked: lemma walk -> pfin/u],
    ["acid-rain", /acid-rain: found compound acid \+ rain -> flat myic \(accepted-delimited\)/u]
  ];
  for (const [token, expected] of cases) {
    const lines = [];
    const result = await runVocabSuggest([token], { report: (line) => lines.push(String(line)) });
    assert.equal(result.exitCode, 0, token);
    assert.match(lines.join("\n"), expected, token);
  }
});
