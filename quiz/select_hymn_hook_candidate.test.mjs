import test from "node:test";
import assert from "node:assert/strict";

import { selectBestHymnHookCandidate } from "../command/select_hymn_hook_candidate.mjs";

test("select hymn hook candidate keeps the first usable refrain line", () => {
  const input = [
    "We are those of Q'uo",
    "Aware of your query",
    "Everything is new now",
    "A worthwhile dream"
  ].join("\n");
  assert.equal(selectBestHymnHookCandidate(input), "Everything is new now");
});

test("select hymn hook candidate returns NONE when all lines are rejected", () => {
  const input = [
    "We are those of Q'uo",
    "Aware of your query",
    "It is indeed",
    "A worthwhile dream"
  ].join("\n");
  assert.equal(selectBestHymnHookCandidate(input), "NONE");
});
