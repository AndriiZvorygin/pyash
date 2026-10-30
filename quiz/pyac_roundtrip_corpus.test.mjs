import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../program/program.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  buildVliwDatabase,
  decodeCodelet,
  decodePyacPack,
  renderPyashCodelet,
  replayVliwDatabase
} from "../program/library/vliw/index.mjs";
import { renderLegacyNumericPlusCodelet } from "../program/library/vliw/quotes.mjs";

// The pack corpus lives in quiz/fixtures rather than in the example: the
// named-literal codelet has no slot for the `exists` keyword, so the proven
// vectors keep the legacy declaration spelling. The runtime example in
// examples/pyash/pyac-corpus.pya uses `exists`, because the interpreter
// requires it to create a name.
const sourcePath = fileURLToPath(new URL("./fixtures/pyac_roundtrip_corpus.pya", import.meta.url));

function corpusSentences() {
  return buildProgram(readFileSync(sourcePath, "utf8")).sentences.filter((sentence) => (
    sentence?.mood !== "def" && sentence?.mood !== "prah"
  ));
}

test("PyAC corpus round-trips supported rows through VLIW and canonical Pyash", async () => {
  const sentences = corpusSentences();
  const database = buildVliwDatabase(sentences, {
    sources: sentences.map((_, sentenceIndex) => ({
      language: "pyash",
      locator: sourcePath,
      sentenceIndex
    }))
  });
  const decodedPack = decodePyacPack(database.pack);
  const executable = database.catalog.records.filter((record) => record.status === "executable");
  const unsupported = database.catalog.records.filter((record) => record.status === "unsupported");

  assert.equal(sentences.length, 17);
  assert.equal(executable.length, 11);
  assert.equal(unsupported.length, 6);
  assert.equal(database.catalog.packHash.length, 64);

  const plus = executable.find((record) => record.semantic === "numeric-plus");
  assert.equal(
    renderLegacyNumericPlusCodelet(decodedPack.codelets[plus.packIndex]),
    "hyikdoyu hyikdoka plustu"
  );

  for (const record of executable) {
    const words = decodedPack.codelets[record.packIndex];
    assert.deepEqual(decodeCodelet(words).sentence, record.sentence);
    assert.equal(renderPyashCodelet(words), record.canonicalSentence);
  }

  const outcomes = await replayVliwDatabase(database);
  assert.equal(outcomes.filter((outcome) => outcome.status === "replayed").length, 11);
  assert.equal(outcomes.filter((outcome) => outcome.status === "unsupported").length, 6);
  assert.deepEqual(
    outcomes
      .filter((outcome) => outcome.status === "unsupported")
      .map((outcome) => outcome.error.code),
    [
      "numeric-range",
      "unsupported-invert",
      "unsupported-exponential",
      "unsupported-remains",
      "unsupported-vector",
      "unsupported-date"
    ]
  );
});

test("PyAC corpus source stays parser-backed and deterministic", () => {
  const expected = [
    "ob num 1 to num 1 be plus do",
    "ob num 9 from num 4 be subtract do",
    "ob num 3 with num 4 be multiply do",
    "ob num 8 with num 2 be divide do",
    "ob num 7 to num 3 be xor do"
  ].map((source) => parse(source));

  assert.deepEqual(
    corpusSentences().slice(0, 5),
    expected
  );
});
