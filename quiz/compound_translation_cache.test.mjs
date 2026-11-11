import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureCompoundTranslations,
  loadCompoundTranslationCache,
  parseCompoundTranslationResponse,
  selectCompoundDemands
} from "../program/library/translation/compound_translation_cache.mjs";

async function tempCache() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-compound-translation-"));
  return path.join(directory, "translation_compounds_lazy.pya");
}

function greenhouse() {
  return {
    target: "greenhouse",
    componentGlosses: ["green", "house"],
    pyashSequence: ["ksin", "hcas"],
    componentLayers: [16, 16],
    maxLayer: 16,
    head: "house",
    status: "accepted-curated"
  };
}

test("compound demand selection only requests accepted compounds used by the source", () => {
  const demands = selectCompoundDemands(
    "The greenhouse is near the house.",
    [
      greenhouse(),
      { ...greenhouse(), target: "unrelated compound" },
      { target: "someone", componentGlosses: ["some", "one"], pyashSequence: ["x", "y"], status: "candidate-closed" }
    ]
  );
  assert.deepEqual(demands.map((record) => record.target), ["greenhouse"]);
});

test("compound translation response recovery stays bounded and rejects malformed language rows", () => {
  const valid = parseCompoundTranslationResponse(
    "provider note\n```json\n{\"translations\":[{\"language\":\"chinese\",\"surface\":\"温室\",\"morphemes\":[\"温\",\"室\"],\"rationale\":\"lexical translation\"}]}\n```",
    { languages: ["chinese"] }
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.translations[0].surface, "温室");
  assert.equal(parseCompoundTranslationResponse("{\"translations\":[{\"language\":\"spanish\",\"surface\":\"invernadero\"}]}", { languages: ["chinese"] }).valid, false);
  assert.equal(parseCompoundTranslationResponse("not json", { languages: ["chinese"] }).valid, false);
});

test("lazy compound translation persists a miss and reuses it on the next integration", async () => {
  const cachePath = await tempCache();
  const calls = [];
  const translate = async ({ languages, requestId, phase }) => {
    calls.push({ languages, requestId, phase });
    return {
      model: "qwen3.5:9b",
      handleId: `${requestId}-${phase}`,
      text: JSON.stringify({
        translations: languages.map((language) => ({
          language,
          surface: language === "chinese" ? "温室" : "serre",
          morphemes: language === "chinese" ? ["温", "室"] : ["serre"],
          rationale: "fixture translation"
        }))
      })
    };
  };

  const first = await ensureCompoundTranslations({
    compounds: [greenhouse()],
    languages: ["chinese", "french"],
    cachePath,
    translate
  });
  assert.deepEqual(first.counts, { hits: 0, translated: 1, partial: 0, failed: 0, missingTranslator: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual(first.entries[0].sourceSurfaces, { chinese: "温室", french: "serre" });

  const second = await ensureCompoundTranslations({
    compounds: [greenhouse()],
    languages: ["chinese", "french"],
    cachePath,
    translate: async () => { throw new Error("cache miss unexpectedly invoked translator"); }
  });
  assert.deepEqual(second.counts, { hits: 1, translated: 0, partial: 0, failed: 0, missingTranslator: 0 });
  const cached = await loadCompoundTranslationCache({ cachePath });
  assert.equal(cached.length, 1);
  assert.equal(cached[0].translationStatus, "complete");
  assert.equal(cached[0].translationModel, "qwen3.5:9b");
});
