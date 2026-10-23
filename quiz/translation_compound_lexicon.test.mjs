import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalCompoundPayload,
  loadChineseCompoundLexicon,
  parseChineseCompoundLexicon,
  queryChineseCompoundLexicon
} from "../program/verbs/exchange/translation/compound_lexicon.mjs";

test("Chinese compound lexicon preserves ordered morphemes and stable identities", async () => {
  const entries = await loadChineseCompoundLexicon();
  const database = entries.find((entry) => entry.surface === "数据库");

  assert.ok(database);
  assert.deepEqual(database.morphemes, ["数据", "库"]);
  assert.equal(database.target, "database");
  assert.equal(database.status, "unlowered");
  assert.match(database.id, /^compound-[0-9a-f]{24}$/);
  assert.equal(canonicalCompoundPayload(database), canonicalCompoundPayload({
    ...database,
    id: "different-source-id"
  }));

  const byMorpheme = queryChineseCompoundLexicon(entries, { morpheme: "语" });
  assert.deepEqual(byMorpheme.map((entry) => entry.surface), ["语言"]);
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { status: "unlowered" }).map((entry) => entry.surface),
    ["数据库", "语言"]
  );
});

test("Chinese compound lexicon rejects malformed and duplicated rows", () => {
  const malformed = [
    "su name translation_compounds_chinese be map def",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数据\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parseChineseCompoundLexicon(malformed),
    (error) => error.code === "invalid-compound-lexicon" && /two ordered morphemes/u.test(error.message)
  );

  const duplicate = [
    "su name translation_compounds_chinese be map def",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数据\\\",\\\"库\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数\\\",\\\"据库\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parseChineseCompoundLexicon(duplicate),
    (error) => error.code === "invalid-compound-lexicon" && /duplicated/u.test(error.message)
  );
});
