import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import { CURATED_COMPOUND_CATALOG_NAME } from "../program/library/translation/curated_compound_catalog.mjs";
import { reviewVocabularyEntry } from "../program/library/translation/vocabulary_entry_review.mjs";
import { parseEnglishWordNetBridgeCatalog, renderEnglishWordNetBridgeCatalog } from "../program/library/translation/english_wordnet_bridges.mjs";

const senseId = "n:00000001-n";
const gloss = "a symbol that establishes the identity of the one bearing it";

function reviewInput() {
  return [
    "su name vocabulary entry review be map def",
    'su text "target" ob text "identifier" ya',
    `su text "gloss" ob text ${JSON.stringify(gloss)} ya`,
    'su text "pyash" ob text "hdif tyec" ya',
    `su text "sense-id" ob text ${JSON.stringify(senseId)} ya`,
    'su text "model-status" ob text "accepted-llm" ya',
    'su text "review-status" ob text "accepted-curated" ya',
    'su text "evidence" ob text "Identity + tag, in head-final order." ya',
    "prah",
    ""
  ].join("\n");
}

async function runReview(initialBridgeEntries) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vocabulary-entry-review-"));
  const reviewCatalogUrl = path.join(directory, "reviews.pya");
  const compoundCatalogUrl = path.join(directory, "compounds.pya");
  const bridgeCatalogUrl = path.join(directory, "bridges.pya");

  try {
    await fs.writeFile(compoundCatalogUrl, `su name ${CURATED_COMPOUND_CATALOG_NAME} be map def\nprah\n`, "utf8");
    await fs.writeFile(bridgeCatalogUrl, renderEnglishWordNetBridgeCatalog({
      source: "vocabulary entry review test",
      entries: initialBridgeEntries
    }), "utf8");

    const result = await reviewVocabularyEntry(reviewInput(), {
      reviewCatalogUrl,
      compoundCatalogUrl,
      bridgeCatalogUrl
    });
    const bridgeSource = await fs.readFile(bridgeCatalogUrl, "utf8");
    const compoundSource = await fs.readFile(compoundCatalogUrl, "utf8");
    return {
      result,
      bridge: parseEnglishWordNetBridgeCatalog(bridgeSource).entries.find((entry) => entry.source === senseId),
      compounds: parseCompoundLexicon(compoundSource, {
        name: CURATED_COMPOUND_CATALOG_NAME,
        language: "canonical"
      })
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("accepted vocabulary review writes WordNet gloss and lemma metadata with a new bridge", async () => {
  const { result, bridge, compounds } = await runReview([]);

  assert.equal(result.linkStatus, "linked");
  assert.equal(bridge.gloss, gloss);
  assert.deepEqual(bridge.lemmas, ["identifier"]);
  assert.deepEqual(compounds.find((entry) => entry.surface === "identifier")?.pyashSequence, ["hdif", "tyec"]);
});

test("accepted vocabulary review fills missing WordNet metadata on an existing bridge", async () => {
  const { result, bridge } = await runReview([{
    source: senseId,
    target: "identifier",
    targetPartOfSpeech: "n",
    certainty: "contextual",
    evidence: "existing bridge"
  }]);

  assert.equal(result.linkStatus, "metadata-completed");
  assert.equal(bridge.gloss, gloss);
  assert.deepEqual(bridge.lemmas, ["identifier"]);
});

test("the review catalog that ships in the tree passes its own validator", async () => {
  // The build tolerates a malformed catalog, so a file the writer cannot open
  // still reaches the volume. 12 rows once carried a review status in the
  // modelStatus slot for that reason: no test parsed the shipped file.
  const { parseReviewCatalog, VOCABULARY_ENTRY_REVIEW_URL } =
    await import("../program/library/translation/vocabulary_entry_review.mjs");
  const source = await fs.readFile(VOCABULARY_ENTRY_REVIEW_URL, "utf8");
  const rows = parseReviewCatalog(source);
  assert.ok(rows.length > 0, "the shipped catalog has rows");
  for (const row of rows) {
    assert.ok(
      row.modelStatus === undefined || !["accepted-curated", "review-needed"].includes(row.modelStatus),
      `${row.reviewId} puts a review status in the modelStatus slot`
    );
  }
});
