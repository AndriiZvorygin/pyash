import {
  inflectionCandidates,
  normalizeEnglishLemmaWord
} from "./english_lemmas.mjs";
import { readFile } from "node:fs/promises";
import { buildProgram } from "../../program.mjs";

export const ENGLISH_ATOM_LEMMA_SCAN_FORMAT = "english-atom-lemma-scan-v1";
export const ENGLISH_ATOM_LEMMA_SCAN_CONFIG_URL = new URL("./english_atom_lemma_scan.pya", import.meta.url);
export const ENGLISH_ATOM_LEMMA_SCAN_NAME = "translation";

const ACCEPTED_STATUSES = new Set([
  "accepted-deterministic",
  "accepted-curated",
  "accepted-llm",
  "repaired-llm"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-atom-lemma-scan";
  error.details = details;
  return error;
}

function rank(value, rankForEnglish) {
  const result = Number(rankForEnglish(normalizeEnglishLemmaWord(value)));
  return Number.isFinite(result) && result > 0 ? result : Number.POSITIVE_INFINITY;
}

function markerLabel(value) {
  return typeof value === "string" && (value.startsWith("_") || value.endsWith("_"));
}

function eligibleInflection(surface, candidate, wordnetIndex) {
  const rule = candidate.rule ?? "";
  const normalizedSurface = normalizeEnglishLemmaWord(surface);
  const lemma = normalizeEnglishLemmaWord(candidate.lemma);
  if (!lemma || lemma === normalizedSurface) return false;
  const senses = wordnetIndex.lookup(lemma);
  if (senses.length === 0) return false;

  // A surface that is itself a WordNet lemma may be lexicalized rather than an
  // inflected spelling. Preserve it unless the lemma catalog reviewed it.
  if (wordnetIndex.lookup(normalizedSurface).length > 0) return false;

  if (rule === "plural-or-third-person-s-silent-e") return false;
  if (rule === "plural-or-third-person-es") {
    const endsWithEs = /(?:s|x|z|ch|sh|o)$/u.test(lemma);
    if (!endsWithEs) return false;
  }
  if (rule.startsWith("comparative-") || rule.startsWith("superlative-")) return false;
  return true;
}

function chooseAtom(candidates, rankForEnglish, layerByWord) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ranked = candidates.map((candidate) => ({
    candidate,
    rank: rank(candidate.en, rankForEnglish),
    layer: layerByWord.get(candidate.pya) ?? Number.MAX_SAFE_INTEGER
  })).sort((left, right) => (
    left.rank - right.rank
    || left.layer - right.layer
    || left.candidate.en.localeCompare(right.candidate.en)
    || left.candidate.pya.localeCompare(right.candidate.pya)
  ));
  const best = ranked[0];
  const tied = ranked.filter((row) => row.rank === best.rank && row.layer === best.layer);
  return new Set(tied.map((row) => row.candidate.pya)).size === 1 ? best.candidate : null;
}

function catalogTarget(entry, atomsBySurface, rankForEnglish, layerByWord) {
  if (!entry || !ACCEPTED_STATUSES.has(entry.status) || entry.kind === "duplicate") return null;
  const target = normalizeEnglishLemmaWord(entry.canonicalEnglish);
  const candidates = atomsBySurface.get(target) ?? [];
  const exact = candidates.filter((candidate) => candidate.en.trim().toLowerCase() === String(entry.canonicalEnglish).trim().toLowerCase());
  const atom = chooseAtom(exact.length > 0 ? exact : candidates, rankForEnglish, layerByWord);
  if (!atom) return null;
  return {
    english: atom.en,
    pyac: atom.pya,
    source: "accepted-lemma-catalog"
  };
}

function exactAtomForSurface(surface, atomsBySurface, rankForEnglish, layerByWord) {
  const candidates = atomsBySurface.get(normalizeEnglishLemmaWord(surface)) ?? [];
  const exact = candidates.filter((candidate) => candidate.en.trim().toLowerCase() === String(surface).trim().toLowerCase());
  return chooseAtom(exact.length > 0 ? exact : candidates, rankForEnglish, layerByWord);
}

