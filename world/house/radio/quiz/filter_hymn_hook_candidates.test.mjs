import test from "node:test";
import assert from "node:assert/strict";

import { filterHymnHookCandidates } from "../command/filter_hymn_hook_candidates.mjs";

test("filter hymn hook candidates keeps only strict short declarative hooks", () => {
  const input = [
    "We offer self with joy",
    "You blossom every day",
    "Shadow shows in strong light",
    "Nothing separates from truth",
    "# bad formatting",
    "speaker note line"
  ].join("\n");

  assert.equal(
    filterHymnHookCandidates(input),
    [
      "We offer self with joy",
      "You blossom every day",
      "Shadow shows in strong light",
      "Nothing separates from truth"
    ].join("\n")
  );
});

test("filter hymn hook candidates returns NONE when all lines fail", () => {
  const input = [
    "too short",
    "# heading junk",
    "speaker note line"
  ].join("\n");

  assert.equal(filterHymnHookCandidates(input), "NONE");
});
