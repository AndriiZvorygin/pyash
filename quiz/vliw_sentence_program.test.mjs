import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerPyashProgram, lowerPyashSentence, decodePyashProgram } from "../program/library/vliw/sentence.mjs";
import { decodeLegacyCodeletSequence } from "../program/library/vliw/codelets.mjs";
import {
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  QUOTED_GRAMMAR_WORD
} from "../program/library/vliw/quotes.mjs";
import { encodePyacPack, decodePyacPack } from "../program/library/vliw/database.mjs";
import {
  compilePyashProgramSource,
  decodePyashProgramPack,
  executePyashProgramPack,
  evolvePyashProgramSource,
  mutatePyashProgramSource
} from "../program/library/vliw/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "examples/pyash/vliw-is-even.pya"), "utf8");

function indexedVectors(words, boundaryOffsets) {
  const chunks = [];
  for (let offset = 0; offset < words.length; offset += 15) {
    chunks.push({ offset, words: words.slice(offset, offset + 15) });
  }
  return chunks.map(({ offset, words: chunk }, index) => {
    const complete = index === chunks.length - 1;
    const vector = new Uint16Array(16);
    for (let wordIndex = 0; wordIndex < chunk.length; wordIndex += 1) {
      vector[wordIndex + 1] = chunk[wordIndex];
      const isBoundary = boundaryOffsets.has(offset + wordIndex + 1);
      if (isBoundary === complete) vector[0] |= 1 << (wordIndex + 1);
    }
    if (complete) vector[0] |= 1;
    return vector;
  });
}

test("ordinary Pyash ceremony source round-trips through the fixed-width PyAC pack", () => {
  const sentences = source.split(/\n/u).filter((line) => line.trim()).map(parse);
  const lowered = lowerPyashProgram(sentences);
  const decoded = decodePyashProgram(decodePyacPack(encodePyacPack(lowered.vectors)).codelets);

  assert.deepEqual(decoded, sentences);
  assert.ok(lowered.vectors.length > sentences.length);
  assert.ok(lowered.vectors.every((vector) => vector.length === 16));
  assert.deepEqual(decoded.filter(({ mood }) => mood === "prah"), [
    { mood: "prah" },
    { mood: "prah" },
    { mood: "prah" }
  ]);
});

test("long paragraph quotes use raw full-word blocks and resume indexed codelets", () => {
  const text = "quoted payload 🧠 line ".repeat(5);
  const sentences = [
    parse(`ob text ${JSON.stringify(text)} be text ya`),
    parse("ob num 7 be number ya")
  ];
  const lowered = lowerPyashProgram(sentences);
  const quoteLength = text.length;
  const rawCodeletCount = Math.ceil(quoteLength / 16);

  assert.equal(lowered.vectors[0][1], 0x0e1d);
  assert.equal(lowered.vectors[0][2], quoteLength);
  assert.equal(lowered.vectors[0][0] & 1, 0);
  assert.equal(lowered.vectors[1].length, 16);
  assert.deepEqual(
    lowered.vectors.slice(1, 1 + rawCodeletCount).flatMap((vector) => Array.from(vector)),
    Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)).concat(
      Array(rawCodeletCount * 16 - quoteLength).fill(0)
    )
  );
  assert.equal(lowered.vectors[1][0], text.charCodeAt(0));

  const firstSentenceVectors = lowered.vectors.slice(0, rawCodeletCount + 2);
  const rawDecoded = decodeLegacyCodeletSequence(firstSentenceVectors);
  assert.equal(rawDecoded.items.find((item) => item.kind === "quote")?.quote.value, text);
  assert.throws(
    () => decodeLegacyCodeletSequence(firstSentenceVectors.slice(0, 1)),
    (error) => error.code === "missing-blockquote"
  );
  const corruptPadding = firstSentenceVectors.map((vector) => Uint16Array.from(vector));
  corruptPadding[rawCodeletCount][15] = 1;
  assert.throws(
    () => decodeLegacyCodeletSequence(corruptPadding),
    (error) => error.code === "nonzero-blockquote-padding"
  );

  const decoded = decodePyashProgram(lowered.vectors);
  assert.deepEqual(decoded, sentences);
  assert.deepEqual(
    decodePyashProgram(decodePyacPack(encodePyacPack(lowered.vectors)).codelets),
    sentences
  );
});

