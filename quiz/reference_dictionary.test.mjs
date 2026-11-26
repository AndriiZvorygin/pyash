import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPyacDictionary } from "../command/pyac_dictionary.mjs";
import { setGloss } from "../command/reference_dictionary.mjs";
import { defaultVerbSpelling } from "../program/library/dictionary/verb_defaults.mjs";
import { lookupLegacyWordSequence } from "../program/library/vliw/quotes.mjs";
import { segmentPyacWords } from "../program/library/vliw/word_code.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOLUME = path.join(root, "program/library/dictionary/reference.pyac");
const GLOSSES = path.join(root, "program/library/translation/curated_glosses.pya");

const silent = { stdout: { write() {} } };

test("the published volume reads back every canonical key", async () => {
  const result = await runPyacDictionary(["verify", VOLUME], silent);
  assert.equal(result.ok, true, `verify reported: ${result.failures.join("; ")}`);
  assert.equal(result.keys, result.entries, "every entry is reachable from the index");
  assert.ok(result.keys > 60_000, `expected the whole vocabulary, saw ${result.keys}`);
});

test("a key whose word is the nominative marker reads back", async () => {
  // `na` encodes to 0x24DE, the same value the Rust reader once used as the
  // subject delimiter, so its own key word ended the subject and the entry
  // decoded as empty. It must read back now.
  //
  // `wa`, `pa`, and `sa` share the codelet group and are covered by the
  // all-keys `verify` test above, which reads them through the Rust reader.
  // (The JavaScript decoder still cannot spell `and_` because `wordName`
  // rejects every name ending in an underscore; that is a separate cosmetic
  // limit and does not affect the volume.)
  const result = await runPyacDictionary(["read", VOLUME, "key", "na"], silent);
  const forms = result.entry?.lexicalForms ?? [];
  assert.ok(
    forms.some((form) => form.surface === "nominative_case_"),
    `na must read back with its lexical form; saw ${JSON.stringify(forms)}`
  );
});

test("the curated gloss authoring writes and replaces one row", async () => {
  const original = await readFile(GLOSSES, "utf8");
  try {
    const spelling = "hwan";
    const first = await setGloss(spelling, "first authored gloss");
    assert.equal(first.spelling, spelling);
    assert.equal(first.replaced, true, "hwan already has a row, so it is replaced");
    const afterFirst = await readFile(GLOSSES, "utf8");
    assert.match(afterFirst, /first authored gloss/u);

    const second = await setGloss(spelling, "second authored gloss");
    assert.equal(second.replaced, true);
    const afterSecond = await readFile(GLOSSES, "utf8");
    assert.match(afterSecond, /second authored gloss/u);
    assert.doesNotMatch(afterSecond, /first authored gloss/u, "one row per spelling");
    assert.equal(
      afterSecond.split("\n").filter((line) => line.startsWith('su text "hwan" ob text')).length,
      1,
      "authoring must not duplicate the row"
    );
  } finally {
    await writeFile(GLOSSES, original, "utf8");
  }
});

test("a newly authored spelling is appended before the closing prah", async () => {
  const original = await readFile(GLOSSES, "utf8");
  try {
    const result = await setGloss("syip tyuh", "a spelling that had no row");
    assert.equal(result.replaced, false, "a new spelling is appended, not replaced");
    const after = await readFile(GLOSSES, "utf8");
    assert.match(after, /a spelling that had no row/u);
    const lines = after.split("\n");
    const closing = lines.lastIndexOf("prah");
    const added = lines.findIndex((line) => line.startsWith('su text "syip tyuh" ob text'));
    assert.ok(added >= 0 && added < closing, "the row goes inside the map");
  } finally {
    await writeFile(GLOSSES, original, "utf8");
  }
});

test("the primitive table and lowering agree on every mapped verb", () => {
  for (const surface of ["divide", "xor", "not", "or"]) {
    const spelling = defaultVerbSpelling(surface);
    assert.ok(Array.isArray(spelling) && spelling.length === 1, `${surface} is one atom`);
    const sequence = lookupLegacyWordSequence(surface);
    assert.deepEqual(
      sequence.map((entry) => entry.pya),
      spelling,
      `${surface}: lowering and the default table must name the same atom`
    );
  }
});

