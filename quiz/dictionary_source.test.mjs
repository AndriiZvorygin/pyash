import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  dictionaryKeyName,
  renderDefinitionSentence,
  summarizeDictionaryEntry
} from "../command/pyac_dictionary.mjs";
import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import { lookupLegacyName } from "../program/library/vliw/quotes.mjs";

function sourceWithEntry(definition = "A quantity with direction and magnitude.") {
  return `su name lyin kwon ob text "English Pyash dictionary" be text ya
su name lyin kwon ob text "Pyash reference" as num 3 from text "en" to text "NFC" with text "pyac-vliw-dictionary/3" be text ya
su name tlat kwon ob name vector at text "entry" be text ya
su name tlat kwon ob name vector as text "en" from text "vector" to text "vector" at text "lexical-form" be text ya
su name tlat kwon ob name vector as text "wordnet" from text "3.0" to text "n:05873161-n" by text "exact-sense" at text "source-link" be text ya
su name tlat kwon ob name vector as text "en" from text "wordnet" to text "3.0" by text "n:05873161-n" with text "A sense-specific interim gloss." at text "source-gloss" be text ya
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
  assert.deepEqual(built.entries[0].source_glosses, [{
    language: "en",
    dataset: "wordnet",
    release: "3.0",
    identifier: "n:05873161-n",
    text: "A sense-specific interim gloss."
  }]);
  assert.ok(built.entries[0].definition.length > 1);
  assert.ok(built.entries[0].definition.every((codelet) => codelet.length === 16));
});

test("dictionary source rejects definitions without a declared entry", () => {
  const source = sourceWithEntry().replace('su name tlat kwon ob name vector at text "entry" be text ya\n', "");
  assert.throws(() => buildDictionarySource(source), /precedes entry block/u);
});

test("dictionary source accepts a WordNet interim gloss without a Pyash definition", () => {
  const source = sourceWithEntry().replace(
    'su name vector ob text "A quantity with direction and magnitude." be text ya',
    ""
  );
  const entry = buildDictionarySource(source).entries[0];
  assert.equal(entry.definition, null);
  assert.equal(entry.source_glosses[0].text, "A sense-specific interim gloss.");
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

test("dictionary CLI renders canonical Pyash compound keys on decoded definitions", () => {
  const key = ["drut", "hnuc"].map((word) => Number.parseInt(lookupLegacyName(word).hnuc, 16));
  assert.equal(dictionaryKeyName(key), "drut hnuc");
  assert.equal(
    renderDefinitionSentence({
      su: { name: "descriptive number" },
      ob: { text: "A collection of facts." },
      be: "text",
      mood: "ya"
    }, "drut hnuc"),
    'su name drut hnuc ob text "A collection of facts." be text ya'
  );
});

test("dictionary entry read labels the linked WordNet gloss as the interim definition", () => {
  const key = ["drut", "hnuc"].map((word) => Number.parseInt(lookupLegacyName(word).hnuc, 16));
  const summary = summarizeDictionaryEntry([
    {
      su: { name: "word dictionary" },
      ob: { ve: { values: key } },
      at: { ve: { values: [274, 0, 30, 0] } }
    },
    {
      su: { name: "word dictionary" },
      ob: { ve: { values: key } },
      as: { text: "en" },
      from: { text: "wordnet" },
      to: { text: "Open English WordNet 2025" },
      by: { text: "n:08479331-n" },
      with: { text: "A collection of facts." },
      at: { text: "source-gloss" }
    }
  ], "drut hnuc");

  assert.equal(summary.definitionType, "wordnet-interim");
  assert.equal(summary.interimDefinitions.length, 1);
  assert.equal(summary.interimDefinitions[0].identifier, "n:08479331-n");
  assert.equal(summary.interimDefinitions[0].text, "A collection of facts.");
  assert.equal(summary.pyash, "");
});

test("published English core source imports six real WordNet-linked entries", async () => {
  const sourcePath = fileURLToPath(new URL(
    "../program/library/dictionary/english-core.pya",
    import.meta.url
  ));
  const built = buildDictionarySource(await fs.readFile(sourcePath, "utf8"));
  assert.equal(built.entries.length, 6);
  assert.deepEqual(
    built.entries.map((entry) => entry.source_links[0].identifier).sort(),
    [
      "n:05873161-n",
      "n:08479331-n",
      "n:13574763-n",
      "v:00654571-v",
      "v:00676526-v",
      "v:00951320-v"
    ]
  );
  assert.ok(built.entries.every((entry) => entry.definition === null));
  assert.ok(built.entries.every((entry) => entry.source_glosses.length === 1));
});