function chooseCandidate(surface, atom, atomIndex, catalogBySurface, rankForEnglish, layerByWord, wordnetIndex) {
  const rows = new Map();
  for (const candidate of inflectionCandidates(surface)) {
    if (!eligibleInflection(surface, candidate, wordnetIndex)) continue;
    const lemma = normalizeEnglishLemmaWord(candidate.lemma);
    const explicit = catalogTarget(catalogBySurface.get(lemma), atomIndex.bySurface, rankForEnglish, layerByWord);
    const exactAtom = exactAtomForSurface(lemma, atomIndex.bySurface, rankForEnglish, layerByWord);
    const root = explicit ?? (exactAtom
      ? { english: exactAtom.en, pyac: exactAtom.pya, source: "exact-atom-lemma" }
      : null);
    const option = {
      lemma,
      rule: candidate.rule,
      rank: rank(lemma, rankForEnglish),
      targetEnglish: root?.english ?? atom.en,
      targetPyac: root?.pyac ?? atom.pya,
      targetLayer: layerByWord.get(root?.pyac ?? atom.pya) ?? Number.MAX_SAFE_INTEGER,
      targetSource: root?.source ?? "surface-atom"
    };
    const previous = rows.get(lemma);
    if (!previous || option.rule.localeCompare(previous.rule) < 0) rows.set(lemma, option);
  }

  const options = [...rows.values()].sort((left, right) => (
    left.rank - right.rank
    || left.targetLayer - right.targetLayer
    || left.lemma.localeCompare(right.lemma)
  ));
  if (options.length === 0) return { selected: null, options: [] };
  const winner = options[0];
  const tied = options.filter((option) => option.rank === winner.rank && option.targetLayer === winner.targetLayer);
  if (tied.length > 1) return { selected: null, options };
  return { selected: winner, options };
}

function grammarLabelsForIdentity(atomCoverage, grammarEntries) {
  const grammarSurfaces = new Set((grammarEntries ?? [])
    .filter((entry) => entry.pyashSequence.join(" ") === atomCoverage.pyac)
    .map((entry) => normalizeEnglishLemmaWord(entry.surface)));
  return atomCoverage.labels.filter((label) => (
    markerLabel(label) || grammarSurfaces.has(normalizeEnglishLemmaWord(label))
  ));
}

export function parseEnglishAtomLemmaScanConfig(source) {
  if (typeof source !== "string") throw invalid("atom lemma scan configuration must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_ATOM_LEMMA_SCAN_NAME);
  if (!header) throw invalid("atom lemma scan configuration has no canonical map header");
  const values = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") values[sentence.su.text] = sentence.ob.text;
  }
  if (values.format !== ENGLISH_ATOM_LEMMA_SCAN_FORMAT
    || values["target-status"] !== "no-direct-wordnet-candidate"
    || values["fallback-assignment"] !== "surface lemma"
    || values["lexical-surface-policy"] !== "a surface present as a WordNet lemma stays self-lemma unless an accepted catalog mapping specifies its lemma"
    || values["grammar-lemma-collision-policy"] !== "do not create a lexical anchor for a lemma surface already reserved as a grammar entry unless that surface has an atomic word"
    || values["frequency-order"] !== "english30k rank ascending") {
    throw invalid("atom lemma scan configuration has unsupported scan rules");
  }
  return values;
}

export async function loadEnglishAtomLemmaScanConfig({ url = ENGLISH_ATOM_LEMMA_SCAN_CONFIG_URL } = {}) {
  return parseEnglishAtomLemmaScanConfig(await readFile(url, "utf8"));
}

