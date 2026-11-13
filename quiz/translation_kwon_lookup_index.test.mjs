import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createKwonLookupIndexForTest,
  buildKwonLookupIndexes,
  clearKwonLookupIndexValidationCache,
  lookupKwonIndex,
  readKwonSourceLocators,
  renderKwonLookupIndexPya,
  takeKwonLookupWarnings
} from "../program/library/translation/kwon_lookup_index.mjs";
import { queryVocabLines } from "../command/vocab_query.mjs";
import { loadOpenEnglishWordNetSenseRows } from "../program/library/translation/english_wordnet.mjs";
import {
  ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
  loadEnglishWordNetBridgeSubset
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  ENGLISH_WORDNET_COMPOUND_GLOSSES_URL,
  loadEnglishWordNetCompoundGlosses,
  renderEnglishWordNetCompoundGlosses
} from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import {
  DERIVED_COMPOUND_CURATED_NAME,
  WORDNET_VERIFIED_COMPOUNDS_URL,
  loadWordNetVerifiedCompoundMatches,
  renderDerivedCompoundCoveragePya
} from "../program/library/translation/compound_coverage.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function locator(sourceId, source, lineIndex, recordId) {
  const byteOffset = Buffer.byteLength(`${source.split("\n").slice(0, lineIndex).join("\n")}\n`);
  return { sourceId, byteOffset, lineNumber: lineIndex + 1, recordId };
}

async function writeIndex(path, index) {
  await writeFile(path, renderKwonLookupIndexPya(index), "utf8");
}

