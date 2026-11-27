import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "rust/pyac/target/release/pyac-dictionary");
const volume = path.join(root, "program/library/dictionary/reference.pyac");

// Every grammatical atom in the volume must carry a definition from some source,
// or say plainly that it has none. Before this, 153 grammar atoms crashed
// `pyash dict` outright and the rest answered with a name and nothing else.
//
// One atom is exempt: `multiplicative_case_` is the `fromindex` index word, a
// structural marker rather than a term, so a definition would be wrong.

const GRAMMAR_FAMILIES = ["case", "mood", "aspect", "voice", "tense", "number",
  "gender", "person", "evidentiality", "modality", "polarity", "agreement",
  "definiteness", "degree"];

function lookup(language, surface) {
  const out = execFileSync(binary, ["surface-entries", volume, language, surface], {
    encoding: "utf8",
    maxBuffer: 1 << 26
  });
  return JSON.parse(out).matches ?? [];
}

test("every grammatical atom reads back with a definition or an explicit none", () => {
  const source = execFileSync("grep", ["-o", 'from text "[a-z_0-9]*_"', path.join(root, "program/library/dictionary/reference.pya")], {
    encoding: "utf8",
    maxBuffer: 1 << 26
  });
  const placeholders = [...new Set(source.split("\n")
    .map((line) => line.match(/from text "([a-z_0-9]*_)"/)?.[1])
    .filter(Boolean))];
  const grammar = placeholders.filter((term) => {
    const base = term.replace(/_$/u, "");
    return GRAMMAR_FAMILIES.some((family) => base.endsWith(`_${family}`));
  });
  assert.ok(grammar.length > 150, `expected the full grammar inventory, saw ${grammar.length}`);

  // An atom is defined when the entry that owns it carries a gloss. The gloss
  // may come from WordNet, Wiktionary, or an authored Pyac definition.
  const defined = new Set();
  for (const line of execFileSync("grep", ["-o", 'ob text "[a-z0-9]*" .*', path.join(root, "program/library/dictionary/reference.pya")], {
    encoding: "utf8",
    maxBuffer: 1 << 26
  }).split("\n")) {
    const atom = line.match(/^ob text "([a-z0-9]*)"/u)?.[1];
    if (atom && /from text "(wordnet|wiktionary|pyash-curated)"/u.test(line)) defined.add(atom);
  }
  const missing = [];
  for (const term of grammar) {
    const atom = execFileSync("grep", ["-o", `ob text "[a-z0-9]*" as text "en" from text "${term}"`, path.join(root, "program/library/dictionary/reference.pya")], {
      encoding: "utf8",
      maxBuffer: 1 << 20
    }).match(/ob text "([a-z0-9]*)"/u)?.[1];
    if (!atom) { missing.push(`${term}(no atom)`); continue; }
    if (defined.has(atom)) continue;
    if (term === "multiplicative_case_") continue;
    missing.push(`${term}(${atom})`);
  }
  assert.deepEqual(missing, [], "grammar atoms with no definition from any source");
});
