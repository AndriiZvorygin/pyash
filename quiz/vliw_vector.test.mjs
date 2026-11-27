import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodePyashProgram,
  lowerPyashProgram,
  decodeCodelet,
  decodeVectorSequence,
  executeCodelets,
  lowerVectorSequence,
  lowerSentence
} from "../program/library/vliw/index.mjs";

// A numeric vector travels as a uint quote whose vector thickness states how
// many 16-bit elements it holds.
test("numeric vector literals lower to a vector-width quote codelet", async () => {
  const sentence = parse("ob ve num 1 2 3 be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0061, 0x8f1d, 0x0001, 0x0002, 0x0003, 0x245e, 0x217e
  ]);
  assert.equal(codelet.usedWords, 7);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("vector widths use the legacy thickness and explicit length forms", () => {
  const [pair] = lowerSentence(parse("ob ve num 7 8 be vector ya"));
  assert.equal(pair.words[1], 0x891d);
  assert.equal(pair.words[0], 0x0031);

  const [five] = lowerSentence(parse("ob ve num 1 2 3 4 5 be vector ya"));
  assert.equal(five.words[1], 0x8e1d);
  assert.equal(five.words[2], 5);
  assert.deepEqual(
    Array.from(five.words.slice(0, five.usedWords)),
    [0x0301, 0x8e1d, 0x0005, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x245e, 0x217e]
  );
  assert.deepEqual(decodeCodelet(five.words).sentence.ob.ve.values, [1, 2, 3, 4, 5]);
});

test("VLIW numeric arrays use the 16-bit thickness-6 count through 65,535 elements", async () => {
  const values = Array.from({ length: 65_535 }, (_, index) => index & 0xffff);
  const codelets = lowerSentence({
    mood: "ya",
    ob: { ve: { type: "num", values } },
    be: "vector"
  });

  assert.equal(codelets[0].words[1], 0x8e1d);
  assert.equal(codelets[0].words[2], 65_535);
  const decoded = decodeVectorSequence(codelets.map(({ words }) => words));
  assert.deepEqual(decoded.ob.ve.values, values);
  const [executed] = await executeCodelets(codelets);
  assert.deepEqual(executed.ob.ve.values, values);
});

test("VLIW text arrays count members and preserve each length-framed member", () => {
  const sentence = parse('ob ve text "A" "long text" "tree" be vector ya');
  const codelets = lowerSentence(sentence);
  const decoded = decodeVectorSequence(codelets.map(({ words }) => words));

  assert.equal(codelets[0].words[1], 0x0e9d);
  assert.equal(codelets[0].words[2], 3);
  assert.deepEqual(decoded.ob.ve, sentence.ob.ve);
});

test("the Pyash program packer round-trips counted arrays with the canonical vector verb", () => {
  const sentences = [
    parse(`ob ve num ${Array.from({ length: 17 }, (_, index) => index).join(" ")} be vector ya`),
    parse('ob ve text "one" "two words" "three" be vector ya')
  ];
  const program = lowerPyashProgram(sentences);
  assert.deepEqual(decodePyashProgram(program.vectors), sentences);
});

test("named vector literals carry the name phrase and its nominative case", async () => {
  const sentence = parse("su name collector ob ve num 1 2 3 be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0185, 0xab02, 0x24de, 0x8f1d, 0x0001, 0x0002, 0x0003, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
});

test("vector elements that look like case words stay payload", () => {
  const [codelet] = lowerSentence(parse("ob ve num 9438 9310 8574 be vector ya"));
  assert.deepEqual(decodeCodelet(codelet.words).sentence.ob.ve.values, [9438, 9310, 8574]);
});

test("float32 vectors execute through the legacy float sort", async () => {
  const values = [0.1, -2.5];
  const [codelet] = lowerSentence(parse(`ob ve float32 ${values.join(" ")} be vector ya`));
  assert.equal(codelet.words[1], 0xd11d);
  assert.deepEqual(decodeCodelet(codelet.words).sentence.ob.ve, {
    type: "float32",
    values: values.map(Math.fround)
  });
  const [result] = await executeCodelets([codelet]);
  assert.deepEqual(result.ob.ve.values, values.map(Math.fround));
});

test("long float32 vectors use indexed continuation without changing the quote kind", () => {
  const values = [0.1, -2.5, 3.25, -0, 1e20, 1e-20, 7.75, 8.5, 9.25, 10.5];
  const program = lowerPyashProgram([
    parse(`ob ve float32 ${values.map((value) => Object.is(value, -0) ? "-0" : value).join(" ")} be vector ya`)
  ]);
  assert.ok(program.vectors.length > 1);
  assert.equal(program.vectors[0][1], 0xd61d);
  const [decoded] = decodePyashProgram(program.vectors);
  assert.equal(decoded.ob.ve.type, "float32");
  assert.deepEqual(decoded.ob.ve.values, values.map(Math.fround));
});

test("sixteen float32 lanes use the bounded quote width and indexed continuation", () => {
  const values = Array.from({ length: 16 }, (_, index) => index + 1);
  const sentence = parse(`ob ve float32 ${values.join(" ")} be vector ya`);
  const program = lowerPyashProgram([sentence]);
  assert.equal(program.vectors.length, 3);
  assert.equal(program.vectors[0][1], 0xd41d);
  assert.notEqual(program.vectors[1][0], 0, "the continuation remains indexed");
  assert.deepEqual(decodePyashProgram(program.vectors)[0].ob.ve.values, values);
});

test("declared float32 vector width zero-fills trailing lanes before lowering", () => {
  const sentence = parse("su name collector ob ve float32 1.0 1.2 1.3 by num 16 be vector ya");
  const codelets = lowerSentence(sentence);
  const decoded = decodeVectorSequence(codelets.map(({ words }) => words));

  assert.ok(codelets[0].words.includes(0xd41d));
  assert.equal(decoded.su.name, "collector");
  assert.deepEqual(decoded.ob.ve.values, [1, Math.fround(1.2), Math.fround(1.3), ...Array(13).fill(0)]);
});

test("literal lowering carries sixteen lanes for every fixed-width quote family", async () => {
  const cases = [
    { type: "num", values: Array.from({ length: 16 }, (_, index) => index + 1) },
    { type: "bool", values: Array.from({ length: 16 }, (_, index) => index % 2 ? "lie" : "truth") },
    { type: "float32", values: Array.from({ length: 16 }, (_, index) => index + 0.25) },
    { type: "float64", values: Array.from({ length: 16 }, (_, index) => index + 0.125) }
  ];
  for (const { type, values } of cases) {
    const sourceValues = values.map((value) => type === "bool" ? value : String(value)).join(" ");
    const codelets = lowerSentence(parse(`ob ve ${type} ${sourceValues} be vector ya`));
    const expected = type === "float32" ? values.map(Math.fround) : values;
    assert.deepEqual(decodeVectorSequence(codelets.map(({ words }) => words)).ob.ve.values, expected, type);
    assert.deepEqual((await executeCodelets(codelets))[0].ob.ve.values, expected, type);
  }
});

test("one-element float vectors remain distinct from scalar quotes", () => {
  const sentence = parse("ob ve float32 1.25 be vector ya");
  const program = lowerPyashProgram([sentence]);
  assert.equal(program.vectors[0][1], 0xd61d);
  assert.equal(program.vectors[0][2], 1);
  assert.deepEqual(decodePyashProgram(program.vectors)[0].ob.ve.values, [1.25]);
});

test("an indexed vector continuation is followed by a separately indexed next sentence", () => {
  const sentences = [
    parse(`ob ve float32 ${Array.from({ length: 16 }, (_, index) => index).join(" ")} be vector ya`),
    parse("ob num 7 be number ya")
  ];
  const program = lowerPyashProgram(sentences);
  assert.equal(decodePyashProgram(program.vectors).length, 2);
  assert.deepEqual(decodePyashProgram(program.vectors)[1], sentences[1]);
});

test("continued vectors execute alongside following codelet sentences", async () => {
  const vectorSource = `ob ve float32 ${Array.from({ length: 16 }, (_, index) => index + 0.5).join(" ")} be vector ya`;
  const codelets = [
    ...lowerSentence(parse(vectorSource)),
    ...lowerSentence(parse("ob num 7 be number ya"))
  ];
  const results = await executeCodelets(codelets);

  assert.equal(results.length, 2);
  assert.equal(results[0].be, "vector");
  assert.deepEqual(results[0].ob.ve.values, Array.from({ length: 16 }, (_, index) => index + 0.5));
  assert.equal(results[1].ob.num, 7);
});

test("continued vector execution preserves named state across its boundary", async () => {
  const vectorSource = `ob ve num ${Array.from({ length: 16 }, (_, index) => index).join(" ")} be vector ya`;
  const codelets = [
    ...lowerSentence(parse("exists su name count ob num 7 be number ya")),
    ...lowerSentence(parse(vectorSource)),
    ...lowerSentence(parse("su name count ob what que"))
  ];
  const results = await executeCodelets(codelets);

  assert.equal(results[1].be, "vector");
  assert.equal(results[2].ob.num, 7);
});

test("float64 vectors use the legacy eight-byte scalar width", () => {
  const values = [Math.PI, -0, 1e200, -1e-200];
  const program = lowerPyashProgram([
    parse(`ob ve float64 ${values.map((value) => Object.is(value, -0) ? "-0" : value).join(" ")} be vector ya`)
  ]);
  assert.equal(program.vectors[0][1], 0xda1d);
  const [decoded] = decodePyashProgram(program.vectors);
  assert.equal(decoded.ob.ve.type, "float64");
  assert.deepEqual(decoded.ob.ve.values, values);
});

test("float vectors continue across codelets up to the sixteen-lane quote limit", async () => {
  const f32Values = [1, 2, 3, 4, 5];
  const [f32] = lowerSentence(parse(`ob ve float32 ${f32Values.join(" ")} be vector ya`));
  assert.deepEqual(decodeCodelet(f32.words).sentence.ob.ve.values, f32Values);
  assert.deepEqual((await executeCodelets([f32]))[0].ob.ve.values, f32Values);
  const f32Long = lowerSentence(parse("ob ve float32 1 2 3 4 5 6 be vector ya"));
  assert.deepEqual(decodeVectorSequence(f32Long.map(({ words }) => words)).ob.ve.values, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual((await executeCodelets(f32Long))[0].ob.ve.values, [1, 2, 3, 4, 5, 6]);

  const f64Values = [Math.PI, -0, 1e100];
  const [f64] = lowerSentence(parse("ob ve float64 3.141592653589793 -0 1e100 be vector ya"));
  assert.deepEqual(decodeCodelet(f64.words).sentence.ob.ve.values, f64Values);
  assert.deepEqual((await executeCodelets([f64]))[0].ob.ve.values, f64Values);
  const f64Long = lowerSentence(parse("ob ve float64 1 2 3 4 be vector ya"));
  assert.deepEqual(decodeVectorSequence(f64Long.map(({ words }) => words)).ob.ve.values, [1, 2, 3, 4]);
  assert.deepEqual((await executeCodelets(f64Long))[0].ob.ve.values, [1, 2, 3, 4]);

  const named = lowerSentence(parse("su name collector ob ve float64 1 2 3 be vector ya"));
  assert.deepEqual(decodeVectorSequence(named.map(({ words }) => words)).ob.ve.values, [1, 2, 3]);
});

test("boolean vector literals lower to a signed integer quote", async () => {
  const sentence = parse("ob ve bool truth lie truth be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0061, 0xaf1d, 0x0001, 0x0000, 0x0001, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("text vector literals keep every element and its case", async () => {
  const sentence = parse('ob ve text Name Age be vector ya');
  const [codelet] = lowerSentence(sentence);
  assert.equal(codelet.words[1], 0x0e1d);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);

  const longer = parse('ob ve text Ada Turing be vector ya');
  const longerCodelets = lowerSentence(longer);
  assert.deepEqual(decodeCodelet(longerCodelets[0].words).sentence, longer);

  const longPayload = lowerSentence(parse("ob ve text hello world be vector ya"));
  assert.deepEqual(
    decodeVectorSequence(longPayload.map(({ words }) => words)).ob.ve.values,
    ["hello", "world"]
  );
  assert.deepEqual((await executeCodelets(longPayload))[0].ob.ve.values, ["hello", "world"]);
});

test("VLIW arrays accept one text element and reject lengths above the count field", () => {
  const [single] = lowerSentence(parse("ob ve num 7 be vector ya"));
  assert.deepEqual(decodeCodelet(single.words).sentence.ob.ve.values, [7]);
  const [singleText] = lowerSentence(parse('ob ve text "one" be vector ya'));
  assert.deepEqual(decodeCodelet(singleText.words).sentence.ob.ve.values, ["one"]);
  assert.equal(decodeCodelet(singleText.words).items[1].quote.family, "text-array");
  assert.equal(lowerVectorSequence(parse('ob ve text "one" be vector ya'))[0].words[1], 0x0e9d);
  const seventeen = Array.from({ length: 17 }, (_, index) => index);
  const codelets = lowerSentence({ mood: "ya", ob: { ve: { type: "num", values: seventeen } }, be: "vector" });
  assert.deepEqual(decodeVectorSequence(codelets.map(({ words }) => words)).ob.ve.values, seventeen);
  assert.throws(() => lowerSentence({
    mood: "ya",
    ob: { ve: { type: "num", values: Array(65_536).fill(0) } },
    be: "vector"
  }), (error) => error.code === "unsupported-vector-width");
});

test("vector literals reject element types and values without a proven encoding", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve hollow be vector ya")),
    (error) => error.code === "unsupported-vector-type"
  );
  assert.throws(
    () => lowerSentence(parse('ob ve raw "a" "b" be vector ya')),
    (error) => error.code === "unsupported-vector-type"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 70000 be vector ya")),
    (error) => error.code === "numeric-range"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve bool maybe lie be vector ya")),
    (error) => error.code === "unsupported-vector-type"
  );
});

test("vector literals reject an object that carries more than one value", () => {
  assert.throws(
    () => lowerSentence(parse('ob ve hollow "a" "b" be vector ya')),
    (error) => error.code === "unsupported-sentence"
  );
});
