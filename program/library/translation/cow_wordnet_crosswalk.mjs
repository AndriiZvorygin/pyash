import { JSDOM } from "jsdom";

import { buildProgram } from "../../program.mjs";
import { english30kLookupVariants } from "./english30k_coverage.mjs";

export const COW_WORDNET_CROSSWALK_FORMAT = "cow-wordnet-sense-crosswalk-v1";
export const COW_WORDNET_CROSSWALK_NAME = "translation_cow_wordnet_crosswalk";

const HAN = /\p{Script=Han}/u;
const FREQUENCY_STATUS_PRIORITY = Object.freeze({
  "frequency-top": 0,
  "unresolved-frequency-tie": 1,
  "no-english30k-frequency": 2
});

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-cow-wordnet-crosswalk";
  error.details = details;
  return error;
}

function text(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function codePointSort(left, right) {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference) return difference;
  }
  return a.length - b.length;
}

function hanLength(value) {
  return [...String(value ?? "").matchAll(/\p{Script=Han}/gu)].length;
}

function validIli(value) {
  return /^i[0-9]+$/u.test(text(value));
}

function unique(values) {
  return [...new Set(values)];
}

export function parseCowChineseWordNet(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw invalid("COW WordNet source must be XML text");
  }
  let document;
  try {
    document = new JSDOM(source, { contentType: "text/xml" }).window.document;
  } catch (error) {
    throw invalid("COW WordNet XML is malformed", { cause: error.message });
  }
  if (document.querySelector("parsererror")) throw invalid("COW WordNet XML is malformed");
  const lexicon = [...document.querySelectorAll("Lexicon")]
    .find((entry) => entry.getAttribute("id") === "cow");
  if (!lexicon || lexicon.getAttribute("version") !== "1.1") {
    throw invalid("COW source must be Chinese Open Wordnet 1.1");
  }

  const synsets = [...lexicon.querySelectorAll("Synset")].map((synset) => ({
    id: text(synset.getAttribute("id")),
    ili: text(synset.getAttribute("ili")),
    partOfSpeech: text(synset.getAttribute("partOfSpeech"))
  })).filter((row) => row.id);
  const synsetsById = new Map(synsets.map((row) => [row.id, row]));
  const seen = new Set();
  const senses = [];
  for (const entry of lexicon.querySelectorAll("LexicalEntry")) {
    const lemma = entry.querySelector("Lemma");
    const form = text(lemma?.getAttribute("writtenForm"));
    if (!form || !HAN.test(form)) continue;
    for (const sense of entry.querySelectorAll("Sense")) {
      const cowSynsetId = text(sense.getAttribute("synset"));
      const synset = synsetsById.get(cowSynsetId);
      const key = `${form}\u0000${cowSynsetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      senses.push({
        form,
        hanCharacterCount: hanLength(form),
        cowSynsetId,
        ili: validIli(synset?.ili) ? synset.ili : "",
        partOfSpeech: text(synset?.partOfSpeech)
      });
    }
  }
  senses.sort((left, right) => codePointSort(left.form, right.form)
    || left.cowSynsetId.localeCompare(right.cowSynsetId));
  return {
    lexicon: {
      id: text(lexicon.getAttribute("id")),
      language: text(lexicon.getAttribute("language")),
      version: text(lexicon.getAttribute("version"))
    },
    synsets,
    senses
  };
}

function normalizedWord(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

function buildWordNetSenseRows(wordnetRows, english30kRows, wordnetFrequencyEntries) {
  const rankByLemma = new Map();
  for (const row of english30kRows) {
    for (const variant of english30kLookupVariants(row.word)) {
      const prior = rankByLemma.get(variant);
      if (!prior || row.rank < prior) rankByLemma.set(variant, row.rank);
    }
  }
  const tagCountBySenseLemma = new Map();
  for (const row of wordnetFrequencyEntries) {
    if (!Number.isSafeInteger(row.tagCount) || row.tagCount < 0) continue;
    const key = `${row.pos}:${row.synset}\u0000${normalizedWord(row.lemma)}`;
    tagCountBySenseLemma.set(key, Math.max(tagCountBySenseLemma.get(key) ?? -1, row.tagCount));
  }

  const grouped = new Map();
  for (const row of wordnetRows) {
    const pos = text(row.pos);
    const synset = text(row.synset);
    const ili = validIli(row.ili) ? text(row.ili) : "";
    if (!pos || !synset || !ili) continue;
    const senseId = `${pos}:${synset}`;
    const group = grouped.get(senseId) ?? {
      wordNetSenseId: senseId,
      synset,
      partOfSpeech: pos,
      ili,
      lemmas: [],
      gloss: ""
    };
    if (group.ili !== ili) {
      throw invalid("one local WordNet sense has conflicting ILI values", { senseId, first: group.ili, next: ili });
    }
    const lemma = text(row.lemma);
    if (lemma && !group.lemmas.includes(lemma)) group.lemmas.push(lemma);
    if (!group.gloss && text(row.gloss)) group.gloss = text(row.gloss);
    grouped.set(senseId, group);
  }

  return [...grouped.values()].map((row) => {
    const rankedLemmas = row.lemmas.map((lemma) => ({
      lemma,
      rank: english30kLookupVariants(lemma)
        .map((variant) => rankByLemma.get(variant))
        .filter((rank) => Number.isSafeInteger(rank) && rank > 0)
        .reduce((best, rank) => Math.min(best, rank), Number.MAX_SAFE_INTEGER)
    })).filter((entry) => entry.rank < Number.MAX_SAFE_INTEGER)
      .sort((left, right) => left.rank - right.rank || left.lemma.localeCompare(right.lemma));
    const frequencyRank = rankedLemmas[0]?.rank ?? null;
    const topRankLemmas = rankedLemmas.filter((entry) => entry.rank === frequencyRank);
    const tagCounts = topRankLemmas.map(({ lemma }) => tagCountBySenseLemma.get(
      `${row.partOfSpeech}:${row.synset}\u0000${normalizedWord(lemma)}`
    )).filter(Number.isSafeInteger);
    return {
      ...row,
      lemmas: row.lemmas.sort((left, right) => left.localeCompare(right)),
      frequencyRank,
      frequencyTagCount: tagCounts.length === topRankLemmas.length && tagCounts.length > 0
        ? Math.max(...tagCounts)
        : null,
      ...(topRankLemmas.length === 1 ? { frequencyLemma: topRankLemmas[0].lemma } : {}),
      ...(topRankLemmas.length > 1 ? { frequencyLemmaCandidates: topRankLemmas.map(({ lemma }) => lemma) } : {})
    };
  });
}

function buildFormSenseFrequencyTiers(formRows) {
  const ranked = formRows.filter(({ sense }) => Number.isSafeInteger(sense.frequencyRank)
    && sense.frequencyRank > 0);
  const byRank = new Map();
  for (const row of ranked) {
    const group = byRank.get(row.sense.frequencyRank) ?? [];
    group.push(row);
    byRank.set(row.sense.frequencyRank, group);
  }
  const tiers = [];
  for (const rank of [...byRank.keys()].sort((left, right) => left - right)) {
    const rankGroup = byRank.get(rank);
    // Exact Princeton counts split an English30k tie only when every sense has one.
    if (rankGroup.length > 1 && rankGroup.every(({ sense }) => Number.isSafeInteger(sense.frequencyTagCount))) {
      const byTagCount = new Map();
      for (const row of rankGroup) {
        const group = byTagCount.get(row.sense.frequencyTagCount) ?? [];
        group.push(row);
        byTagCount.set(row.sense.frequencyTagCount, group);
      }
      for (const tagCount of [...byTagCount.keys()].sort((left, right) => right - left)) {
        tiers.push(byTagCount.get(tagCount));
      }
    } else {
      tiers.push(rankGroup);
    }
  }
  return tiers;
}

function frequencyRank(form, subtlex, junda) {
  const subtlexRank = Number.isSafeInteger(subtlex?.get(form)?.rank) ? subtlex.get(form).rank : null;
  const jundaRank = Number.isSafeInteger(junda?.get(form)?.rank) ? junda.get(form).rank : null;
  return { subtlexRank, jundaRank };
}

function compareChineseFormFrequency(left, right) {
  const leftHasSubtlex = Number.isSafeInteger(left.subtlexRank);
  const rightHasSubtlex = Number.isSafeInteger(right.subtlexRank);
  if (leftHasSubtlex !== rightHasSubtlex) return leftHasSubtlex ? -1 : 1;
  if (leftHasSubtlex) return left.subtlexRank - right.subtlexRank;
  const leftHasJunda = Number.isSafeInteger(left.jundaRank);
  const rightHasJunda = Number.isSafeInteger(right.jundaRank);
  if (leftHasJunda !== rightHasJunda) return leftHasJunda ? -1 : 1;
  if (leftHasJunda) return left.jundaRank - right.jundaRank;
  return 0;
}

export function buildCowWordNetSenseCrosswalk({
  cow,
  wordnetRows = [],
  english30kRows = [],
  wordnetFrequencyEntries = [],
  subtlex = new Map(),
  junda = new Map()
} = {}) {
  if (!Array.isArray(cow?.synsets) || !Array.isArray(cow?.senses)
    || !Array.isArray(wordnetRows) || !Array.isArray(english30kRows)
    || !Array.isArray(wordnetFrequencyEntries)
    || !(subtlex instanceof Map) || !(junda instanceof Map)) {
    throw invalid("COW crosswalk requires parsed COW, WordNet, and frequency inputs");
  }

  const wordnetSenses = buildWordNetSenseRows(wordnetRows, english30kRows, wordnetFrequencyEntries);
  const wordnetSensesByIli = new Map();
  for (const sense of wordnetSenses) {
    const matches = wordnetSensesByIli.get(sense.ili) ?? [];
    matches.push(sense);
    wordnetSensesByIli.set(sense.ili, matches);
  }

  const formsBySense = new Map();
  const cowIlisMatched = new Set();
  const chineseFormsMatched = new Set();
  for (const row of cow.senses) {
    if (!row.ili) continue;
    const matches = wordnetSensesByIli.get(row.ili) ?? [];
    if (matches.length === 0) continue;
    cowIlisMatched.add(row.ili);
    chineseFormsMatched.add(row.form);
    for (const wordnetSense of matches) {
      const forms = formsBySense.get(wordnetSense.wordNetSenseId) ?? new Map();
      const form = forms.get(row.form) ?? {
        form: row.form,
        hanCharacterCount: row.hanCharacterCount,
        cowSynsetIds: new Set(),
        ...frequencyRank(row.form, subtlex, junda)
      };
      form.cowSynsetIds.add(row.cowSynsetId);
      forms.set(row.form, form);
      formsBySense.set(wordnetSense.wordNetSenseId, forms);
    }
  }

  const formSenseFrequency = new Map();
  for (const sense of wordnetSenses) {
    for (const form of formsBySense.get(sense.wordNetSenseId)?.keys() ?? []) {
      const rows = formSenseFrequency.get(form) ?? [];
      rows.push({ sense });
      formSenseFrequency.set(form, rows);
    }
  }
  const frequencyTierByFormAndSense = new Map();
  const frequencyTopTieForms = new Set();
  for (const [form, rows] of formSenseFrequency) {
    const tiers = buildFormSenseFrequencyTiers(rows);
    if (tiers[0]?.length > 1) frequencyTopTieForms.add(form);
    tiers.forEach((tier, tierIndex) => {
      for (const { sense } of tier) {
        frequencyTierByFormAndSense.set(`${form}\u0000${sense.wordNetSenseId}`, {
          frequencyTier: tierIndex + 1,
          frequencyStatus: tierIndex > 0
            ? "lower-frequency"
            : tier.length > 1 ? "unresolved-frequency-tie" : "frequency-top"
        });
      }
    });
  }

  const records = [];
  for (const sense of wordnetSenses) {
    const formRows = [...(formsBySense.get(sense.wordNetSenseId)?.values() ?? [])];
    if (formRows.length === 0) continue;
    const shortestLength = Math.min(...formRows.map((row) => row.hanCharacterCount));
    const shortestRows = formRows.filter((row) => row.hanCharacterCount === shortestLength);
    let preferredRows = shortestRows;
    if (shortestLength === 1 && shortestRows.length > 1) {
      const sortedByFrequency = [...shortestRows].sort((left, right) => (
        compareChineseFormFrequency(left, right) || codePointSort(left.form, right.form)
      ));
      const best = sortedByFrequency[0];
      const hasFrequencyEvidence = Number.isSafeInteger(best.subtlexRank) || Number.isSafeInteger(best.jundaRank);
      if (hasFrequencyEvidence) {
        preferredRows = sortedByFrequency.filter((row) => compareChineseFormFrequency(row, best) === 0);
      }
    }
    const preferred = new Set(preferredRows.map((row) => row.form));
    const chineseForms = formRows.sort((left, right) => (
      left.hanCharacterCount - right.hanCharacterCount
        || compareChineseFormFrequency(left, right)
        || codePointSort(left.form, right.form)
    )).map((row) => ({
      form: row.form,
      hanCharacterCount: row.hanCharacterCount,
      preferred: preferred.has(row.form),
      ...(frequencyTierByFormAndSense.get(`${row.form}\u0000${sense.wordNetSenseId}`) ?? {
        frequencyTier: null,
        frequencyStatus: "no-english30k-frequency"
      }),
      cowSynsetIds: [...row.cowSynsetIds].sort(),
      ...(row.subtlexRank !== null ? { subtlexRank: row.subtlexRank } : {}),
      ...(row.jundaRank !== null ? { jundaRank: row.jundaRank } : {})
    }));
    records.push({
      wordNetSenseId: sense.wordNetSenseId,
      synset: sense.synset,
      partOfSpeech: sense.partOfSpeech,
      ili: sense.ili,
      frequencyRank: sense.frequencyRank,
      frequencyTagCount: sense.frequencyTagCount,
      ...(sense.frequencyLemma ? { frequencyLemma: sense.frequencyLemma } : {}),
      ...(sense.frequencyLemmaCandidates ? { frequencyLemmaCandidates: sense.frequencyLemmaCandidates } : {}),
      chineseForms,
      preferredHanCharacterCount: shortestLength
    });
  }
  records.sort((left, right) => left.wordNetSenseId.localeCompare(right.wordNetSenseId));

  const cowIlis = new Set(cow.synsets.filter((row) => validIli(row.ili)).map((row) => row.ili));
  const cowIlisMissingFromWordNet = [...cowIlis].filter((ili) => !wordnetSensesByIli.has(ili)).length;
  const cowSynsetsMatched = new Set(cow.synsets.filter((row) => validIli(row.ili)
    && wordnetSensesByIli.has(row.ili)).map((row) => row.id));
  const formSenseRows = records.reduce((count, record) => count + record.chineseForms.length, 0);
  const report = {
    cowSynsetCount: cow.synsets.length,
    cowSynsetsWithIli: cow.synsets.filter((row) => validIli(row.ili)).length,
    cowSynsetsMatched: cowSynsetsMatched.size,
    cowSynsetsWithoutIli: cow.synsets.filter((row) => !validIli(row.ili)).length,
    cowIlisMissingFromWordNet,
    cowIlisMatched: cowIlisMatched.size,
    chineseFormsMatched: chineseFormsMatched.size,
    wordnetSenseRows: records.length,
    formSenseRows,
    preferredFormSenseRows: records.reduce((count, record) => count
      + record.chineseForms.filter((form) => form.preferred).length, 0),
    chineseFormsWithTopSenseFrequencyTies: frequencyTopTieForms.size
  };
  return { records, report };
}

export function buildCowWordNetCrosswalkIndex(records = []) {
  if (!Array.isArray(records)) throw invalid("COW crosswalk index requires sense records");
  const byWordNetSense = new Map();
  const byChineseForm = new Map();
  const preferredByChineseForm = new Map();
  const frequencyPreferredByChineseForm = new Map();
  const preferredSenseByChineseForm = new Map();
  const byIli = new Map();
  for (const record of records) {
    const senseId = text(record?.wordNetSenseId);
    const ili = text(record?.ili);
    if (!senseId || !validIli(ili) || byWordNetSense.has(senseId)) {
      throw invalid("COW crosswalk contains an invalid or duplicate WordNet sense", { senseId, ili });
    }
    byWordNetSense.set(senseId, record);
    const senseRows = byIli.get(ili) ?? [];
    senseRows.push(record);
    byIli.set(ili, senseRows);
    for (const form of record.chineseForms ?? []) {
      const writtenForm = text(form.form);
      if (!writtenForm || !HAN.test(writtenForm)) throw invalid("COW crosswalk contains an invalid Chinese form", { senseId, form });
      const rows = byChineseForm.get(writtenForm) ?? [];
      const indexedRow = { ...record, matchedForm: form };
      rows.push(indexedRow);
      byChineseForm.set(writtenForm, rows);
      if (form.preferred) {
        const preferredRows = preferredByChineseForm.get(writtenForm) ?? [];
        preferredRows.push(indexedRow);
        preferredByChineseForm.set(writtenForm, preferredRows);
      }
      if (form.frequencyStatus === "frequency-top") {
        const preferredRows = frequencyPreferredByChineseForm.get(writtenForm) ?? [];
        preferredRows.push(indexedRow);
        frequencyPreferredByChineseForm.set(writtenForm, preferredRows);
      }
      if (form.preferred && form.frequencyStatus === "frequency-top") {
        const preferredRows = preferredSenseByChineseForm.get(writtenForm) ?? [];
        preferredRows.push(indexedRow);
        preferredSenseByChineseForm.set(writtenForm, preferredRows);
      }
    }
  }
  return {
    byWordNetSense,
    byChineseForm,
    preferredByChineseForm,
    frequencyPreferredByChineseForm,
    preferredSenseByChineseForm,
    byIli
  };
}

export function lookupCowChineseFormsByWordNetSenses(index, senseIds = []) {
  if (!(index?.byWordNetSense instanceof Map) || !(index?.byChineseForm instanceof Map)
    || !Array.isArray(senseIds)) {
    throw invalid("COW Chinese lookup requires a crosswalk index and WordNet sense ids");
  }
  const requestedSenseIds = new Set(senseIds.map((senseId) => text(senseId).toLowerCase()).filter(Boolean));
  const results = new Map();
  for (const senseId of requestedSenseIds) {
    const record = index.byWordNetSense.get(senseId);
    if (!record) continue;
    for (const form of record.chineseForms ?? []) {
      if (!form.preferred) continue;
      const candidates = (index.byChineseForm.get(form.form) ?? [])
        .filter((candidate) => candidate.matchedForm?.preferred);
      const status = form.frequencyStatus;
      let preferredCandidates = [];
      if (status === "frequency-top") {
        preferredCandidates = candidates.filter((candidate) => candidate.matchedForm.frequencyStatus === status);
      } else if (status === "unresolved-frequency-tie") {
        preferredCandidates = candidates.filter((candidate) => candidate.matchedForm.frequencyStatus === status);
      } else if (status === "no-english30k-frequency"
        && candidates.length > 0
        && candidates.every((candidate) => candidate.matchedForm.frequencyStatus === status)) {
        preferredCandidates = candidates;
      }
      const candidateSenseIds = [...new Set(preferredCandidates.map((candidate) => candidate.wordNetSenseId))]
        .sort((left, right) => left.localeCompare(right));
      if (!candidateSenseIds.includes(senseId)) continue;
      const result = results.get(form.form) ?? {
        chinese: form.form,
        hanCharacterCount: form.hanCharacterCount,
        frequencyStatus: status,
        wordNetSenseIds: candidateSenseIds,
        matchedWordNetSenseIds: [],
        frequencyRank: record.frequencyRank,
        frequencyTagCount: record.frequencyTagCount,
        cowSynsetIds: [...new Set(preferredCandidates.flatMap((candidate) => candidate.matchedForm.cowSynsetIds ?? []))].sort(),
        ...(form.subtlexRank !== undefined ? { subtlexRank: form.subtlexRank } : {}),
        ...(form.jundaRank !== undefined ? { jundaRank: form.jundaRank } : {})
      };
      result.matchedWordNetSenseIds.push(senseId);
      results.set(form.form, result);
    }
  }
  return [...results.values()].map((row) => ({
    ...row,
    matchedWordNetSenseIds: [...new Set(row.matchedWordNetSenseIds)].sort((left, right) => left.localeCompare(right))
  })).sort((left, right) => left.hanCharacterCount - right.hanCharacterCount
    || (FREQUENCY_STATUS_PRIORITY[left.frequencyStatus] ?? 3)
      - (FREQUENCY_STATUS_PRIORITY[right.frequencyStatus] ?? 3)
    || (Number.isSafeInteger(left.frequencyRank) ? left.frequencyRank : Number.MAX_SAFE_INTEGER)
      - (Number.isSafeInteger(right.frequencyRank) ? right.frequencyRank : Number.MAX_SAFE_INTEGER)
    || compareChineseFormFrequency(left, right)
    || codePointSort(left.chinese, right.chinese));
}

export function renderCowWordNetCrosswalkPya(records = [], {
  source = "Chinese Open Wordnet 1.1 joined to Open English WordNet by ILI",
  sourceHash = "",
  sourceHashes = {}
} = {}) {
  if (!Array.isArray(records)) throw invalid("COW crosswalk renderer requires sense records");
  const lines = [
    `su name ${COW_WORDNET_CROSSWALK_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(COW_WORDNET_CROSSWALK_FORMAT)} ya`,
    `su text "source" ob text ${JSON.stringify(source)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "source-hashes" ob text ${JSON.stringify(JSON.stringify(sourceHashes))} ya`,
    `su text "sense-count" ob num ${records.length} ya`
  ];
  for (const record of records) {
    const senseId = text(record?.wordNetSenseId);
    if (!senseId || !validIli(record.ili) || !Array.isArray(record.chineseForms) || record.chineseForms.length === 0) {
      throw invalid("COW crosswalk rows require a WordNet sense, ILI, and Chinese form", { senseId });
    }
    lines.push(`su text ${JSON.stringify(`sense:${senseId}`)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export function parseCowWordNetCrosswalkPya(source) {
  if (typeof source !== "string") throw invalid("COW WordNet crosswalk must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map" && sentence?.su?.name === COW_WORDNET_CROSSWALK_NAME);
  if (!header) throw invalid("COW WordNet crosswalk has no canonical map header");
  const metadata = {};
  const records = [];
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    const key = sentence.su.text;
    if (typeof sentence.ob?.text !== "string") continue;
    if (key === "format" || key === "source" || key === "source-hash" || key === "source-hashes") {
      metadata[key] = sentence.ob.text;
      continue;
    }
    if (key === "sense-count") {
      metadata[key] = Number(sentence.ob.num);
      continue;
    }
    if (!key.startsWith("sense:")) continue;
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("COW crosswalk row is malformed JSON", { key, cause: error.message });
    }
    if (key !== `sense:${text(record.wordNetSenseId)}`) {
      throw invalid("COW crosswalk row key disagrees with its WordNet sense", { key, senseId: record.wordNetSenseId });
    }
    records.push(record);
  }
  if (metadata.format !== COW_WORDNET_CROSSWALK_FORMAT) {
    throw invalid("COW WordNet crosswalk has an unsupported format", { format: metadata.format });
  }
  const sourceHashes = metadata["source-hashes"] ? JSON.parse(metadata["source-hashes"]) : {};
  const index = buildCowWordNetCrosswalkIndex(records);
  return {
    source: metadata.source ?? "",
    sourceHash: metadata["source-hash"] ?? "",
    sourceHashes,
    records,
    ...index
  };
}