export function buildEnglishAtomLemmaAssignments({
  atomCoverage = [],
  atomicEntries = [],
  lemmaEntries = [],
  grammarEntries = [],
  wordnetIndex,
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  layerByWord = new Map()
} = {}) {
  if (!Array.isArray(atomCoverage) || !Array.isArray(atomicEntries) || !Array.isArray(lemmaEntries)) {
    throw invalid("atom lemma scan requires atom, coverage, and lemma arrays");
  }
  if (!wordnetIndex || typeof wordnetIndex.lookup !== "function") {
    throw invalid("atom lemma scan requires a WordNet lemma index");
  }
  if (typeof rankForEnglish !== "function" || !(layerByWord instanceof Map)) {
    throw invalid("atom lemma scan requires frequency and glyph-layer indexes");
  }

  const atomsBySurface = new Map();
  const atomsByPyac = new Map();
  for (const atom of atomicEntries) {
    const surface = normalizeEnglishLemmaWord(atom?.en);
    const pyac = typeof atom?.pya === "string" ? atom.pya.trim() : "";
    if (!surface || !pyac) continue;
    const normalizedAtom = { en: String(atom.en).normalize("NFC").trim(), pya: pyac };
    const surfaceRows = atomsBySurface.get(surface) ?? [];
    if (!surfaceRows.some((row) => row.pya === pyac)) surfaceRows.push(normalizedAtom);
    atomsBySurface.set(surface, surfaceRows);
    if (!atomsByPyac.has(pyac)) atomsByPyac.set(pyac, normalizedAtom);
  }
  const atomIndex = { bySurface: atomsBySurface, byPyac: atomsByPyac };
  const catalogBySurface = new Map(lemmaEntries.map((entry) => [
    normalizeEnglishLemmaWord(entry.surface), entry
  ]));

  const allOccurrences = [];
  for (const atom of [...atomsBySurface.values()].flat()) {
    if (markerLabel(atom.en)) continue;
    const existing = catalogBySurface.get(atom.en);
    if (existing?.kind === "duplicate" && existing.status === "deprecated-duplicate") continue;
    const choice = chooseCandidate(
      atom.en,
      atom,
      atomIndex,
      catalogBySurface,
      rankForEnglish,
      layerByWord,
      wordnetIndex
    );
    if (choice.selected) allOccurrences.push({ atom, ...choice.selected });
  }

  const occurrencesByLemma = new Map();
  for (const occurrence of allOccurrences) {
    const rows = occurrencesByLemma.get(occurrence.lemma) ?? [];
    rows.push(occurrence);
    occurrencesByLemma.set(occurrence.lemma, rows);
  }
  const canonicalByLemma = new Map();
  for (const [lemma, occurrences] of occurrencesByLemma) {
    const explicit = catalogTarget(catalogBySurface.get(lemma), atomsBySurface, rankForEnglish, layerByWord);
    const exactAtom = exactAtomForSurface(lemma, atomsBySurface, rankForEnglish, layerByWord);
    const root = explicit ?? (exactAtom ? { english: exactAtom.en, pyac: exactAtom.pya, source: "exact-atom-lemma" } : null);
    if (root) {
      canonicalByLemma.set(lemma, root);
      continue;
    }
    const ranked = [...occurrences].sort((left, right) => (
      rank(left.atom.en, rankForEnglish) - rank(right.atom.en, rankForEnglish)
      || (layerByWord.get(left.atom.pya) ?? Number.MAX_SAFE_INTEGER) - (layerByWord.get(right.atom.pya) ?? Number.MAX_SAFE_INTEGER)
      || left.atom.en.localeCompare(right.atom.en)
      || left.atom.pya.localeCompare(right.atom.pya)
    ));
    const best = ranked[0];
    const tied = ranked.filter((row) => (
      rank(row.atom.en, rankForEnglish) === rank(best.atom.en, rankForEnglish)
      && (layerByWord.get(row.atom.pya) ?? Number.MAX_SAFE_INTEGER)
        === (layerByWord.get(best.atom.pya) ?? Number.MAX_SAFE_INTEGER)
    ));
    if (new Set(tied.map((row) => row.atom.pya)).size === 1) {
      canonicalByLemma.set(lemma, {
        english: best.atom.en,
        pyac: best.atom.pya,
        source: "frequency-then-glyph-layer"
      });
    }
  }

  return atomCoverage.map((coverage) => {
    if (coverage?.status !== "no-direct-wordnet-candidate") {
      throw invalid("atom lemma scan only accepts no-direct-wordnet-candidate rows", {
        id: coverage?.id,
        status: coverage?.status
      });
    }
    const labels = Array.isArray(coverage.labels) ? coverage.labels : [];
    const grammarLabels = new Set(grammarLabelsForIdentity(coverage, grammarEntries));
    const assignments = labels.map((surfaceValue) => {
      const surface = normalizeEnglishLemmaWord(surfaceValue);
      const existing = catalogBySurface.get(surface);
      if (grammarLabels.has(surfaceValue)) {
        return {
          surface: surfaceValue,
          kind: "grammar-word",
          lemma: "",
          canonicalEnglish: surfaceValue,
          canonicalPyac: coverage.pyac,
          method: markerLabel(surfaceValue) ? "grammar-marker-underscore" : "accepted-grammar-catalog",
          evidence: markerLabel(surfaceValue)
            ? "Pyash atom inventory marks grammar and morphology words with a leading or trailing underscore."
            : "The English grammar catalog maps this surface to this Pyac identity."
        };
      }
      if (existing?.kind === "duplicate" && existing.status === "deprecated-duplicate") {
        const canonicalEnglish = existing.canonicalEnglish || existing.duplicateOf;
        const canonicalAtom = exactAtomForSurface(canonicalEnglish, atomsBySurface, rankForEnglish, layerByWord);
        return {
          surface: surfaceValue,
          kind: "duplicate",
          lemma: existing.lemma,
          duplicateOf: existing.duplicateOf,
          canonicalEnglish,
          canonicalPyac: canonicalAtom?.pya ?? "",
          method: "reviewed-duplicate-catalog",
          evidence: existing.evidence
        };
      }

      if (existing && ACCEPTED_STATUSES.has(existing.status)) {
        const canonicalEnglish = existing.canonicalEnglish || existing.lemma || surfaceValue;
        const canonicalAtom = catalogTarget(existing, atomsBySurface, rankForEnglish, layerByWord)
          ?? exactAtomForSurface(canonicalEnglish, atomsBySurface, rankForEnglish, layerByWord);
        return {
          surface: surfaceValue,
          kind: "lemma",
          lemma: existing.lemma,
          canonicalEnglish: canonicalAtom?.en ?? surfaceValue,
          canonicalPyac: canonicalAtom?.pya ?? coverage.pyac,
          method: "accepted-lemma-catalog",
          rule: existing.rule,
          lemmaRank: Number.isFinite(rank(existing.lemma, rankForEnglish))
            ? rank(existing.lemma, rankForEnglish)
            : null,
          evidence: existing.evidence
        };
      }

      const atom = atomsByPyac.get(coverage.pyac) ?? { en: surface, pya: coverage.pyac };
      const choice = chooseCandidate(
        surface,
        atom,
        atomIndex,
        catalogBySurface,
        rankForEnglish,
        layerByWord,
        wordnetIndex
      );
      const selected = choice.selected;
      const canonical = selected ? canonicalByLemma.get(selected.lemma) : null;
      if (selected && canonical) {
        const isDuplicate = canonical.pyac !== coverage.pyac;
        return {
          surface: surfaceValue,
          kind: isDuplicate ? "duplicate" : "lemma",
          lemma: selected.lemma,
          ...(isDuplicate ? { duplicateOf: selected.lemma } : {}),
          canonicalEnglish: canonical.english,
          canonicalPyac: canonical.pyac,
          method: isDuplicate ? "frequency-and-glyph-canonicalization" : "wordnet-regular-inflection",
          rule: selected.rule,
          lemmaRank: Number.isFinite(selected.rank) ? selected.rank : null,
          evidence: isDuplicate
            ? `The supplied WordNet lemma ${selected.lemma} resolves to canonical atom ${canonical.english}/${canonical.pyac}; the duplicate atom is retained for lookup only.`
            : `WordNet supports ${surfaceValue} as a regular inflection of ${selected.lemma}; this atom is the selected Pyac target for that lemma.`
        };
      }

      return {
        surface: surfaceValue,
        kind: "lemma",
        lemma: surface,
        canonicalEnglish: surfaceValue,
        canonicalPyac: coverage.pyac,
        method: choice.options.length > 0 ? "ambiguous-self-lemma" : "surface-lemma",
        candidates: choice.options.map((option) => ({
          lemma: option.lemma,
          rank: Number.isFinite(option.rank) ? option.rank : null,
          canonicalEnglish: option.targetEnglish,
          canonicalPyac: option.targetPyac,
          rule: option.rule
        })),
        evidence: choice.options.length > 0
          ? "Multiple plausible WordNet lemmas remain tied by frequency and glyph-layer evidence; preserve the atom's surface lemma."
          : "No supported inflectional relation to another lemma was found; preserve the atom's English surface as its lemma."
      };
    });
    return {
      id: coverage.id,
      pyac: coverage.pyac,
      labels,
      status: "assigned",
      assignments
    };
  });
}

