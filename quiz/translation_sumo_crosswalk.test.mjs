import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSumoWordNetCrosswalk,
  parseKifEnglishTermFormats,
  parseSumoWordNetMappingLine,
  parseWordNetSenseIndex
} from "../program/library/translation/sumo_wordnet.mjs";
import {
  buildKwonSumoLookupIndex,
  lookupKwonIndex,
  readKwonSourceLocators,
  renderKwonLookupIndexPya
} from "../program/library/translation/kwon_lookup_index.mjs";
import { formatSumoEvidence, lookupSumoEvidence } from "../program/library/translation/sumo_lookup.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test("SUMO English term formats parse KIF comments and quoted punctuation", () => {
  assert.deepEqual(parseKifEnglishTermFormats(`
; ignored (termFormat EnglishWrittenLanguage Wrong "no")
(termFormat EnglishWrittenLanguage ComputerTerminal "computer terminal")
(documentation ComputerTerminal EnglishWrittenLanguage "has ; punctuation and (nested) words")
(termFormat ChineseSimplifiedWriting ComputerTerminal "电脑终端")
`), new Map([["ComputerTerminal", "computer terminal"]]));
});

test("SUMO WordNet mapping rows retain the WordNet 3.0 ID and relation", () => {
  const row = parseSumoWordNetMappingLine(
    "03092656 06 n 01 console 2 002 @ 04147495 n 0000 ;c 03082979 n 0000 | a scientific console &%ComputerTerminal+"
  );
  assert.deepEqual(row, {
    wordNet30Id: "n:03092656",
    pos: "n",
    offset: "03092656",
    lemmas: ["console"],
    mappings: [{ sumoId: "ComputerTerminal", symbol: "+", relation: "subsumed-by" }]
  });
});

test("SUMO mapping symbols retain equality, instance, and complement relations", () => {
  const row = parseSumoWordNetMappingLine(
    "00000001 00 n 01 sample 0 000 | sample &%Equivalent= &%Broader+ &%Instance@ &%NotEquivalent: &%NotBroader[ &%NotInstance]"
  );
  assert.deepEqual(row.mappings.map(({ symbol, relation }) => [symbol, relation]), [
    ["=", "equivalent-to"],
    ["+", "subsumed-by"],
    ["@", "instance-of"],
    [":", "complement-of-equivalent"],
    ["[", "complement-of-subsumed-by"],
    ["]", "complement-of-instance"]
  ]);
});

test("SUMO mappings cross WordNet versions by shared sense key, never by offset", () => {
  const sense30 = parseWordNetSenseIndex("console%1:06:02:: 03092656 2 0\n");
  const sense31 = parseWordNetSenseIndex("console%1:06:02:: 03097112 2 0\n");
  const mapping = parseSumoWordNetMappingLine(
    "03092656 06 n 01 console 2 002 @ 04147495 n 0000 ;c 03082979 n 0000 | a scientific console &%ComputerTerminal+"
  );
  const records = buildSumoWordNetCrosswalk({
    mappingRows: [mapping],
    senseKeysByWordNet30: sense30.bySynset,
    wordNet31BySenseKey: sense31.bySenseKey,
    oewnSynsets: new Map([["n:03097112-n", { members: ["console"], ili: "i52286" }]]),
    termFormats: new Map([["ComputerTerminal", "computer terminal"]])
  });
  const linked = records.find((record) => record.kind === "wordnet-mapping");
  assert.equal(linked.wordNet30Id, "n:03092656");
  assert.deepEqual(linked.openEnglishWordNetIds, ["n:03097112-n"]);
  assert.equal(linked.crosswalkStatus, "unique");
  assert.equal(linked.mappingRelation, "subsumed-by");
  assert.notEqual(linked.wordNet30Id, linked.openEnglishWordNetIds[0]);
});