test("the long-quote threshold is fourteen inline words and fifteen raw words", () => {
  for (const [length, expectedVectors] of [[14, 2], [15, 3]]) {
    const sentence = parse(`ob text ${JSON.stringify("x".repeat(length))} be text ya`);
    const lowered = lowerPyashProgram([sentence]);
    assert.equal(lowered.vectors.length, expectedVectors, `text length ${length}`);
    assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
  }
});

test("typed quoted blocks use paired zi frames and preserve their quote kind", () => {
  const payload = "raw typed payload ".repeat(5);
  const sentence = parse(`ob text quoted.pyash.${payload}.pyash.quoted be text ya`);
  const lowered = lowerPyashProgram([sentence]);
  const words = lowered.sentences[0].words;
  const tagWords = [PARAGRAPH_LETTER_QUOTE_WORD, 5, 0x0070, 0x0079, 0x0061, 0x0073, 0x0068];

  assert.deepEqual(sentence.quoteKinds, { ob: "pyash" });
  assert.equal(words[0], QUOTED_GRAMMAR_WORD);
  assert.equal(words[1], 0);
  assert.deepEqual(words.slice(2, 2 + tagWords.length), tagWords);
  assert.equal(words[2 + tagWords.length], 0);
  const closeMarker = words.lastIndexOf(QUOTED_GRAMMAR_WORD);
  assert.deepEqual(words.slice(closeMarker - tagWords.length - 2, closeMarker + 1), [
    0, ...tagWords, 0, QUOTED_GRAMMAR_WORD
  ]);
  assert.equal(words.includes(0xee1d), false);
  assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
});

test("long quote kind tags and payloads continue through indexed and raw codelets", () => {
  const kind = "typed-label-12345";
  const sentence = parse(`ob text quoted.${kind}.payload.${kind}.quoted be text ya`);
  const lowered = lowerPyashProgram([sentence]);

  assert.equal(lowered.sentences[0].words[0], QUOTED_GRAMMAR_WORD);
  assert.equal(lowered.sentences[0].words.filter((word) => word === QUOTED_GRAMMAR_WORD).length, 2);
  assert.ok(lowered.vectors.length >= 3);
  assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
});

test("quote frames accept an optional length and reject unverified hashes", () => {
  const sentence = parse("ob text quoted.pyash.payload.pyash.quoted be text ya");
  const lowered = lowerPyashSentence(sentence);
  const tagEnd = 2 + 2 + "pyash".length;
  const lengthField = [NUMBER_QUOTE_WORD, "payload".length];
  const withLength = [
    ...lowered.words.slice(0, tagEnd),
    ...lengthField,
    ...lowered.words.slice(tagEnd)
  ];
  const shiftedBoundaries = new Set(
    lowered.boundaryOffsets.map((offset) => offset >= tagEnd ? offset + lengthField.length : offset)
  );

  assert.deepEqual(
    decodePyashProgram(indexedVectors(withLength, shiftedBoundaries)),
    [sentence]
  );

  const hashField = [PARAGRAPH_LETTER_QUOTE_WORD, 3, 0x0068, 0x0061, 0x0073];
  const withHash = [
    ...lowered.words.slice(0, tagEnd),
    ...lengthField,
    ...hashField,
    ...lowered.words.slice(tagEnd)
  ];
  const hashBoundaries = new Set(
    lowered.boundaryOffsets.map((offset) => offset >= tagEnd
      ? offset + lengthField.length + hashField.length
      : offset)
  );
  assert.throws(
    () => decodePyashProgram(indexedVectors(withHash, hashBoundaries)),
    (error) => error.code === "unsupported-quote-hash-profile"
  );
});

test("long quote length may cross an indexed codelet boundary", () => {
  const payload = "boundary-crossing quote payload ".repeat(3);
  const sentence = {
    su: { name: "one two three four five six seven eight nine ten eleven twelve" },
    ob: { text: payload },
    be: "text",
    mood: "ya"
  };
  const lowered = lowerPyashProgram([sentence]);

  assert.equal(lowered.vectors[0][15], 0x0e1d);
  assert.equal(lowered.vectors[1][1], payload.length);
  assert.equal(lowered.vectors[2][0], payload.charCodeAt(0));
  assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
});

