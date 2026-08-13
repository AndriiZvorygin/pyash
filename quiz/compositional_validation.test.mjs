import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSITIONAL_AXIS_ORDER,
  COMPOSITIONAL_CONTEXT_ORDER,
  compositionalByHnuc,
  compositionalGrid
} from "../program/library/compositionalCases.mjs";
import {
  formatCompositionalValidationReport,
  validateCompositionalCases
} from "../program/library/compositional_case_validation.mjs";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";
import { parse } from "../program/understand/index.mjs";
import { verifyHnucGrammar } from "../program/verbs/verify_hnuc_grammar.mjs";

const KEYWORD_TABLE = {
  space: { source: "from", way: "at", destination: "to" },
  interior: { source: "outof", way: "in", destination: "into" },
  surface: { source: "offof", way: "on", destination: "onto" },
  under: { source: "fromunder", way: "under", destination: "beneath" },
  time: { source: "since", way: "during", destination: "until" },
  state: { source: "fromstate", way: "as", destination: "become" },
  person: { source: "fromperson", way: "with", destination: "for" },
  social: { source: "fromgroup", way: "among", destination: "intogroup" },
  discourse: { source: "fromtext", way: "accordingto", destination: "totext" },
  quantity: { source: "times", way: "by", destination: "per" },
  limit: { source: "atleast", way: "exactly", destination: "atmost" },
  sequence: { source: "fromindex", way: "atindex", destination: "toindex" }
};

const AXIS_SURFACE_WORD = { source: "from", way: "via", destination: "to" };

function cloneGrid() {
  return structuredClone(compositionalGrid);
}

function issueCodes(result) {
  return result.errors.map(issue => issue.code);
}

test("canonical grid pins all 12 contexts, 3 axes, and 36 keywords", () => {
  assert.deepEqual(COMPOSITIONAL_CONTEXT_ORDER, [
    "space", "interior", "surface", "under", "time", "state",
    "person", "social", "discourse", "quantity", "limit", "sequence"
  ]);
  assert.deepEqual(COMPOSITIONAL_AXIS_ORDER, ["source", "way", "destination"]);

  for (const context of COMPOSITIONAL_CONTEXT_ORDER) {
    assert.deepEqual(
      Object.fromEntries(COMPOSITIONAL_AXIS_ORDER.map(axis => [axis, compositionalGrid[context][axis].keyword])),
      KEYWORD_TABLE[context]
    );
  }
});

test("every grid cell parses from/via/to context and derives its canonical num signature", () => {
  for (const context of COMPOSITIONAL_CONTEXT_ORDER) {
    for (const axis of COMPOSITIONAL_AXIS_ORDER) {
      const sentence = parse(
        `su name item ${AXIS_SURFACE_WORD[axis]} ${context} num 7 be number ya`
      );
      const keyword = KEYWORD_TABLE[context][axis];
      assert.deepEqual(sentence[keyword], { num: 7 }, `${context}.${axis}`);
      const signature = deriveSignatureFromCall(sentence);
      const keywordIndex = signature.indexOf(keyword);
      assert.equal(signature[keywordIndex + 1], "num", `${context}.${axis} signature`);
    }
  }
});

test("canonical validation succeeds with deterministic warnings for known unassigned identities", () => {
  const result = validateCompositionalCases();

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.contexts, 12);
  assert.equal(result.summary.mappings, 36);
  assert.equal(result.summary.assignedCodes, 37);
  assert.equal(result.summary.knownUnassigned, 11);
  assert.deepEqual(
    result.warnings.map(issue => issue.path),
    [
      "quantity.context",
      "quantity.way",
      "quantity.destination",
      "limit.context",
      "limit.source",
      "limit.way",
      "limit.destination",
      "sequence.context",
      "sequence.source",
      "sequence.way",
      "sequence.destination"
    ]
  );
  assert.match(
    formatCompositionalValidationReport(result),
    /WARNING UNASSIGNED_HNUC quantity\.way:.*not allocated/u
  );
});

test("verify hnuc grammar is a zero-argument vocabulary-valid built-in", () => {
  const sentence = parse("be verify hnuc grammar do");
  assert.deepEqual(deriveSignatureFromCall(sentence), ["be", "verify hnuc grammar"]);
  const result = verifyHnucGrammar(sentence);
  assert.match(result.ob.text, /^hnuc grammar verified: contexts=12 mappings=36 assigned codes=37 known unassigned codes=11 warnings=11/mu);
});

