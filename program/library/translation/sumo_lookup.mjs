import { buildProgram } from "../../program.mjs";
import {
  KWON_LOOKUP_INDEX_PATHS,
  lookupKwonIndex,
  readKwonSourceLocators
} from "./kwon_lookup_index.mjs";
import { loadOpenEnglishWordNetSenseRows } from "./english_wordnet.mjs";

function payloadFromPyaLine(line) {
  const sentence = buildProgram(line).sentences.find((row) => row?.mood === "ya" && typeof row.su?.text === "string");
  if (typeof sentence?.ob?.text !== "string") return null;
  try {
    return JSON.parse(sentence.ob.text);
  } catch {
    return null;
  }
}

export function formatSumoEvidence(record) {
  if (record?.kind === "wordnet-mapping") {
    const lemmas = record.lemmas ?? record.aliases ?? [];
    const crosswalk = record.crosswalkStatus === "unique"
      ? `Open English WordNet 2025 ${record.openEnglishWordNetIds[0]}`
      : record.crosswalkStatus === "ambiguous"
        ? `crosswalk ambiguous (${record.openEnglishWordNetIds.join(", ")})`
        : "crosswalk unmatched";
    const gloss = record.openEnglishWordNetGloss ? `; gloss: ${record.openEnglishWordNetGloss}` : "";
    return `SUMO ${record.label} [${record.sumoId}]: ${lemmas.join(", ")} -> WordNet 3.0 ${record.wordNet30Id} (${record.mappingSymbol}, ${record.mappingRelation}) -> ${crosswalk}${gloss}`;
  }
  if (record?.kind === "pyash-concept") {
    const relations = (record.sumoRelations ?? [])
      .map(({ sumoId, relation }) => `${sumoId} (${relation})`)
      .join(", ");
    const sequence = record.pyashSequence?.join(" ");
    return `Pyash ${record.label}${sequence ? ` [${sequence}]` : ""}: ${record.definition}${relations ? `; SUMO links: ${relations}` : ""}`;
  }
  return record?.sumoId ? `SUMO concept ${record.sumoId}: ${record.label ?? record.sumoId}` : null;
}

export async function lookupSumoEvidence(keys, {
  indexPath = KWON_LOOKUP_INDEX_PATHS.sumo,
  root,
  maximumRecords = 20
} = {}) {
  const uniqueKeys = [...new Set((keys ?? [])
    .filter((key) => typeof key === "string" && key.trim())
    .map((key) => key.trim().toLowerCase()))];
  if (uniqueKeys.length === 0) return { records: [], total: 0, truncated: false };
  let indexed;
  try {
    indexed = await Promise.all(uniqueKeys.map((key) => lookupKwonIndex({
      kind: "sumo",
      key,
      indexPath,
      ...(root ? { root } : {})
    })));
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], total: 0, truncated: false };
    if (error?.code === "stale-kwon-lookup-index") {
      return {
        records: [],
        total: 0,
        truncated: false,
        warning: "SUMO lookup index is stale; refresh it with node command/sumo_wordnet_import.mjs"
      };
    }
    throw error;
  }
  const locators = [...new Map(indexed.flat()
    .map((locator) => [`${locator.sourceId}\u0000${locator.byteOffset}`, locator])).values()];
  const loaded = await readKwonSourceLocators(locators, root ? { root } : {});
  const seen = new Set();
  const records = [];
  for (const { locator, line } of loaded) {
    const record = payloadFromPyaLine(line);
    if (record && !record.recordId) record.recordId = locator.recordId;
    if (!record?.recordId || seen.has(record.recordId)) continue;
    seen.add(record.recordId);
    records.push(record);
  }
  records.sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)));
  const limitedRecords = records.slice(0, maximumRecords);
  const senseIds = [...new Set(limitedRecords.flatMap((record) => record.openEnglishWordNetIds ?? []))];
  if (senseIds.length > 0) {
    try {
      const rows = await loadOpenEnglishWordNetSenseRows({ senseIds, ...(root ? { root } : {}) });
      const glosses = new Map();
      for (const row of rows) {
        const key = `${row.pos}:${row.synset}`;
        if (row.gloss && !glosses.has(key)) glosses.set(key, row.gloss);
      }
      for (const record of limitedRecords) {
        const gloss = (record.openEnglishWordNetIds ?? []).map((id) => glosses.get(id)).find(Boolean);
        if (gloss) record.openEnglishWordNetGloss = gloss;
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "stale-kwon-lookup-index") throw error;
    }
  }
  return {
    records: limitedRecords,
    total: records.length,
    truncated: records.length > maximumRecords
  };
}
