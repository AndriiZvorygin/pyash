import test from "node:test";
import assert from "node:assert/strict";

import { resolveEnglishAlias } from "../program/verbs/exchange/translation/english_aliases.mjs";

test("translation anchor words map schedule vocabulary to calendar anchor", () => {
  assert.equal(resolveEnglishAlias("schedule"), "calendar");
  assert.equal(resolveEnglishAlias("scheduler"), "calendar");
  assert.equal(resolveEnglishAlias("calendar"), "calendar");
});