test("unspaced Pyac segments on the same boundaries the C parser uses", () => {
  // The C's first_word_derive: a consonant pair makes a four-glyph word, a
  // consonant+vowel pair makes a two-glyph word, and a tone (`7`) or a final
  // consonant extends either by one.
  assert.deepEqual(segmentPyacWords("kl6mpsas"), ["kl6m", "psas"]);
  assert.deepEqual(segmentPyacWords("gihnimna"), ["gi", "hnim", "na"]);
  assert.deepEqual(segmentPyacWords("dohyikka"), ["do", "hyik", "ka"]);
  assert.deepEqual(segmentPyacWords("pyanli"), ["pyan", "li"]);
  // `1` is a vowel code in the codec, so `l1` is a CV word rather than a
  // consonant followed by debris. The C's consonant list also carries `1`,
  // which is the defect that once made this unparseable.
  assert.deepEqual(segmentPyacWords("l1"), ["l1"]);
  assert.equal(segmentPyacWords("hzyq"), null, "a word with no vowel does not segment");
});

test("a run-together compound resolves to its atoms", () => {
  // Written Pyac joins compound words, so the dictionary key `kl6mpsas` has to
  // reach the volume key `kl6m,psas`. The lookup previously only knew one
  // hand-tabled compound, so this missed even though the entry existed.
  const sequence = lookupLegacyWordSequence("kl6mpsas");
  assert.ok(sequence, "kl6mpsas resolves");
  assert.deepEqual(sequence.map((entry) => entry.pya), ["kl6m", "psas"]);
});

test("a run-together compound reads back from the published volume", async () => {
  const result = await runPyacDictionary(["reference", "kl6mpsas"], silent);
  assert.equal(result.key, "scalar produce", "the compound reads as its atoms");
  assert.ok(result.entry.lexicalForms.length > 0, "the entry carries its English forms");
});

test("`from pyac` selects the Pyash key path", async () => {
  // Without recognizing the prefix the whole string is searched as an English
  // surface, which can never match a written Pyac key.
  const plain = await runPyacDictionary(["reference", "kl6mpsas"], silent);
  const prefixed = await runPyacDictionary(["reference", "from", "pyac", "kl6mpsas"], silent);
  assert.equal(prefixed.key, plain.key, "the prefixed form reads the same entry");
});

test("a compound with no volume entry reports a miss instead of failing", async () => {
  // `hnanga` segments into known atoms but is not a catalogued compound, so it
  // must report "no entry" rather than surfacing the binary's key error. The
  // guard keeps the miss meaningful: if it stopped segmenting, the lookup
  // would take the surface path and the assertion would pass for the wrong
  // reason.
  assert.deepEqual(segmentPyacWords("hnanga"), ["hnan", "ga"], "the miss is exercised, not bypassed");
  const result = await runPyacDictionary(["reference", "hnanga"], silent);
  assert.deepEqual(result.matches, []);
});

test("`from en` reads an English word even when it also spells a Pyac atom", async () => {
  // `name` is both an English word and the Pyac atom `hnim`. Without an explicit
  // source the CLI silently picks one, so the same English token returns
  // different answers depending on spelling luck. `from en` pins the English
  // interpretation: twelve English senses, not the single atom entry.
  const english = await runPyacDictionary(["reference", "from", "en", "name"], silent);
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "name"], silent);
  assert.ok(english.matches.length > 1, `expected several English senses, saw ${english.matches.length}`);
  assert.equal(pyac.matches, undefined, "the Pyac source returns a single keyed entry");
  assert.equal(pyac.key, "name");
});

test("`from en` and `from pyac` disagree where the two readings differ", async () => {
  // `key` is English but not a Pyac atom. The English path finds entries; the
  // Pyac path must report a miss rather than throwing the binary's key error.
  const english = await runPyacDictionary(["reference", "from", "en", "key"], silent);
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "key"], silent);
  assert.ok(english.matches.length > 0, "the English word resolves");
  assert.deepEqual(pyac.matches, [], "the Pyac reading is a clean miss");
});

test("`from en` resolves a word that the default path would read as Pyac", async () => {
  // `argument` is the Pyac atom `hrut`, so the default path returns one entry.
  // The English reading is a different, larger result set.
  const english = await runPyacDictionary(["reference", "from", "en", "argument"], silent);
  const plain = await runPyacDictionary(["reference", "argument"], silent);
  assert.ok(english.matches.length > 1, `expected several English senses, saw ${english.matches.length}`);
  assert.ok(plain.key, "the default path reads the Pyac atom");
});