test("kwon lookup indexes return exact and prefix postings by binary search", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-index-"));
  try {
    const sourcePath = join(directory, "records.pya");
    const source = "su text \"word\" ob text \"love\" ya\nsu text \"word\" ob text \"loved\" ya\n";
    await writeFile(sourcePath, source, "utf8");
    const index = createKwonLookupIndexForTest({
      kind: "english",
      sourceHashes: { "records.pya": sha256(Buffer.from(source)) },
      entries: [
        ["love", [{ sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "word" }]],
        ["loved", [{ sourceId: "records.pya", byteOffset: Buffer.byteLength("su text \"word\" ob text \"love\" ya\n"), lineNumber: 2, recordId: "word" }]],
        ["lovely", [{ sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "word" }]],
        ["zebra", [{ sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "word" }]]
      ]
    });
    const indexPath = join(directory, "english-index.pya");
    await writeFile(indexPath, renderKwonLookupIndexPya(index), "utf8");

    const exact = await lookupKwonIndex({ kind: "english", key: "LOVE", indexPath, root: directory });
    assert.equal(exact.length, 1);
    assert.equal(exact[0].recordId, "word");
    const prefix = await lookupKwonIndex({ kind: "english", key: "lov", prefix: true, indexPath, root: directory });
    assert.deepEqual(prefix.map((locator) => locator.lineNumber), [1, 2, 1]);
    assert.deepEqual(await lookupKwonIndex({ kind: "english", key: "zzzz", indexPath, root: directory }), []);
    assert.deepEqual(await lookupKwonIndex({ kind: "english", key: "zebra", prefix: true, indexPath, root: directory }), [
      { sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "word" }
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kwon lookup index rendering is stable for identical entries", () => {
  const first = createKwonLookupIndexForTest({
    kind: "pyac",
    sourceHashes: { "records.pya": sha256(Buffer.from("fixture")) },
    entries: [
      ["hmi2f", [{ sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "brain" }]],
      ["hmi", [{ sourceId: "records.pya", byteOffset: 30, lineNumber: 2, recordId: "mind" }]]
    ]
  });
  const second = createKwonLookupIndexForTest({
    kind: "pyac",
    sourceHashes: { "records.pya": sha256(Buffer.from("fixture")) },
    entries: [
      ["hmi", [{ sourceId: "records.pya", byteOffset: 30, lineNumber: 2, recordId: "mind" }]],
      ["hmi2f", [{ sourceId: "records.pya", byteOffset: 0, lineNumber: 1, recordId: "brain" }]]
    ]
  });
  assert.equal(renderKwonLookupIndexPya(first), renderKwonLookupIndexPya(second));
});

test("kwon index builder indexes Pya sense, Pyac sequence, and dictionary records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-build-"));
  try {
    const pyaSourceId = "program/library/translation/fixture.pya";
    const jsonSourceId = "caterer/pyac/lyac/fixture.json";
    const pyaSource = [
      'su text "n:07558676-n" ob text "{\\"senseId\\":\\"n:07558676-n\\",\\"target\\":\\"love\\",\\"pyashSequence\\":[\\"pyan\\",\\"hmi\\"]}" ya',
      'su text "decision:fixture-1" ob text "{\\"senseId\\":\\"v:01779085-v\\",\\"target\\":\\"love\\",\\"pyashSequence\\":[\\"pyan\\"]}" ya',
      'su text "sense-lemma:n:07558676-n:1" ob text "love" ya',
      "prah",
      ""
    ].join("\n");
    const jsonSource = JSON.stringify([{ en: "love", pya: "pyan" }]);
    const pyaPath = join(directory, pyaSourceId);
    const jsonPath = join(directory, jsonSourceId);
    await mkdir(dirname(pyaPath), { recursive: true });
    await mkdir(dirname(jsonPath), { recursive: true });
    await Promise.all([
      writeFile(pyaPath, pyaSource, "utf8"),
      writeFile(jsonPath, jsonSource, "utf8")
    ]);

    const indexes = await buildKwonLookupIndexes({ root: directory, sourcePaths: [pyaSourceId, jsonSourceId] });
    const paths = {
      english: join(directory, "english-index.pya"),
      pyac: join(directory, "pyac-index.pya"),
      wordnet: join(directory, "wordnet-index.pya")
    };
    await Promise.all(Object.keys(paths).map((kind) => writeIndex(paths[kind], indexes[kind])));

    const [english, pyac, wordnet, embeddedSense] = await Promise.all([
      lookupKwonIndex({ kind: "english", key: "love", indexPath: paths.english, root: directory }),
      lookupKwonIndex({ kind: "pyac", key: "pyanhmi", indexPath: paths.pyac, root: directory }),
      lookupKwonIndex({ kind: "wordnet", key: "n:07558676-n", indexPath: paths.wordnet, root: directory }),
      lookupKwonIndex({ kind: "wordnet", key: "v:01779085-v", indexPath: paths.wordnet, root: directory })
    ]);
    assert.ok(english.some((row) => row.sourceId === pyaSourceId && row.recordId === "sense-lemma:n:07558676-n:1"));
    assert.ok(english.some((row) => row.sourceId === jsonSourceId && row.inline?.pya === "pyan"));
    assert.ok(pyac.some((row) => row.recordId === "n:07558676-n"));
    assert.ok(wordnet.some((row) => row.recordId === "n:07558676-n"));
    assert.equal(typeof wordnet.find((row) => row.recordId === "n:07558676-n")?.byteOffset, "number");
    assert.equal(embeddedSense.length, 1);
    assert.equal(embeddedSense[0].recordId, "decision:fixture-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("opaque compound gloss rows index their embedded sense id and load as a subset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-gloss-sense-index-"));
  try {
    const sourceId = "program/library/translation/english_wordnet_compound_glosses.pya";
    const selected = {
      senseId: "n:07558676-n",
      target: "love compound",
      partOfSpeech: "n",
      lemmas: ["love compound"],
      definition: "a selected compound sense",
      pyashSequence: ["pyan", "hmi"],
      decisionId: "decision-selected"
    };
    const unrelated = {
      ...selected,
      senseId: "v:01779085-v",
      target: "another compound",
      definition: "an unrelated compound sense",
      decisionId: "decision-unrelated"
    };
    const source = renderEnglishWordNetCompoundGlosses([selected, unrelated]);
    const sourcePath = join(directory, sourceId);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source, "utf8");

    const indexes = await buildKwonLookupIndexes({ root: directory, sourcePaths: [sourceId] });
    const indexPath = join(directory, "wordnet-index.pya");
    await writeIndex(indexPath, indexes.wordnet);
    const postings = await lookupKwonIndex({
      kind: "wordnet",
      key: selected.senseId,
      indexPath,
      root: directory
    });
    assert.equal(postings.length, 1);
    assert.equal(postings[0].recordId, selected.decisionId);

    const glosses = await loadEnglishWordNetCompoundGlosses({
      senseIds: [selected.senseId],
      indexPaths: { wordnet: indexPath },
      indexRoot: directory
    });
    assert.deepEqual(glosses.records, [selected]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Open English WordNet sense ids stay on the stored index snapshot while the source grows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-open-wordnet-"));
  try {
    const configSourceId = "program/library/translation/english_wordnet.pya";
    const sourceDirectory = "know/wordnet/open-english-wordnet-2025-json";
    const sourceName = "noun.fixture.json";
    const sourceId = `${sourceDirectory}/${sourceName}`;
    const senseId = "n:07558676-n";
    const source = `${JSON.stringify({
      "07558676-n": {
        definition: ["a strong positive emotion"],
        members: ["love", "affection"],
        partOfSpeech: "n"
      }
    }, null, 2)}\n`;
    const corpusHash = sha256(Buffer.from(`${sourceName}\u0000${source}`));
    const configSource = [
      "su name translation_english_wordnet be map def",
      'su text "format" ob text "open-english-wordnet-2025-json-v1" ya',
      `su text "source" ob text ${JSON.stringify(sourceDirectory)} ya`,
      `su text "source-hash" ob text ${JSON.stringify(corpusHash)} ya`,
      "prah",
      ""
    ].join("\n");
    const configPath = join(directory, configSourceId);
    const sourcePath = join(directory, sourceId);
    await mkdir(dirname(configPath), { recursive: true });
    await mkdir(dirname(sourcePath), { recursive: true });
    await Promise.all([
      writeFile(configPath, configSource, "utf8"),
      writeFile(sourcePath, source, "utf8")
    ]);

    const indexes = await buildKwonLookupIndexes({ root: directory, sourcePaths: [configSourceId] });
    const indexPath = join(directory, "open-wordnet-index.pya");
    await writeIndex(indexPath, indexes["open-wordnet"]);
    const rows = await loadOpenEnglishWordNetSenseRows({
      senseIds: [senseId],
      indexPath,
      root: directory
    });
    assert.deepEqual(rows.map((row) => row.lemma).sort(), ["affection", "love"]);
    assert.equal(rows[0].gloss, "a strong positive emotion");

    const appendedSource = source.replace(
      /\n\}\n$/u,
      ',\n  "07558677-n": {\n    "definition": ["an additional emotion"],\n    "members": ["fondness"],\n    "partOfSpeech": "n"\n  }\n}\n'
    );
    await writeFile(sourcePath, appendedSource, "utf8");
    clearKwonLookupIndexValidationCache();
    const warnings = [];
    const indexed = await lookupKwonIndex({
      kind: "open-wordnet",
      key: senseId,
      indexPath,
      root: directory,
      onWarning: (warning) => warnings.push(warning)
    });
    assert.equal(indexed.length, 1);
    assert.equal(warnings.length, 0);
    assert.deepEqual(await lookupKwonIndex({
      kind: "open-wordnet",
      key: "n:07558677-n",
      indexPath,
      root: directory
    }), []);
    const rowsAfterAppend = await loadOpenEnglishWordNetSenseRows({ senseIds: [senseId], indexPath, root: directory });
    assert.equal(rowsAfterAppend[0].gloss, "a strong positive emotion");
  } finally {
    clearKwonLookupIndexValidationCache();
    await rm(directory, { recursive: true, force: true });
  }
});

test("indexed vocab queries use the stored snapshot without scanning changed catalogs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-query-"));
  clearKwonLookupIndexValidationCache();
  try {
    const sourceId = "caterer/pyac/lyac/kwon_en.json";
    const sourcePath = join(directory, sourceId);
    const blacklistSourceId = "caterer/pyac/lyac/dictionary_en.json";
    const blacklistSourcePath = join(directory, blacklistSourceId);
    const sourceEntries = [
      { pya: "pyan", en: "love" },
      { pya: "pyanpu", en: "loved" },
      { pya: "plak", en: "accordions" }
    ];
    const source = JSON.stringify(sourceEntries);
    const blacklistSource = JSON.stringify({ en: { blacklist: { Xaccord: ["treaty", "coincidence"] } } });
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source, "utf8");
    await mkdir(dirname(blacklistSourcePath), { recursive: true });
    await writeFile(blacklistSourcePath, blacklistSource, "utf8");
    const sourceHashes = {
      [sourceId]: sha256(Buffer.from(source)),
      [blacklistSourceId]: sha256(Buffer.from(blacklistSource))
    };
    const indexPaths = {
      english: join(directory, "english.pya"),
      pyac: join(directory, "pyac.pya"),
      wordnet: join(directory, "wordnet.pya")
    };
    const english = createKwonLookupIndexForTest({
      kind: "english",
      sourceHashes,
      entries: [
        ["accord", [{ sourceId: "caterer/pyac/lyac/dictionary_en.json", inline: { blacklist: ["treaty", "coincidence"] } }]],
        ["accordions", [{ sourceId, rowIndex: 4, inline: { pya: "plak", en: "accordions" } }]],
        ["love", [{ sourceId, rowIndex: 0, inline: { pya: "pyan", en: "love" } }]],
        ["loved", [{ sourceId, rowIndex: 1, inline: { pya: "pyanpu", en: "loved" } }]]
      ]
    });
    const pyac = createKwonLookupIndexForTest({
      kind: "pyac",
      sourceHashes,
      entries: [["pyan", [{ sourceId, rowIndex: 0, inline: { pya: "pyan", en: "love" } }]]]
    });
    const wordnet = createKwonLookupIndexForTest({ kind: "wordnet", sourceHashes, entries: [] });
    await Promise.all([
      writeFile(indexPaths.english, renderKwonLookupIndexPya(english), "utf8"),
      writeFile(indexPaths.pyac, renderKwonLookupIndexPya(pyac), "utf8"),
      writeFile(indexPaths.wordnet, renderKwonLookupIndexPya(wordnet), "utf8")
    ]);

    await writeFile(sourcePath, JSON.stringify([...sourceEntries, { pya: "nyat", en: "freshword" }]), "utf8");
    const warnings = [];
    assert.deepEqual(await queryVocabLines("accord", {
      indexPaths,
      root: directory,
      onWarning: (warning) => warnings.push(warning)
    }), [
      JSON.stringify(["treaty", "coincidence"])
    ]);
    assert.deepEqual(await queryVocabLines("love", { indexPaths, root: directory }), ["pyan en love"]);
    assert.deepEqual(await queryVocabLines("freshword", { indexPaths, root: directory }), []);
    assert.equal(warnings.length, 0);
    const endWarnings = takeKwonLookupWarnings();
    assert.equal(endWarnings.length, 0);
    assert.deepEqual(await queryVocabLines("lov", { indexPaths, root: directory }), [
      "pyan en love",
      "pyanpu en loved"
    ]);
    assert.deepEqual(await queryVocabLines("pyan", { indexPaths, root: directory }), ["pyan en love"]);

    await writeFile(sourcePath, "{", "utf8");
    clearKwonLookupIndexValidationCache();
    const fallbackWarnings = [];
    assert.deepEqual(await queryVocabLines("love", {
      indexPaths,
      root: directory,
      onWarning: (warning) => fallbackWarnings.push(warning)
    }), ["pyan en love"]);
    assert.equal(fallbackWarnings.length, 0);
    const fallbackEndWarnings = takeKwonLookupWarnings();
    assert.equal(fallbackEndWarnings.length, 0);
  } finally {
    clearKwonLookupIndexValidationCache();
    await rm(directory, { recursive: true, force: true });
  }
});

