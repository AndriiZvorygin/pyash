import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { getRefinery } from "../program/bridge/refinery.mjs";
import { forget } from "../program/remember/index.mjs";

async function runLines(lines) {
  for (const line of lines) {
    await interpret(parse(line));
  }
}

test("refinery registry captures platforms and deps", async () => {
  forget();
  await runLines([
    "su name build be refinery def",
    "exists su name parse ob la exists su name src ob text \"a\" be load ya ko be platform ya",
    "exists su name compile from ve name parse ob la exists su name ast be compile ya ko be platform ya",
    "prah"
  ]);

  const refinery = getRefinery("build");
  assert.ok(refinery);
  assert.deepStrictEqual(refinery.order, ["parse", "compile"]);
  const parseStage = refinery.platforms.get("parse");
  const compileStage = refinery.platforms.get("compile");
  assert.ok(parseStage);
  assert.ok(compileStage);
  assert.deepStrictEqual(compileStage.deps, ["parse"]);
  assert.equal(parseStage.actionSentence.be, "load");
  assert.equal(parseStage.actionSentence.mood, "ya");
});

test("refinery rejects invalid depend list", async () => {
  forget();
  await interpret(parse("su name build be refinery def"));
  await assert.rejects(
    () => interpret(parse("exists su name step from num 1 ob la exists su name x be noop ya ko be platform ya")),
    (err) => err?.sentence?.su?.name === "depend defective"
  );
});

test("refinery rejects missing activity clause", async () => {
  forget();
  await interpret(parse("su name build be refinery def"));
  await assert.rejects(
    () => interpret(parse("exists su name step be platform ya")),
    (err) => err?.sentence?.su?.name === "platform defective"
  );
});

test("refinery registry captures series entries with implicit order deps", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name collect ob text \"echo one\" be command do",
    "su name summarize ob text \"echo two\" be command do",
    "prah"
  ]);

  const refinery = getRefinery("flow");
  assert.ok(refinery);
  assert.deepStrictEqual(refinery.order, ["collect", "summarize"]);
  const collectStage = refinery.platforms.get("collect");
  const summarizeStage = refinery.platforms.get("summarize");
  assert.equal(collectStage.actionSentence.be, "command");
  assert.equal(collectStage.actionSentence.mood, "do");
  assert.deepStrictEqual(summarizeStage.deps, ["collect"]);
});
