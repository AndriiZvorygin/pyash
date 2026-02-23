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
    "su name parse ob text \"a\" be write do",
    "su name compile from ve name parse ob text \"b\" be write do",
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
  assert.equal(parseStage.actionSentence.be, "write");
  assert.equal(parseStage.actionSentence.mood, "do");
});

test("refinery accepts from name single dependency", async () => {
  forget();
  await runLines([
    "su name build be refinery def",
    "su name parse ob text \"a\" be write do",
    "su name compile from name parse ob text \"b\" be write do",
    "prah"
  ]);
  const refinery = getRefinery("build");
  const compileStage = refinery?.platforms?.get("compile");
  assert.deepStrictEqual(compileStage?.deps, ["parse"]);
  assert.deepStrictEqual(compileStage?.actionSentence?.from, { name: "parse" });
});

test("refinery accepts repeated-name vector dependency form", async () => {
  forget();
  await runLines([
    "su name build be refinery def",
    "su name one ob text \"1\" be write do",
    "su name two ob text \"2\" be write do",
    "su name three ob text \"3\" be write do",
    "su name final from ve name one name two name three ob text \"ok\" be write do",
    "prah"
  ]);
  const refinery = getRefinery("build");
  const finalStage = refinery?.platforms?.get("final");
  assert.deepStrictEqual(finalStage?.deps, ["one", "two", "three"]);
});

test("refinery rejects invalid depend list", async () => {
  forget();
  await interpret(parse("su name build be refinery def"));
  await assert.rejects(
    () => interpret(parse("su name step from num 1 ob text \"ok\" be write do")),
    (err) => err?.sentence?.su?.name === "depend defective"
  );
});

test("refinery rejects missing activity clause", async () => {
  forget();
  await interpret(parse("su name build be refinery def"));
  await assert.rejects(
    () => interpret(parse("ob text \"ok\" be write do")),
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
