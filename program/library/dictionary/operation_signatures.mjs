import { builtInSignatures } from "../../verbs/index.mjs";
import { ROLE_KEYS } from "../grammar/keywords.mjs";
import pyashWords from "../pyashWords.json" with { type: "json" };

// The declared signature tables are the code-resident dispatch surface. This
// module turns each `signatureWords` row into the dictionary's
// operation-signature shape, so the published volume describes the verb surface
// instead of staying silent about it.
//
// Dispatch keys use verb, mood, grammatical case, and value type. Argument names
// and descriptions are documentation, not constraints, so they are derived from
// the case name rather than hand-authored.

const WORD_BY_PYA = new Map(
  pyashWords.map((row) => [String(row.pya).toLowerCase(), row])
);
const WORD_BY_EN = new Map(
  pyashWords.map((row) => [String(row.en).toLowerCase(), row])
);

// Cases are vocabulary rows tagged `<name>_case_`; the sentence role word is the
// short pya form (`ob` -> `ka`, accusative). This is the same inventory the
// phrase and arithmetic modules read.
const CASE_ENTRY_BY_ROLE = new Map([
  ["su", "nominative_case_"],
  ["ob", "accusative_case_"],
  ["to", "destination_case_"],
  ["from", "source_case_"],
  ["by", "instrumental_case_"],
  ["with", "comitative_case_"],
  ["as", "essive_case_"],
  ["for", "benefactive_case_"],
  ["during", "temporal_case_"],
  ["fromstate", "source_case_"],
  ["tostate", "destination_case_"],
  ["become", "destination_case_"],
  ["fromtext", "source_case_"],
  ["totext", "destination_case_"],
  ["accordingto", "source_case_"],
  ["fromindex", "source_case_"],
  ["toindex", "destination_case_"],
  ["atindex", "location_case_"],
  ["at", "location_case_"],
  ["vyah", "way_case_"],
  ["via", "vialis_case_"]
]);

// Authoritative surface-to-entry map, mirrored from
// program/library/vliw/sentence.mjs so the dictionary and lowering agree.
const TYPE_ENTRY_BY_SURFACE = Object.freeze({
  num: "number_",
  number: "number_",
  bool: "boolean_",
  boolean: "boolean_",
  text: "text_",
  vec: "vector",
  float: "float",
  name: "name_",
  filename: "filename_",
  map: "map_",
  series: "series_"
});

const CASE_WORDS = new Set(
  ROLE_KEYS.filter((role) => CASE_ENTRY_BY_ROLE.has(role))
);

// `signatureWords` carries no mood. Execution verbs are callable with `do`; a
// future `ya`-callable verb must be added deliberately rather than inferred.
const DEFAULT_MOOD = "deontic_mood_";

function entryForName(name) {
  const text = String(name ?? "").trim();
  if (!text) return null;
  return WORD_BY_PYA.get(text.toLowerCase())
    ?? WORD_BY_EN.get(text.toLowerCase())
    ?? null;
}

function hnucOf(entry) {
  const parsed = Number.parseInt(String(entry.hnuc).replace(/^0x/iu, ""), 16);
  return Number.isNaN(parsed) ? null : parsed;
}

function caseWords(role) {
  const entry = entryForName(CASE_ENTRY_BY_ROLE.get(role) ?? "");
  return entry ? [hnucOf(entry)] : null;
}

function typeWords(tokens) {
  const words = [];
  for (const token of tokens) {
    const entryName = TYPE_ENTRY_BY_SURFACE[String(token).trim().toLowerCase()];
    if (!entryName) return null;
    const entry = entryForName(entryName);
    if (!entry) return null;
    words.push(hnucOf(entry));
  }
  return words.length ? words : null;
}

function verbWords(row) {
  const words = row.signatureWords;
  let index = 1;
  while (index < words.length && !CASE_WORDS.has(words[index])) index += 1;
  return { verb: words.slice(1, index), tail: words.slice(index) };
}

