import test from "node:test";
import assert from "node:assert/strict";

import {
  splitTerminalGraphemes,
  terminalCellWidth,
  terminalGraphemeWidth,
  truncateTerminalText
} from "../program/agent/terminal_width.mjs";

test("terminal width keeps combining marks and emoji sequences in one grapheme", () => {
  assert.deepEqual(splitTerminalGraphemes("é").map(({ segment }) => segment), ["é"]);
  assert.deepEqual(
    splitTerminalGraphemes("\u{1F468}‍\u{1F469}‍\u{1F467}").map(({ segment }) => segment),
    ["\u{1F468}‍\u{1F469}‍\u{1F467}"]
  );
  assert.deepEqual(splitTerminalGraphemes("\u{1F1FA}\u{1F1F8}").map(({ segment }) => segment), ["\u{1F1FA}\u{1F1F8}"]);
});

test("terminal width reports grapheme column widths the way a terminal draws them", () => {
  assert.equal(terminalGraphemeWidth("a"), 1);
  assert.equal(terminalGraphemeWidth("安"), 2);
  assert.equal(terminalGraphemeWidth("é"), 1);
  assert.equal(terminalGraphemeWidth("\u{1F468}‍\u{1F469}‍\u{1F467}"), 2);
  assert.equal(terminalGraphemeWidth("\u{1F1FA}\u{1F1F8}"), 2);
  assert.equal(terminalCellWidth("安德里"), 6);
  assert.equal(terminalCellWidth(""), 0);
});

test("terminal width truncates on grapheme boundaries without exceeding the column limit", () => {
  assert.equal(truncateTerminalText("abc", 3), "abc");
  assert.equal(truncateTerminalText("安德里 okay", 7), "安德里…");
  assert.equal(terminalCellWidth(truncateTerminalText("安德里 okay", 7)), 7);
  assert.equal(truncateTerminalText("安德里 okay", 1), "…");
  assert.equal(truncateTerminalText("abc", 0), "");
  assert.equal(truncateTerminalText("abc", -5), "");
});
