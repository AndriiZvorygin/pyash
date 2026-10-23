import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  buildVliwDatabase,
  decodeCodelet,
  executeCodelets,
  lowerParagraph,
  lowerSentence,
  queryVliwCatalog,
  replayVliwDatabase
} from "../program/library/vliw/index.mjs";
import {
  TYPED_LITERAL_USED_WORD_COUNT,
  decodeTypedLiteralCodelet,
  executeTypedLiteralCodelet,
  lowerTypedLiteralSentence,
  typedLiteralCompatibility
} from "../program/library/vliw/literal.mjs";
import { VliwEncodingError } from "../program/library/vliw/plus.mjs";

const numberWords = [
  0x0019, 0x881d, 0x0007, 0x245e, 0x217e, 0x0000, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

const letterWords = [
  0x0019, 0x081d, 0x0041, 0x245e, 0x217e, 0x0000, 0x0000, 0x0000,
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

test("typed numeric literals preserve the exact legacy result vector", () => {
  const [lowered] = lowerSentence(parse("ob num 7 be number ya"));

  assert.deepEqual(Array.from(lowered.words), numberWords);
  assert.equal(lowered.usedWords, TYPED_LITERAL_USED_WORD_COUNT);
  assert.deepEqual(decodeTypedLiteralCodelet(lowered.words), {
    mood: "ya",
    ob: { num: 7 },
    be: "number"
  });
  assert.deepEqual(decodeCodelet(lowered.words).sentence, lowered.sentence);
});

test("typed letter literals preserve the legacy letter quote vector", async () => {
  const lowered = lowerTypedLiteralSentence(parse('ob text "A" be text ya'));

  assert.deepEqual(Array.from(lowered.words), letterWords);
  assert.deepEqual(decodeTypedLiteralCodelet(lowered.words), {
    mood: "ya",
    ob: { text: "A" },
    be: "text"
  });
  assert.deepEqual(await executeTypedLiteralCodelet(lowered.words), {
    mood: "ya",
    ob: { text: "A" },
    be: "text"
  });
});

test("the facade executes typed literals beside numeric plus in paragraph order", async () => {
  const paragraph = [
    parse("ob num 7 be number ya"),
    parse('ob text "A" be text ya'),
    parse("ob num 2 to num 3 be plus do")
  ];
  const codelets = lowerParagraph(paragraph);
  const results = await executeCodelets(codelets);

  assert.deepEqual(results, [
    { mood: "ya", ob: { num: 7 }, be: "number" },
    { mood: "ya", ob: { text: "A" }, be: "text" },
    { su: { name: "result" }, ob: { num: 5 }, be: "number", mood: "ya" }
  ]);
  assert.deepEqual(decodeCodelet(codelets[1].words).semantic, "typed-literal");
  assert.equal(typedLiteralCompatibility.usedWords, 5);
});

test("PyAC catalogs index, pack, and replay typed literal codelets", async () => {
  const database = buildVliwDatabase([
    parse("ob num 7 be number ya"),
    parse('ob text "A" be text ya'),
    parse("su name unassigned-name ob num 7 be number ya")
  ]);

  assert.equal(database.catalog.executableCount, 2);
  assert.equal(database.catalog.unsupportedCount, 1);
  assert.equal(queryVliwCatalog(database, { semantic: "typed-literal" }).length, 2);
  assert.equal(queryVliwCatalog(database, { status: "executable", value: 7 }).length, 1);

  const outcomes = await replayVliwDatabase(database);
  assert.deepEqual(outcomes.slice(0, 2).map((outcome) => outcome.result), [
    { mood: "ya", ob: { num: 7 }, be: "number" },
    { mood: "ya", ob: { text: "A" }, be: "text" }
  ]);
  assert.equal(outcomes[0].verified, true);
  assert.equal(outcomes[1].verified, true);
  assert.equal(database.catalog.records[2].status, "unsupported");
  assert.equal(database.catalog.records[2].error.code, "unrepresentable-name");
});

test("typed literal lowering keeps unsupported names and widths explicit", () => {
  assert.equal(
    errorCode(() => lowerTypedLiteralSentence(parse("su name answer ob num 7 be number ya"))),
    "unrepresentable-name"
  );
  assert.equal(
    errorCode(() => lowerTypedLiteralSentence(parse('ob text "AB" be text ya'))),
    "literal-width"
  );
  assert.equal(
    errorCode(() => lowerTypedLiteralSentence({ mood: "ya", ob: { num: 65536 }, be: "number" })),
    "literal-range"
  );
});

test("typed literal decoding rejects malformed quote boundaries and noisy tails", () => {
  const badTail = [...numberWords];
  badTail[5] = 1;
  assert.equal(errorCode(() => decodeTypedLiteralCodelet(badTail)), "malformed-codelet");

  const badCase = [...letterWords];
  badCase[3] = 0x287e;
  assert.equal(errorCode(() => decodeTypedLiteralCodelet(badCase)), "malformed-codelet");

  const wrongWidth = [...letterWords];
  wrongWidth[1] = 0x0e1d;
  wrongWidth[2] = 1;
  assert.equal(errorCode(() => decodeTypedLiteralCodelet(wrongWidth)), "malformed-codelet");

  const truncated = [...numberWords];
  truncated[1] = 0x001d;
  assert.throws(() => decodeCodelet(truncated), /quote|codelet/iu);
});