function splitArguments(tail) {
  const argumentsList = [];
  let index = 0;
  while (index < tail.length) {
    const role = tail[index];
    if (!CASE_WORDS.has(role)) return null;
    let end = index + 1;
    while (end < tail.length && !CASE_WORDS.has(tail[end])) end += 1;
    if (end === index + 1) return null;
    const tokens = tail.slice(index + 1, end);
    // Leading type words are the value type; a trailing modifier such as
    // `atmost num` or `among name series` is a constraint, not part of the type.
    const typeTokens = [];
    for (const token of tokens) {
      if (TYPE_ENTRY_BY_SURFACE[String(token).toLowerCase()]) typeTokens.push(token);
      else break;
    }
    if (!typeTokens.length) return null;
    argumentsList.push({
      grammatical_case: caseWords(role),
      value_type: typeWords(typeTokens),
      role
    });
    index = end;
  }
  return argumentsList;
}

/** One operation-signature record per declared signature, grouped by verb key. */
export function collectOperationSignatures(rows = builtInSignatures) {
  const byVerb = new Map();
  const skipped = [];
  const moodEntry = entryForName(DEFAULT_MOOD);
  const moodHnuc = moodEntry ? hnucOf(moodEntry) : null;
  if (moodHnuc === null) throw new Error(`missing vocabulary entry for ${DEFAULT_MOOD}`);

  for (const row of rows) {
    const { verb, tail } = verbWords(row);
    if (!verb.length) {
      skipped.push({ reason: "missing-verb", signatureWords: row.signatureWords });
      continue;
    }
    const verbKey = verb.join(" ");
    const verbHnuc = verb.map((token) => {
      const entry = entryForName(token);
      return entry ? hnucOf(entry) : null;
    });
    if (verbHnuc.some((word) => word === null)) {
      skipped.push({ reason: "unmapped-verb", signatureWords: row.signatureWords });
      continue;
    }
    const argumentsList = splitArguments(tail);
    if (!argumentsList) {
      skipped.push({ reason: "unmapped-case-or-type", signatureWords: row.signatureWords });
      continue;
    }
    if (argumentsList.some((argument) => !argument.grammatical_case || !argument.value_type)) {
      skipped.push({ reason: "unmapped-case-or-type", signatureWords: row.signatureWords });
      continue;
    }
    const list = byVerb.get(verbKey) ?? [];
    list.push({
      verb: verbHnuc,
      mood: [moodHnuc],
      arguments: argumentsList.map((argument) => ({
        grammatical_case: argument.grammatical_case,
        value_type: argument.value_type,
        name: argument.role,
        description: `value supplied in the ${argument.role} case`
      })),
      results: []
    });
    byVerb.set(verbKey, list);
  }
  return { byVerb, skipped };
}

function vector(values) {
  return `ve ${values.length} ${values.join(" ")}`;
}

/** Pyash record lines for one verb's signatures, matching the v3 importer. */
export function renderSignatureRecords(verbKey, signatures) {
  const lines = [];
  for (const signature of signatures) {
    const dispatch = [
      signature.verb.length,
      ...signature.verb,
      signature.mood.length,
      ...signature.mood,
      signature.arguments.length,
      ...signature.arguments.flatMap((argument) => [
        argument.grammatical_case.length,
        ...argument.grammatical_case,
        argument.value_type.length,
        ...argument.value_type
      ])
    ];
    lines.push(
      `su name tlat kwon ob text ${JSON.stringify(verbKey)} from ${vector(dispatch)} at text "operation-signature" be text ya`
    );
    for (const argument of signature.arguments) {
      lines.push(
        `su name tlat kwon ob text ${JSON.stringify(verbKey)} as ${vector([
          argument.grammatical_case.length,
          ...argument.grammatical_case,
          argument.value_type.length,
          ...argument.value_type
        ])} from text ${JSON.stringify(argument.name)} to text ${JSON.stringify(argument.description)} at text "operation-argument" be text ya`
      );
    }
  }
  return lines;
}

export { DEFAULT_MOOD };