test("indexed WordNet lookups read only bridge and compound-gloss records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-wordnet-"));
  try {
    const senseId = "n:07558676-n";
    const bridgeSourceId = "program/library/translation/english_wordnet_bridges.pya";
    const glossSourceId = "program/library/translation/english_wordnet_compound_glosses.pya";
    const bridgeLines = [
      "su name translation_english_wordnet_bridges be map def",
      'su text "format" ob text "english-wordnet-bridge-v1" ya',
      'su text "source" ob text "Open English WordNet fixture" ya',
      'su text "source-hash" ob text "fixture-hash" ya',
      'su text "mode" ob text "sense-level semantic bridge" ya',
      `su text "${senseId}" ob name "love" as text "n" with text "deterministic" via text "fixture anchor" ya`,
      `su text "sense-gloss:${senseId}" ob text "a strong positive emotion" ya`,
      `su text "sense-lemma:${senseId}:1" ob text "love" ya`,
      "prah",
      ""
    ];
    const bridgeSource = bridgeLines.join("\n");
    const bridgePath = join(directory, bridgeSourceId);
    await mkdir(dirname(bridgePath), { recursive: true });
    await writeFile(bridgePath, bridgeSource, "utf8");

    const glossRecord = {
      senseId,
      target: "love compound",
      partOfSpeech: "n",
      lemmas: ["love compound"],
      definition: "a test compound meaning",
      pyashSequence: ["pyan", "hmi"],
      decisionId: "fixture-decision"
    };
    const glossKey = `${senseId} | ${glossRecord.target} | ${glossRecord.definition}`;
    const glossSource = [
      "su name translation_wordnet_compound_sense_glosses be map def",
      'su text "format" ob text "english-wordnet-compound-sense-glosses-v1" ya',
      `su text ${JSON.stringify(glossKey)} ob text ${JSON.stringify(JSON.stringify(glossRecord))} ya`,
      "prah",
      ""
    ].join("\n");
    const glossPath = join(directory, glossSourceId);
    await mkdir(dirname(glossPath), { recursive: true });
    await writeFile(glossPath, glossSource, "utf8");

    const indexPaths = {
      english: join(directory, "english-index.pya"),
      pyac: join(directory, "pyac-index.pya"),
      wordnet: join(directory, "wordnet-index.pya")
    };
    const bridgeHashes = { [bridgeSourceId]: sha256(Buffer.from(bridgeSource)) };
    const glossHashes = { [glossSourceId]: sha256(Buffer.from(glossSource)) };
    await Promise.all([
      writeIndex(indexPaths.english, createKwonLookupIndexForTest({
        kind: "english",
        sourceHashes: bridgeHashes,
        entries: [["love", [locator(bridgeSourceId, bridgeSource, 5, senseId), locator(bridgeSourceId, bridgeSource, 7, `sense-lemma:${senseId}:1`)]]]
      })),
      writeIndex(indexPaths.pyac, createKwonLookupIndexForTest({ kind: "pyac", entries: [] })),
      writeIndex(indexPaths.wordnet, createKwonLookupIndexForTest({
        kind: "wordnet",
        sourceHashes: { ...bridgeHashes, ...glossHashes },
        entries: [[senseId, [
          locator(bridgeSourceId, bridgeSource, 5, senseId),
          locator(bridgeSourceId, bridgeSource, 6, `sense-gloss:${senseId}`),
          locator(bridgeSourceId, bridgeSource, 7, `sense-lemma:${senseId}:1`),
          locator(glossSourceId, glossSource, 2, glossKey)
        ]]]
      }))
    ]);

    const bridge = await loadEnglishWordNetBridgeSubset({
      terms: ["love"],
      configUrl: ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
      indexPaths,
      indexRoot: directory,
      resolveTarget: async () => ({ coverageType: "atomic", pyashSequence: ["pyan"] })
    });
    assert.equal(bridge.bySense.get(senseId)?.target, "love");
    assert.deepEqual(bridge.bySense.get(senseId)?.pyashSequence, ["pyan"]);

    const glosses = await loadEnglishWordNetCompoundGlosses({
      senseIds: [senseId],
      url: ENGLISH_WORDNET_COMPOUND_GLOSSES_URL,
      indexPaths,
      indexRoot: directory
    });
    assert.equal(glosses.records.length, 1);
    assert.equal(glosses.records[0].target, "love compound");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("indexed WordNet compound lookup matches English, Pyac, and sense keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-compound-"));
  try {
    const senseId = "n:07558676-n";
    const sourceId = "program/library/translation/compound_coverage_wordnet_verified.pya";
    const entry = {
      id: "fixture-compound",
      senseId,
      targetPartOfSpeech: "n",
      aliases: ["affection compound"],
      sourceMorphemes: ["love", "mind"],
      componentGlosses: ["love", "mind"],
      target: "love compound",
      pyashSequence: ["pyan", "hmi"],
      componentLayers: [16, 16],
      maxLayer: 16,
      provenance: "fixture",
      confidence: "fixture",
      status: "accepted-llm"
    };
    const source = renderDerivedCompoundCoveragePya([entry], { name: DERIVED_COMPOUND_CURATED_NAME });
    const sourcePath = join(directory, sourceId);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source, "utf8");
    const lineIndex = 1;
    const row = locator(sourceId, source, lineIndex, senseId);
    const sourceHashes = { [sourceId]: sha256(Buffer.from(source)) };
    const indexPaths = {
      english: join(directory, "english-index.pya"),
      pyac: join(directory, "pyac-index.pya"),
      wordnet: join(directory, "wordnet-index.pya")
    };
    await Promise.all([
      writeIndex(indexPaths.english, createKwonLookupIndexForTest({ kind: "english", sourceHashes, entries: [["love compound", [row]], ["affection compound", [row]]] })),
      writeIndex(indexPaths.pyac, createKwonLookupIndexForTest({ kind: "pyac", sourceHashes, entries: [["pyan hmi", [row]], ["pyanhmi", [row]]] })),
      writeIndex(indexPaths.wordnet, createKwonLookupIndexForTest({ kind: "wordnet", sourceHashes, entries: [[senseId, [row]]] }))
    ]);

    for (const query of [
      { target: "love compound" },
      { target: "affection compound" },
      { pyashSequence: ["pyan", "hmi"] },
      { senseId }
    ]) {
      const matches = await loadWordNetVerifiedCompoundMatches({
        ...query,
        url: WORDNET_VERIFIED_COMPOUNDS_URL,
        indexPaths,
        indexRoot: directory
      });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].senseId, senseId);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WordNet compound lookup returns no hit when an indexed snapshot locator is invalid", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-compound-stale-locator-"));
  try {
    const senseId = "n:07558676-n";
    const sourceId = "program/library/translation/compound_coverage_wordnet_verified.pya";
    const entry = {
      id: "fixture-compound",
      senseId,
      targetPartOfSpeech: "n",
      sourceMorphemes: ["love", "mind"],
      componentGlosses: ["love", "mind"],
      target: "love compound",
      pyashSequence: ["pyan", "hmi"],
      componentLayers: [16, 16],
      maxLayer: 16,
      provenance: "fixture",
      confidence: "fixture",
      status: "accepted-llm"
    };
    const source = renderDerivedCompoundCoveragePya([entry], { name: DERIVED_COMPOUND_CURATED_NAME });
    await mkdir(join(directory, "program/library/translation"), { recursive: true });
    await writeFile(join(directory, sourceId), source, "utf8");

    const indexPaths = {
      english: join(directory, "english-index.pya"),
      pyac: join(directory, "pyac-index.pya"),
      wordnet: join(directory, "wordnet-index.pya")
    };
    const sourceHashes = { [sourceId]: sha256(Buffer.from(source)) };
    await Promise.all([
      writeIndex(indexPaths.english, createKwonLookupIndexForTest({
        kind: "english",
        sourceHashes,
        entries: [["love compound", [{
          sourceId,
          byteOffset: Buffer.byteLength(source) + 64,
          lineNumber: 999,
          recordId: senseId
        }]]]
      })),
      writeIndex(indexPaths.pyac, createKwonLookupIndexForTest({ kind: "pyac", entries: [] })),
      writeIndex(indexPaths.wordnet, createKwonLookupIndexForTest({ kind: "wordnet", entries: [] }))
    ]);

    const matches = await loadWordNetVerifiedCompoundMatches({
      target: "love compound",
      url: WORDNET_VERIFIED_COMPOUNDS_URL,
      indexPaths,
      indexRoot: directory
    });
    assert.equal(matches.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kwon locator reads use UTF-8 byte offsets and return the complete source line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-offset-"));
  try {
    const sourcePath = join(directory, "records.pya");
    const first = 'su text "言語" ob text "love" ya';
    const second = 'su text "word" ob text "brain" ya';
    await writeFile(sourcePath, `${first}\n${second}\n`, "utf8");
    const offset = Buffer.byteLength(`${first}\n`, "utf8");
    const [record] = await readKwonSourceLocators([
      { sourceId: "records.pya", byteOffset: offset, lineNumber: 2, recordId: "word" }
    ], { root: directory });
    assert.equal(record.line, second);
    assert.equal(record.locator.byteOffset, offset);
    assert.equal(offset, Buffer.byteLength(first, "utf8") + 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kwon locator reads reject source paths outside the repository root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-path-"));
  try {
    await assert.rejects(
      readKwonSourceLocators([{ sourceId: "../outside.pya", byteOffset: 0 }], { root: directory }),
      (error) => error.code === "invalid-kwon-lookup-index"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kwon Pya postings skip a stale offset instead of returning another row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyash-kwon-stale-"));
  clearKwonLookupIndexValidationCache();
  try {
    const sourcePath = join(directory, "records.pya");
    const source = 'su text "n:07558676-n" ob text "love" ya\n';
    await writeFile(sourcePath, source, "utf8");
    const { wordnet: index } = await buildKwonLookupIndexes({
      root: directory,
      sourcePaths: ["records.pya"]
    });
    const indexPath = join(directory, "wordnet-index.pya");
    await writeFile(indexPath, renderKwonLookupIndexPya(index), "utf8");
    const currentSource = [
      'su text "n:10000000-n" ob text "preexisting addition" ya',
      source.trimEnd(),
      'su text "n:07558677-n" ob text "fondness" ya',
      ""
    ].join("\n");
    await writeFile(sourcePath, currentSource, "utf8");

    const warnings = [];
    const matches = await lookupKwonIndex({
      kind: "wordnet",
      key: "n:07558676-n",
      indexPath,
      root: directory,
      onWarning: (warning) => warnings.push(warning)
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].recordId, "n:07558676-n");
    const [record] = await readKwonSourceLocators(matches, { root: directory });
    assert.equal(record, undefined);
    const added = await lookupKwonIndex({
      kind: "wordnet",
      key: "n:07558677-n",
      indexPath,
      root: directory
    });
    assert.equal(added.length, 0);
    assert.equal(warnings.length, 0);
    assert.equal(takeKwonLookupWarnings().length, 0);
  } finally {
    clearKwonLookupIndexValidationCache();
    await rm(directory, { recursive: true, force: true });
  }
});