test("validation catches missing context and missing axis", () => {
  const grid = cloneGrid();
  delete grid.social;
  delete grid.person.destination;

  const result = validateCompositionalCases({ grid });

  assert.ok(issueCodes(result).includes("MISSING_CONTEXT"));
  assert.ok(issueCodes(result).includes("MISSING_AXIS"));
  assert.match(formatCompositionalValidationReport(result), /ERROR MISSING_CONTEXT social\.context:/u);
  assert.match(formatCompositionalValidationReport(result), /ERROR MISSING_AXIS person\.destination:/u);
});

test("validation rejects non-canonical context and axis shape", () => {
  const grid = cloneGrid();
  grid.extra = {};
  grid.space.instrument = {};
  const result = validateCompositionalCases({ grid });

  assert.ok(issueCodes(result).includes("UNEXPECTED_CONTEXT"));
  assert.ok(issueCodes(result).includes("UNEXPECTED_AXIS"));
});

test("validation catches a missing context identity", () => {
  const grid = cloneGrid();
  delete grid.space.context;
  const result = validateCompositionalCases({ grid });

  assert.ok(issueCodes(result).includes("MISSING_CONTEXT"));
  assert.match(formatCompositionalValidationReport(result), /ERROR MISSING_CONTEXT space\.context: context identity is missing/u);
});

test("validation catches wrong axis, duplicate and empty keywords", () => {
  const grid = cloneGrid();
  grid.space.source.axis = "way";
  grid.space.way.keyword = "from";
  grid.space.destination.keyword = "";

  const result = validateCompositionalCases({ grid });

  assert.ok(issueCodes(result).includes("AXIS_MISMATCH"));
  assert.ok(issueCodes(result).includes("DUPLICATE_KEYWORD"));
  assert.ok(issueCodes(result).includes("EMPTY_KEYWORD"));
});

test("validation catches malformed, zero, absent, and lexicon-mismatched HNUCs", () => {
  const malformed = cloneGrid();
  malformed.space.source.hnuc = "0x123";
  assert.ok(issueCodes(validateCompositionalCases({ grid: malformed })).includes("MALFORMED_HNUC"));

  const zero = cloneGrid();
  zero.space.source.hnuc = "0x0000";
  assert.ok(issueCodes(validateCompositionalCases({ grid: zero })).includes("UNASSIGNED_HNUC"));

  const absent = cloneGrid();
  absent.space.source.case = "missing_case_";
  absent.space.source.hnuc = "0x1234";
  absent.space.source.pya = "missing";
  assert.ok(issueCodes(validateCompositionalCases({ grid: absent })).includes("LEXEME_MISSING"));

  const mismatch = cloneGrid();
  mismatch.space.source.pya = "wrong";
  assert.ok(issueCodes(validateCompositionalCases({ grid: mismatch })).includes("LEXICON_MISMATCH"));
});

test("defective grammar surfaces a sentence-shaped operator error", () => {
  const grid = cloneGrid();
  grid.space.source.hnuc = "0x123";

  assert.throws(
    () => verifyHnucGrammar({}, { grid }),
    error => {
      assert.equal(error.sentence.su.name, "hnuc grammar defective");
      assert.match(error.message, /ERROR MALFORMED_HNUC space\.source:/u);
      return true;
    }
  );
});

test("shared HNUCs are accepted only for the same lexicon morpheme", () => {
  const accepted = validateCompositionalCases();
  assert.equal(accepted.errors.some(issue => issue.code === "HNUC_REUSE_CONFLICT"), false);
  assert.deepEqual(
    compositionalByHnuc["0x313e"].map(mapping => `${mapping.context}.${mapping.axis}`),
    ["space.source", "person.source", "social.source", "discourse.source"]
  );

  const grid = cloneGrid();
  grid.person.source.hnuc = grid.space.source.hnuc;
  grid.person.source.case = "way_case_";
  grid.person.source.pya = "ga";
  const rejected = validateCompositionalCases({ grid });
  assert.ok(issueCodes(rejected).includes("HNUC_REUSE_CONFLICT"));
});

test("malformed injected grid has stable operator-readable ordering", () => {
  const grid = cloneGrid();
  delete grid.space.way;
  grid.space.source.keyword = "bad keyword";
  grid.space.source.axis = "wrong";

  const result = validateCompositionalCases({ grid });
  const lines = formatCompositionalValidationReport(result).split("\n");

  assert.deepEqual(lines.slice(0, 3), [
    "ERROR AXIS_MISMATCH space.source: axis must be source, got wrong",
    "ERROR INVALID_KEYWORD space.source: keyword must be one lowercase Pyash token, got bad keyword",
    "ERROR MISSING_AXIS space.way: grid axis is missing"
  ]);
  assert.match(lines.at(-1), /^SUMMARY /u);
});
