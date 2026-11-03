import test from "node:test";
import assert from "node:assert/strict";

import {
  createSaddleTerminalUi,
  renderSaddleMarkdown,
  stripTerminalControlSequences
} from "../program/agent/coding_saddle_tui.mjs";

test("coding saddle renders common Markdown as structured terminal text", () => {
  const lines = renderSaddleMarkdown([
    "# A clear heading",
    "",
    "A **bold** point with *emphasis*, `code`, and [a link](https://example.com).",
    "",
    "- first item",
    "- second item",
    "",
    "> quoted guidance",
    "",
    "```js",
    "const answer = 42;",
    "```",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| one | two |"
  ].join("\n"), { width: 72, color: false });
  const rendered = lines.join("\n");

  assert.match(rendered, /A clear heading/u);
  assert.match(rendered, /A bold point with emphasis, code, and a link/u);
  assert.match(rendered, /\(https:\/\/example\.com\)/u);
  assert.match(rendered, /• first item/u);
  assert.match(rendered, /│ quoted guidance/u);
  assert.match(rendered, /const answer = 42;/u);
  assert.match(rendered, /Name\s+│\s+Value/u);
  assert.match(rendered, /one\s+│\s+two/u);
});

test("coding saddle Markdown styling is terminal-native and strips model control codes", () => {
  const malicious = "\u001b[2J# Safe\n\n**Bold** and `code`.";
  const lines = renderSaddleMarkdown(malicious, { width: 40, color: true });
  const rendered = lines.join("\n");

  assert.match(rendered, /\u001b\[1;36m/u);
  assert.match(rendered, /\u001b\[1mBold\u001b\[0m/u);
  assert.match(rendered, /\u001b\[36mcode\u001b\[0m/u);
  assert.doesNotMatch(rendered, /\u001b\[2J/u);
  assert.equal(stripTerminalControlSequences("\u001b[31mred\u001b[0m"), "red");
});

test("coding saddle streams one accumulated Markdown response without duplicating it", () => {
  const writes = [];
  const ui = createSaddleTerminalUi({
    output: { columns: 60, rows: 12, isTTY: true, write(value) { writes.push(String(value)); } },
    color: false
  });
  ui.enter();
  ui.writeLine("saddle>");
  const stream = ui.beginMarkdownStream();
  ui.appendMarkdownStream(stream, "**A streamed ");
  ui.appendMarkdownStream(stream, "answer**\n\n- item");
  ui.replaceMarkdownStream(stream, "**A streamed answer**\n\n- item");
  const output = writes.join("");
  assert.match(output, /A streamed answer/u);
  assert.match(output, /• item/u);
  assert.equal(ui.getState().itemCount, 2);
  ui.exit();
});

test("coding saddle keeps wrapped list items aligned under their text", () => {
  const lines = renderSaddleMarkdown("- this is a longer list item that wraps", { width: 20, color: false });
  assert.equal(lines[0], "• this is a longer ");
  assert.equal(lines[1], "  list item that ");
  assert.equal(lines[2], "  wraps");
});

test("coding saddle wraps at an exact-width word boundary without clipping its last character", () => {
  const fullWidthWord = "12345678901234567890";
  const lines = renderSaddleMarkdown(`${fullWidthWord} next`, { width: 20, color: false });
  assert.deepEqual(lines, [fullWidthWord, "next"]);
  assert.ok(lines.every((line) => line.length <= 20));
});

test("coding saddle screen keeps progress fixed, scrolls conversation, resizes, and restores terminal", () => {
  const writes = [];
  const output = {
    columns: 34,
    rows: 10,
    isTTY: true,
    write(value) { writes.push(String(value)); }
  };
  const ui = createSaddleTerminalUi({ output, color: false });
  ui.enter();
  ui.setStatus("mind: zai | model: glm-5.3-flash | state: ready");
  for (let index = 0; index < 16; index += 1) ui.writeLine(`transcript line ${index}`);
  ui.setInput({ value: "inspect files", cursor: 7 }, "pyash> ");
  ui.setUsage("turn usage · input 120 · output 24 · total 144");
  assert.equal(ui.getState().usage, "turn usage · input 120 · output 24 · total 144");
  assert.ok(writes.join("").includes("turn usage"));
  const itemCount = ui.getState().itemCount;
  ui.setActivity("working... 10s elapsed (zai / glm-5.3-flash)");
  assert.equal(ui.getState().itemCount, itemCount);
  assert.match(writes.join(""), /working\.\.\. 10s elapsed/u);
  ui.setBusy(true);
  assert.match(ui.getState().status, /state: running$/u);
  ui.setInput({ value: "queue this follow-up", cursor: 20 }, "next> ");
  assert.match(writes.join(""), /queue this follow-up/u);
  assert.match(writes.at(-1), /\u001b\[\?25h/u);
  ui.setBusy(false);

  ui.scrollBy(1);
  assert.ok(ui.getState().scrollOffset > 0);
  output.columns = 48;
  ui.draw();
  assert.ok(writes.join("").includes("PgUp"));
  assert.ok(writes.join("").includes("PgDn"));
  assert.match(writes[0], /\u001b\[\?1049h/u);

  ui.exit();
  assert.match(writes.at(-1), /\u001b\[\?25h\u001b\[\?1049l/u);
  assert.equal(ui.getState().active, false);
});

test("coding saddle can clear stale transcript before restoring another session", () => {
  const output = { columns: 40, rows: 10, isTTY: true, write() {} };
  const ui = createSaddleTerminalUi({ output, color: false });
  ui.enter();
  ui.writeLine("previous session message");
  ui.scrollBy(1);
  ui.clearHistory();
  assert.equal(ui.getState().itemCount, 0);
  assert.equal(ui.getState().scrollOffset, 0);
  ui.exit();
});
