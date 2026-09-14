import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUnambiguousSpokenNumbers,
  unsupportedNumericTokens,
} from "../program/library/reporter_shared/grounded-numeric-fidelity.mjs";

test("numeric grounding rejects invented and split numeric tokens", () => {
  assert.deepEqual(
    unsupportedNumericTokens("34 beds for 58 people over 300 65 nights", "24 beds over 365 nights"),
    ["34", "58", "300", "65"],
  );
  assert.deepEqual(unsupportedNumericTokens("$69.4 million and 24 beds", "$69.4 million and 24 beds"), []);
});

test("numeric grounding treats cardinal and ordinal forms of the same date as equivalent", () => {
  assert.deepEqual(
    unsupportedNumericTokens("Council meets on July 27, 2026.", "the 27th day of July, 2026"),
    [],
  );
});

test("numeric grounding recognizes Arabic values supported by spoken number words", () => {
  assert.deepEqual(
    unsupportedNumericTokens(
      "The public forum discussed 2nd Avenue and 9th Street with a group of 18 children.",
      "The public forum discussed Second Avenue and Ninth Street with a group of eighteen children.",
    ),
    [],
  );
  assert.deepEqual(
    unsupportedNumericTokens(
      "The pilot uses a 45-minute schedule and the study is budgeted in 2028.",
      "The pilot uses a forty-five minute schedule and the study is budgeted in two thousand and twenty-eight.",
    ),
    [],
  );
  assert.deepEqual(
    unsupportedNumericTokens("The public forum discussed 3rd Avenue.", "Second Avenue was discussed."),
    ["3rd"],
  );
});

test("numeric grounding recognizes spoken years and normalizes unambiguous notation", () => {
  assert.deepEqual(
    unsupportedNumericTokens(
      "The special meeting considered the 2026 budget with 26 recommendations.",
      "The special meeting considered the twenty twenty-six budget with twenty-six recommendations.",
    ),
    [],
  );
  assert.equal(
    normalizeUnambiguousSpokenNumbers("The twenty twenty-six budget listed twenty-six recommendations."),
    "The 2026 budget listed 26 recommendations.",
  );
  assert.equal(
    normalizeUnambiguousSpokenNumbers("Council returned at nine seventeen."),
    "Council returned at nine seventeen.",
  );
});

test("numeric grounding recognizes statutes spoken digit by digit", () => {
  assert.deepEqual(
    unsupportedNumericTokens(
      "Council moved into closed session under section 239 of the Municipal Act, 2001.",
      "Council moved into closed session under section two three nine of the Municipal Act, two thousand one.",
    ),
    [],
  );
  assert.deepEqual(
    unsupportedNumericTokens(
      "Council cited section 238.",
      "Council cited section two three nine.",
    ),
    ["238"],
  );
  assert.deepEqual(
    unsupportedNumericTokens(
      "The declaration concerned By-law 2026-098.",
      "The declaration concerned by-law twenty twenty six zero nine eight.",
    ),
    [],
  );
});
