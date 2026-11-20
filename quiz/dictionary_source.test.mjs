import test from "node:test";
import assert from "node:assert/strict";

import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import { lookupLegacyName } from "../program/library/vliw/quotes.mjs";

function sourceWithEntry(definition = "A quantity with direction and magnitude.") {
  return `su name lyin kwon ob text "English Pyash dictionary" be text ya
su name lyin kwon ob text "Pyash reference" as num 3 from text "en" to text "NFC" with text "pyac-vliw-dictionary/2" be text ya
su name tlat kwon ob name vector at text "entry" be text ya
su name tlat kwon ob name vector as text "en" from text "vector" to text "vector" at text "lexical-form" be text ya
su name tlat kwon ob name vector as text "wordnet" from text "3.0" to text "n:05873161-n" by text "exact-sense" at text "source-link" be text ya
su name vector ob text "${definition}" be text ya`;
}

test("dictionary source lowers keyed Pyash definition sentences and metadata", () => {
  const built = buildDictionarySource(sourceWithEntry());
  assert.deepEqual(built.metadata, {
    kind: "English Pyash dictionary",
    title: "Pyash reference",
    revision: 3,
    languages: ["en"],
    normalization_policy: "NFC"
  });
  assert.deepEqual(built.entries[0].key, [Number.parseInt(lookupLegacyName("vector").hnuc, 16)]);
  assert.deepEqual(built.entries[0].lexical_forms, [
    { language: "en", surface: "vector", normalized: "vector" }
  ]);
  assert.equal(built.entries[0].source_links[0].identifier, "n:05873161-n");
  assert.ok(built.entries[0].definition.length > 1);
  assert.ok(built.entries[0].definition.every((codelet) => codelet.length === 16));
});

test("dictionary source rejects definitions without a declared entry", () => {
  const source = sourceWithEntry().replace('su name tlat kwon ob name vector at text "entry" be text ya\n', "");
  assert.throws(() => buildDictionarySource(source), /precedes entry block/u);
});

test("dictionary source rejects unresolved Pyash key atoms rather than inventing HNUCs", () => {
  assert.throws(() => buildDictionarySource(sourceWithEntry().replaceAll("vector", "unmappedword")), /no HNUC mapping/u);
});

test("dictionary source refuses an unimplemented entry record instead of dropping it", () => {
  const source = sourceWithEntry().replace(
    'at text "lexical-form" be text ya',
    'at text "unknown-record" be text ya'
  );
  assert.throws(() => buildDictionarySource(source), /unsupported dictionary entry record/u);
});

test("dictionary source accepts structural operation signature and argument metadata", () => {
  const source = sourceWithEntry().replace(
    'su name vector ob text "A quantity with direction and magnitude." be text ya',
    [
      'su name tlat kwon ob name vector from ve 0 1 4369 1 8574 1 1 9310 1 3613 at text "operation-signature" be text ya',
      'su name tlat kwon ob name vector as ve 0 1 9310 1 3613 from text "input" to text "value consumed" at text "operation-argument" be text ya',
      'su name tlat kwon ob name vector as ve 0 3613 from text "result" to text "computed value" at text "operation-result" be text ya',
      'su name vector ob text "A quantity with direction and magnitude." be text ya'
    ].join("\n")
  );
  const signature = buildDictionarySource(source).entries[0].operation_signatures[0];
  assert.deepEqual(signature.verb, [4369]);
  assert.deepEqual(signature.mood, [8574]);
  assert.deepEqual(signature.arguments, [{
    grammatical_case: [9310],
    value_type: [3613],
    name: "input",
    description: "value consumed"
  }]);
  assert.deepEqual(signature.results, [{
    value_type: [3613],
    name: "result",
    description: "computed value"
  }]);
});
