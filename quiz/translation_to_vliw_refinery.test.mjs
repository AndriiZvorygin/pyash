import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";
import { getRefinery } from "../program/bridge/refinery.mjs";
import {
  TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
  runTranslationSourceToVliwRefinery
} from "../program/verbs/exchange/translation/translation_to_vliw_refinery.mjs";

test("source-to-VLIW refinery declares the complete Pyash stage graph", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const stages = [];

  await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    onEvoke: (sentence) => stages.push(sentence.su?.name),
    checkpointEnabled: false
  });

  const refinery = getRefinery(TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME);
  assert.ok(refinery);
  assert.deepEqual(refinery.order, [
    "read source",
    "segment source",
    "translate sentences",
    "refine senses",
    "review vocabulary",
    "refine compounds",
    "render translation",
    "lower vliw",
    "write outputs"
  ]);
  assert.deepEqual(refinery.platforms.get("translate sentences")?.deps, [
    "read source",
    "segment source"
  ]);
  assert.deepEqual(refinery.platforms.get("write outputs")?.deps, [
    "lower vliw",
    "render translation"
  ]);
  assert.deepEqual(stages, refinery.order);
});

test("source-to-VLIW refinery writes the translation catalog and executable pack", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-output-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };

  const output = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    checkpointEnabled: false
  });

  assert.equal(output.result.records, 2);
  assert.equal(output.result.executable, 1);
  assert.equal(output.result.unsupported, 1);
  assert.equal(readFileSync(paths.translation, "utf8").includes("translation-pipeline-v1"), true);
  assert.equal(parseVliwCatalogPya(readFileSync(paths.catalog, "utf8")).catalog.records.length, 2);
  assert.equal(readFileSync(paths.pack).length > 32, true);
});

test("source-to-VLIW refinery replays its durable map checkpoints", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-replay-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const checkpoints = [];
  const first = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    onCheckpoint: (sentence) => checkpoints.push(sentence)
  });
  const checkpointIndex = new Map([
    [
      TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
      new Map(checkpoints.map((sentence) => {
        const payload = JSON.parse(sentence.fromtext.text);
        return [sentence.su.name, {
          hash: sentence.ob.text,
          resultSentence: sentence.to.la,
          resultLine: sentence.totext.text,
          exportFacts: payload.exports,
          scopeSlots: payload.scope
        }];
      }))
    ]
  ]);

  const second = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    checkpointIndex
  });

  assert.equal(checkpoints.length, 9);
  assert.deepEqual(second.result, first.result);
  assert.equal(second.database.catalog.packHash, first.database.catalog.packHash);
});