test("SUMO crosswalk preserves ambiguous and unmatched WordNet 3.0 mappings", () => {
  const sense30 = parseWordNetSenseIndex("sample%1:00:00:: 00000001 1 0\nmissing%1:00:00:: 00000002 1 0\n");
  const sense31 = parseWordNetSenseIndex("sample%1:00:00:: 00000011 1 0\nsample%1:00:00:: 00000012 1 0\n");
  const rows = [
    parseSumoWordNetMappingLine("00000001 00 n 01 sample 0 000 | gloss &%Concept+"),
    parseSumoWordNetMappingLine("00000002 00 n 01 missing 0 000 | gloss &%Concept+")
  ];
  const records = buildSumoWordNetCrosswalk({
    mappingRows: rows,
    senseKeysByWordNet30: sense30.bySynset,
    wordNet31BySenseKey: sense31.bySenseKey,
    oewnSynsets: new Map([
      ["n:00000011-n", { members: ["sample"] }],
      ["n:00000012-n", { members: ["sample"] }]
    ])
  }).filter((record) => record.kind === "wordnet-mapping");
  assert.deepEqual(records.map((record) => record.crosswalkStatus), ["ambiguous", "unmatched"]);
  assert.deepEqual(records[0].openEnglishWordNetIds, ["n:00000011-n", "n:00000012-n"]);
});

test("SUMO and Pyash concept records are searchable by id, English, and Pyac", async () => {
  const root = await mkdtemp(join(tmpdir(), "pyash-sumo-index-"));
  try {
    const sourceId = "know/sumo/pyash_wordnet_mappings.pya";
    const source = [
      'su text "sumo:ComputerTerminal" ob text "{\\"sumoId\\":\\"ComputerTerminal\\",\\"label\\":\\"computer terminal\\",\\"kind\\":\\"sumo-concept\\"}" ya',
      'su text "sumo-map:wn30:n:03092656:ComputerTerminal" ob text "{\\"kind\\":\\"wordnet-mapping\\",\\"sumoId\\":\\"ComputerTerminal\\",\\"label\\":\\"computer terminal\\",\\"aliases\\":[\\"console\\"],\\"wordNet30Id\\":\\"n:03092656\\",\\"openEnglishWordNetIds\\":[\\"n:03097112-n\\"],\\"mappingSymbol\\":\\"+\\",\\"mappingRelation\\":\\"subsumed-by\\",\\"crosswalkStatus\\":\\"unique\\"}" ya',
      'su text "pyash:command-session" ob text "{\\"label\\":\\"command-session\\",\\"aliases\\":[\\"interactive command session\\"],\\"pyashSequence\\":[\\"myin\\",\\"cyen\\"],\\"sumoIds\\":[\\"ComputerTerminal\\",\\"ComputerProcess\\"],\\"kind\\":\\"pyash-concept\\"}" ya',
      "prah",
      ""
    ].join("\n");
    const sourcePath = join(root, sourceId);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source, "utf8");
    const index = await buildKwonSumoLookupIndex({ root, sourcePaths: [sourceId] });
    const indexPath = join(root, "sumo-index.pya");
    await writeFile(indexPath, renderKwonLookupIndexPya(index), "utf8");
    const [byConcept, byEnglish, byWordNet30, byPyac] = await Promise.all([
      lookupKwonIndex({ kind: "sumo", key: "sumo:ComputerTerminal", indexPath, root }),
      lookupKwonIndex({ kind: "sumo", key: "console", indexPath, root }),
      lookupKwonIndex({ kind: "sumo", key: "n:03092656", indexPath, root }),
      lookupKwonIndex({ kind: "sumo", key: "myin cyen", indexPath, root })
    ]);
    assert.ok(byConcept.length > 0);
    assert.ok(byEnglish.some((row) => row.recordId === "sumo-map:wn30:n:03092656:ComputerTerminal"));
    assert.ok(byWordNet30.length > 0);
    assert.ok(byPyac.some((row) => row.recordId === "pyash:command-session"));
    const loaded = await readKwonSourceLocators(byEnglish, { root });
    assert.match(loaded.map((row) => row.line).join("\n"), /ComputerTerminal/u);
    const evidence = await lookupSumoEvidence(["console", "command-session"], { indexPath, root });
    assert.equal(evidence.total, 2);
    assert.ok(evidence.records.some((record) => record.kind === "wordnet-mapping"
      && formatSumoEvidence(record).includes("subsumed-by")));
    assert.ok(evidence.records.some((record) => record.kind === "pyash-concept"
      && formatSumoEvidence(record).includes("myin cyen")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