test("ordinary numeric vectors use indexed continuations and preserve following sentences", () => {
  const values = Array.from({ length: 40 }, (_, index) => index === 15 ? 0 : index + 1);
  const sentences = [
    parse(`ob ve num ${values.join(" ")} be vector ya`),
    parse("ob num 9 be number ya")
  ];
  const lowered = lowerPyashProgram(sentences);

  assert.ok(lowered.vectors.length > 3);
  assert.ok(lowered.vectors.every((vector) => vector.length === 16));
  assert.ok(lowered.vectors.slice(0, -1).some((vector) => (vector[0] & 1) === 0));
  assert.deepEqual(decodePyashProgram(lowered.vectors), sentences);
});

test("ordinary text vectors use indexed continuation rather than raw vector blocks", () => {
  const values = Array.from({ length: 12 }, (_, index) => `v${index}`);
  const sentence = parse(`ob ve text ${values.join(" ")} be vector ya`);
  const lowered = lowerPyashProgram([sentence]);

  assert.equal(lowered.vectors.length, 4);
  assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
});

test("ordinary Pyash is-even program executes from its compiled PyAC pack", async () => {
  for (const [input, expected] of [[0, true], [1, false], [2, true], [17, false], [65534, true]]) {
    const invocation = `ob num ${input} to name bool answer be equally number do`;
    const compiled = compilePyashProgramSource(source, { invocation });
    const result = await executePyashProgramPack(compiled.pack);
    assert.equal(result.output.boolean, expected, `input ${input}`);
    assert.equal(result.execution.invoked, "equally number");
    assert.ok(compiled.vectorCount > 0);
  }
});

test("numeric equality conditional lowers to the Rust interpreter fixture", () => {
  const sentence = parse(
    "ob num 5 be equally from num 5 then ob num 7 be number else ob num 9 be number ya"
  );
  const lowered = lowerPyashProgram([sentence]);

  assert.deepEqual(lowered.vectors, [
    Uint16Array.from([
      0xd6b6, 0x881d, 5, 0x245e, 0x881d, 5, 0x313e, 0x4809, 0x29be, 0x881d, 7, 0x245e, 0xea30,
      0x217e, 0x881d, 9
    ]),
    Uint16Array.from([0x000b, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  ]);
  assert.deepEqual(decodePyashProgram(lowered.vectors), [sentence]);
});

test("programlet mutations are deterministic and evolution validates held-out cases", async () => {
  const left = mutatePyashProgramSource(source, { seed: 41 });
  const right = mutatePyashProgramSource(source, { seed: 41 });
  assert.equal(left, right);
  assert.notEqual(left, source);
  assert.match(left, /ob num 0 to name bool answer be ceremony def/u);
  assert.match(left, /else su name lie/u);

  const result = await evolvePyashProgramSource({
    sourceText: source,
    functionName: "equally number",
    trainingCases: [{ input: 4, expected: true }, { input: 7, expected: false }],
    heldoutCases: [{ input: 0, expected: true }, { input: 65535, expected: false }],
    populationSize: 4,
    generations: 2,
    seed: 7
  });
  assert.equal(result.validated, true);
  assert.equal(result.trainingFitness.incorrectCount, 0);
  assert.equal(result.heldoutFitness.incorrectCount, 0);
  assert.ok(result.candidatePack instanceof Uint8Array);
  assert.equal(decodePyashProgramPack(result.candidatePack).length, source.split(/\n/u).filter(Boolean).length);
});

test("programlet admission rejects effectful and recursive bodies", () => {
  assert.throws(
    () => compilePyashProgramSource(source.replace("be remains do", "be say do")),
    /rejects effectful or unknown verb/u
  );
  assert.throws(
    () => compilePyashProgramSource(source, { invocation: "be equally number do" }),
    /requires one typed bool or num output name/u
  );
  const incompatibleCall = source.replace(
    "su name truth to name bool answer be truth",
    "su name truth to name num answer be truth"
  );
  assert.throws(() => compilePyashProgramSource(incompatibleCall), /incompatible output signature/u);
  const missingReturn = source.replace("su name answer ret\n", "");
  assert.throws(() => compilePyashProgramSource(missingReturn), /must return a value/u);
  const recursive = source.replace(
    "su name answer ret",
    "ob num 3 to name bool answer be equally number do\nsu name answer ret"
  );
  assert.throws(() => compilePyashProgramSource(recursive), /recursive ceremony calls/u);
});
