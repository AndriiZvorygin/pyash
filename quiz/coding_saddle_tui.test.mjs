import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { renderSaddleSessionHistory } from "../command/pyash_saddle.mjs";
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

test("coding saddle keeps streamed text and tool events in chronological order", () => {
  const writes = [];
  const ui = createSaddleTerminalUi({
    output: { columns: 80, rows: 20, isTTY: true, write(value) { writes.push(String(value)); } },
    color: false
  });
  ui.enter();
  ui.writeLine("saddle>");
  const introduction = ui.beginMarkdownStream();
  ui.appendMarkdownStream(introduction, "I will inspect the file.");
  ui.writeLine("[tool call] inspect");
  ui.writeLine("[tool result] file contents");
  ui.writeLine("saddle>");
  const answer = ui.beginMarkdownStream();
  ui.appendMarkdownStream(answer, "Partial answer");
  ui.replaceMarkdownStream(answer, "Final answer after inspecting the file.");

  const lastFrame = writes.join("").slice(writes.join("").lastIndexOf("\u001b[?25l\u001b[H"));
  const introductionIndex = lastFrame.indexOf("I will inspect the file.");
  const callIndex = lastFrame.indexOf("[tool call] inspect");
  const resultIndex = lastFrame.indexOf("[tool result] file contents");
  const finalPromptIndex = lastFrame.lastIndexOf("saddle>");
  const answerIndex = lastFrame.indexOf("Final answer after inspecting the file.");
  assert.ok(introductionIndex < callIndex);
  assert.ok(callIndex < resultIndex);
  assert.ok(resultIndex < finalPromptIndex);
  assert.ok(finalPromptIndex < answerIndex);
  ui.exit();
});

test("coding saddle restores a long history with one terminal redraw", () => {
  const writes = [];
  const ui = createSaddleTerminalUi({
    output: { columns: 80, rows: 200, isTTY: true, write(value) { writes.push(String(value)); } },
    color: false
  });
  ui.enter();
  writes.length = 0;

  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `saved message ${index}`
  }));
  renderSaddleSessionHistory(ui, messages, "20261107-coding");

  assert.equal(writes.length, 1, `expected one terminal frame, got ${writes.length} writes`);
  assert.equal(ui.getState().itemCount, 122);
  const frame = writes.join("");
  assert.match(frame, /restored 80 saved messages/u);
  assert.match(frame, /--- end of saved history ---/u);
  ui.exit();
});

test("coding saddle colors tool events separately from model responses", () => {
  const writes = [];
  const ui = createSaddleTerminalUi({
    output: { columns: 80, rows: 14, isTTY: true, write(value) { writes.push(String(value)); } },
    color: true
  });
  ui.enter();
  ui.writeLine("[tool call] be_read_from_filename");
  ui.writeLine("[tool result] README.md contents");
  ui.writeLine("[tool approval] command execution");
  ui.writeMarkdown("The file says the project is ready.");

  const output = writes.join("");
  assert.match(output, /\u001b\[1;35m\[tool call\] be_read_from_filename\u001b\[0m/u);
  assert.match(output, /\u001b\[35m\[tool result\] README\.md contents\u001b\[0m/u);
  assert.match(output, /\u001b\[1;33m\[tool approval\] command execution\u001b\[0m/u);
  assert.doesNotMatch(output, /\u001b\[1;35mThe file says the project/u);
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
  assert.ok(writes.join("").includes("Enter send/queue"));
  assert.ok(writes.join("").includes("paste keeps newlines"));
  assert.match(writes[0], /\u001b\[\?1049h/u);
  assert.match(writes[0], /\u001b\[\?2004h/u);
  assert.match(writes[0], /\u001b\[>1u/u);

  const redrawStart = writes.length;
  ui.scrollToBottom();
  assert.equal(ui.getState().scrollOffset, 0);
  assert.match(writes.slice(redrawStart).join(""), /transcript line 15/u);

  ui.exit();
  assert.match(writes.at(-1), /\u001b\[\?25h\u001b\[\?1049l/u);
  assert.match(writes.at(-1), /\u001b\[\?2004l\u001b\[<u/u);
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

test("coding saddle forwards terminal output failures to its shutdown handler", () => {
  const output = new EventEmitter();
  output.columns = 40;
  output.rows = 10;
  output.isTTY = true;
  output.write = () => {};
  const errors = [];
  const ui = createSaddleTerminalUi({ output, color: false, onOutputError: (error) => errors.push(error) });
  const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

  output.emit("error", error);

  assert.deepEqual(errors, [error]);
  ui.exit();
});
