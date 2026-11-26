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

test("`from pyac` reads the text as Pyac glyphs, not as an English word", async () => {
  // `name` written as Pyac is `na me`, not the atom `hnim` whose English gloss
  // is "name". Reading it through the English-first resolver would return the
  // atom and make `from pyac` indistinguishable from `from en`.
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "name"], silent);
  assert.deepEqual(pyac.atoms, ["na", "me"], "name spells na + me");
  const english = await runPyacDictionary(["reference", "from", "en", "name"], silent);
  assert.ok(english.matches.length > 1, `expected several English senses, saw ${english.matches.length}`);
});

test("`from pyac` prefers a catalogued compound over its atoms", async () => {
  // `kl6mpsas` is `kl6m psas`, and the volume carries that compound, so the
  // entry is more useful than the bare atom reading.
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "kl6mpsas"], silent);
  assert.equal(pyac.key, "scalar produce");
  assert.ok(pyac.entry.lexicalForms.length > 0);
});

test("`from pyac` reports the reading for a grammar-only atom", async () => {
  // `sa` is a pronoun with no decodable volume entry. The reading must still be
  // reported rather than raising the decoder's error.
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "sa"], silent);
  assert.deepEqual(pyac.atoms, ["sa"]);
});

test("`from en` and `from pyac` disagree where the two readings differ", async () => {
  // `key` is English but not a Pyac atom. The English path finds entries; the
  // Pyac path must report a miss rather than throwing the binary's key error.
  const english = await runPyacDictionary(["reference", "from", "en", "key"], silent);
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "key"], silent);
  assert.ok(english.matches.length > 0, "the English word resolves");
  assert.deepEqual(pyac.matches, [], "the Pyac reading is a clean miss");
});

test("the default reading follows the configured language, not the spelling", async () => {
  // `name` is an English word whose letters also spell the Pyac run `na me`.
  // The default must give the English senses, because that is what a user
  // typing an English word means — reading it as Pyac because the letters
  // happen to spell atoms is the guess this replaces.
  const plain = await runPyacDictionary(["reference", "name"], silent);
  const english = await runPyacDictionary(["reference", "from", "en", "name"], silent);
  const pyac = await runPyacDictionary(["reference", "from", "pyac", "name"], silent);
  assert.ok(plain.matches.length > 1, `expected English senses by default, saw ${plain.matches.length}`);
  assert.equal(plain.matches.length, english.matches.length, "the default agrees with `from en`");
  assert.deepEqual(pyac.atoms, ["na", "me"], "`from pyac` still reads the glyphs");
});

test("a written Pyac key still resolves when the default language is English", async () => {
  // `dvis` is not an English word. The default English reading misses, so the
  // lookup must fall through to the Pyac key rather than reporting no entry.
  const plain = await runPyacDictionary(["reference", "dvis"], silent);
  assert.equal(plain.key, "divisions");
});

test("`decode` reads as English even though its letters spell Pyac atoms", async () => {
  // `decode` segments into `de co de` — all real atoms — but it is an English
  // word and must resolve as one. This is the case that exposed the guess.
  assert.deepEqual(segmentPyacWords("decode"), ["de", "co", "de"], "the glyph reading is exercised");
  const plain = await runPyacDictionary(["reference", "decode"], silent);
  assert.ok(plain.matches.length > 0, "the English word resolves by default");
});

test("`decode` carries its WordNet sense, not just its components", async () => {
  // The compound `hkom tyac` is only useful if it names the sense it was built
  // for. Without the linked gloss the entry is a bare decomposition.
  const english = await runPyacDictionary(["reference", "from", "en", "decode"], silent);
  const entry = english.matches[0];
  const senses = entry.interimDefinitions.map((gloss) => gloss.identifier);
  assert.ok(senses.includes("v:00996499-v"), `expected the decode sense, saw ${senses.join(", ")}`);
  const gloss = entry.interimDefinitions.find((item) => item.identifier === "v:00996499-v");
  assert.match(gloss.text, /convert code into ordinary language/u);
  assert.deepEqual(entry.entry.components, ["hkom", "tyac"], "the sense belongs to the compound");
});