export function buildEnglishAtomLemmaCatalogAdditions(assignments = [], existingEntries = [], atomicEntries = [], grammarEntries = []) {
  if (!Array.isArray(assignments) || !Array.isArray(existingEntries)
    || !Array.isArray(atomicEntries) || !Array.isArray(grammarEntries)) {
    throw invalid("atom lemma catalog additions require assignment and catalog arrays");
  }
  const existing = new Set(existingEntries.map((entry) => normalizeEnglishLemmaWord(entry.surface)));
  const atomicSurfaces = new Set(atomicEntries.map((entry) => normalizeEnglishLemmaWord(entry?.en)).filter(Boolean));
  const grammarSurfaces = new Set(grammarEntries.map((entry) => normalizeEnglishLemmaWord(entry?.surface)).filter(Boolean));
  const additions = new Map();
  for (const row of assignments) {
    for (const assignment of row.assignments ?? []) {
      const surface = normalizeEnglishLemmaWord(assignment.surface);
      if (!surface || existing.has(surface) || assignment.kind === "grammar-word") continue;
      if (assignment.kind === "duplicate") {
        additions.set(surface, {
          surface: assignment.surface,
          lemma: assignment.lemma,
          canonicalEnglish: assignment.canonicalEnglish,
          kind: "duplicate",
          status: "deprecated-duplicate",
          duplicateOf: assignment.duplicateOf || assignment.lemma,
          rule: assignment.rule ?? "",
          evidence: assignment.evidence
        });
        existing.add(surface);
      } else if (assignment.kind === "lemma" && assignment.lemma !== surface && assignment.method === "wordnet-regular-inflection") {
        additions.set(surface, {
          surface: assignment.surface,
          lemma: assignment.lemma,
          canonicalEnglish: assignment.canonicalEnglish,
          kind: "inflectional",
          status: "accepted-deterministic",
          rule: assignment.rule ?? "",
          evidence: assignment.evidence
        });
        existing.add(surface);
      }
    }
  }

  const lemmaTargets = new Map();
  for (const row of assignments) {
    for (const assignment of row.assignments ?? []) {
      if (!assignment.lemma || !assignment.canonicalEnglish || assignment.kind === "grammar-word") continue;
      const lemma = normalizeEnglishLemmaWord(assignment.lemma);
      const target = normalizeEnglishLemmaWord(assignment.canonicalEnglish);
      if (!lemma || lemma === target || existing.has(lemma) || atomicSurfaces.has(lemma)
        || grammarSurfaces.has(lemma)) continue;
      const previous = lemmaTargets.get(lemma);
      if (previous && normalizeEnglishLemmaWord(previous.canonicalEnglish) !== target) {
        throw invalid("scanned lemma resolves to multiple Pyac targets", {
          lemma,
          targets: [previous.canonicalEnglish, assignment.canonicalEnglish]
        });
      }
      if (!previous) lemmaTargets.set(lemma, assignment);
    }
  }
  for (const [lemma, assignment] of lemmaTargets) {
    additions.set(lemma, {
      surface: assignment.lemma,
      lemma,
      canonicalEnglish: assignment.canonicalEnglish,
      kind: "anchor",
      status: "accepted-deterministic",
      evidence: `The atom lemma scan linked ${assignment.lemma} to ${assignment.canonicalEnglish} using English30k rank and WordNet morphology evidence.`
    });
  }
  return [...additions.values()].sort((left, right) => left.surface.localeCompare(right.surface));
}

export function renderEnglishAtomLemmaAssignmentsPya(assignments, {
  name = "translation_english_atom_lemma_assignments",
  runId = "",
  sourceHash = ""
} = {}) {
  if (!Array.isArray(assignments)) throw invalid("atom lemma assignment renderer requires rows");
  const summary = assignments.flatMap((row) => row.assignments ?? []).reduce((counts, row) => {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, {});
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_ATOM_LEMMA_SCAN_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "row-count" ob num ${assignments.length} ya`,
    `su text "assignment-counts" ob text ${JSON.stringify(JSON.stringify(summary))} ya`,
    ...assignments.map((row) => `su text ${JSON.stringify(row.id)} ob text ${JSON.stringify(JSON.stringify(row))} ya`),
    "prah",
    ""
  ];
  return lines.join("\n");
}
