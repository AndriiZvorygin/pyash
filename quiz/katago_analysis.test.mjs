import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKataGoJobSpec,
  buildKataGoQuery,
  extractSgfText,
  normalizeKataGoResult,
  parseSgfMoves,
  summarizeKataGoResult
} from "../program/katago/analysis.mjs";

test("katago extracts SGF from fenced text and builds analysis query", () => {
  const sgf = extractSgfText({ messages: [{ role: "user", content: "```sgf\n(;GM[1]SZ[19];B[pd];W[dd])\n```" }] });
  assert.equal(sgf, "(;GM[1]SZ[19];B[pd];W[dd])");
  assert.deepEqual(parseSgfMoves(sgf), [["B", "pd"], ["W", "dd"]]);

  const query = buildKataGoQuery({ sgf, maxVisits: 12, komi: 6.5 });
  assert.equal(query.maxVisits, 12);
  assert.equal(query.komi, 6.5);
  assert.deepEqual(query.moves, [["B", "Q16"], ["W", "D16"]]);
  assert.deepEqual(query.analyzeTurns, [2]);
});

test("katago job spec rejects non SGF text", () => {
  assert.throws(() => buildKataGoJobSpec({ prompt: "please teach go" }), /requires SGF text/u);
});

test("katago result summary includes best move and structured candidates", () => {
  const raw = {
    id: "case-one",
    turnNumber: 4,
    moveInfos: [
      { move: "Q16", visits: 50, winrate: 0.62, scoreLead: 3.4, prior: 0.2, pv: ["Q16", "D4"] },
      { move: "D4", visits: 20, winrate: 0.55, scoreLead: 1.1 }
    ]
  };
  const normalized = normalizeKataGoResult(raw);
  assert.equal(normalized.bestMove, "Q16");
  assert.equal(normalized.candidates.length, 2);
  assert.match(summarizeKataGoResult(raw), /KataGo likes Q16/u);
  assert.match(summarizeKataGoResult(raw), /winrate 62\.0%/u);
});
