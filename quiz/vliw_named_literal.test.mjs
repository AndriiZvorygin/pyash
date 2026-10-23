import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  buildVliwDatabaseFromTranslation,
  decodeCodelet,
  executeCodelets,
  lowerSentence,
  queryVliwCatalog,
  replayVliwDatabase
} from "../program/library/vliw/index.mjs";
import {
  decodeNamedLiteralCodelet,
  lowerNamedLiteralSentence,
  namedLiteralCompatibility
} from "../program/library/vliw/named_literal.mjs";
import { VliwEncodingError } from "../program/library/vliw/plus.mjs";

const namedNumberWords = [
  0x0065, 0xab02, 0x24de, 0x881d, 0x0007, 0x245e, 0x217e, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

const namedLetterWords = [
  0x0065, 0xab02, 0x24de, 0x081d, 0x0041, 0x245e, 0x217e, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

function errorCode(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof VliwEncodingError);
    return error.code;
  }
  assert.fail("expected VliwEncodingError");
}

test("named numeric literals preserve the proven legacy result vector", () => {
  const sentence = parse("su name collector ob num 7 be number ya");
  const lowered = lowerNamedLiteralSentence(sentence);

  assert.deepEqual(Array.from(lowered.words), namedNumberWords);
  assert.equal(lowered.usedWords, namedLiteralCompatibility.usedWords);
  assert.deepEqual(decodeNamedLiteralCodelet(lowered.words), sentence);
  assert.deepEqual(decodeCodelet(lowered.words).sentence, sentence);
});

test("named letter literals preserve the legacy letter quote vector", async () => {
  const sentence = parse('su name collector ob text "A" be text ya');
  const lowered = lowerNamedLiteralSentence(sentence);

  assert.deepEqual(Array.from(lowered.words), namedLetterWords);
  assert.deepEqual(await executeCodelets([lowered]), [sentence]);
});

test("named literal lowering keeps name and width boundaries explicit", () => {
  assert.equal(
    errorCode(() => lowerSentence(parse("su name unassigned-name ob num 7 be number ya"))),
    "unrepresentable-name"
  );
  assert.equal(
    errorCode(() => lowerSentence(parse("su name collector unassigned-name ob num 7 be number ya"))),
    "unrepresentable-name"
  );
  assert.equal(
    errorCode(() => lowerSentence(parse('su name collector ob text "ABCDEFGHIJ" be text ya'))),
    "literal-width"
  );
});

test("named literals preserve multi-word legacy names", async () => {
  const sentence = parse("su name collector answer ob num 7 be number ya");
  const lowered = lowerSentence(sentence)[0];
  assert.deepEqual(Array.from(lowered.words.slice(0, 8)), [
    0x0065, 0xab02, 0x4930, 0x24de, 0x881d, 0x0007, 0x245e, 0x217e
  ]);
  assert.equal(lowered.usedWords, 8);
  assert.deepEqual(await executeCodelets([lowered]), [sentence]);
});

test("named literal decoding rejects malformed markers and noisy tails", () => {
  const badHead = [...namedNumberWords];
  badHead[0] = 0x0019;
  assert.equal(errorCode(() => decodeNamedLiteralCodelet(badHead)), "malformed-codelet");

  const badName = [...namedNumberWords];
  badName[1] = 0x1234;
  assert.equal(errorCode(() => decodeNamedLiteralCodelet(badName)), "malformed-codelet");

  const badTail = [...namedLetterWords];
  badTail[7] = 1;
  assert.equal(errorCode(() => decodeNamedLiteralCodelet(badTail)), "malformed-codelet");
});

test("named literals are cataloged and replayed with translation provenance", async () => {
  const database = await buildVliwDatabaseFromTranslation(
    ["collector 是 数 7.", "collector 是 文本 \"A\"."],
    { language: "chinese", locator: "fixtures/chinese-lines.txt" }
  );

  assert.deepEqual(database.sentences, [
    parse("su name collector ob num 7 be number ya"),
    parse('su name collector ob text "A" be text ya')
  ]);
  assert.equal(database.catalog.executableCount, 2);
  assert.equal(queryVliwCatalog(database, { sourceLanguage: "chinese" }).length, 2);
  assert.deepEqual(database.catalog.records.map((record) => record.source), [
    {
      language: "chinese",
      locator: "fixtures/chinese-lines.txt",
      lineIndex: 0,
      sentenceIndex: 0,
      text: "collector 是 数 7."
    },
    {
      language: "chinese",
      locator: "fixtures/chinese-lines.txt",
      lineIndex: 1,
      sentenceIndex: 0,
      text: "collector 是 文本 \"A\"."
    }
  ]);

  const outcomes = await replayVliwDatabase(database);
  assert.deepEqual(outcomes.map((outcome) => outcome.result), database.sentences);
  assert.equal(outcomes.every((outcome) => outcome.verified), true);
});

test("translation database construction reports adapter and line failures", async () => {
  await assert.rejects(
    async () => buildVliwDatabaseFromTranslation(["collector 是 数 7."], { language: "klingon" }),
    (error) => error.code === "translation-adapter"
  );
  await assert.rejects(
    async () => buildVliwDatabaseFromTranslation(["unrecognized source"], { language: "chinese" }),
    (error) => error.code === "translation-failed" && error.details.lineIndex === 0
  );
});
