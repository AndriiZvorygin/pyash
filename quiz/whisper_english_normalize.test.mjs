import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhisperEnglishTokens } from "../program/verbs/exchange/translation/whisper_english.mjs";
import { parseTokens } from "../program/understand/parse_tokens.mjs";

test("whisper english normalizes mood prefix and role aliases", () => {
  const tokens = normalizeWhisperEnglishTokens(
    "Do be plus object number 5 to name result."
  );
  assert.deepEqual(tokens, ["be", "plus", "ob", "number", "5", "to", "name", "result", "do"]);

  const sentence = parseTokens(tokens);
  assert.equal(sentence.mood, "do");
  assert.equal(sentence.be, "plus");
  assert.equal(sentence.ob.num, 5);
  assert.equal(sentence.to.name, "result");
});

test("whisper english collapses quoted blocks to text tokens", () => {
  const tokens = normalizeWhisperEnglishTokens(
    "object quoted pyash exists su name alpha ob num 1 be number ya pyash quoted be text ya"
  );
  assert.deepEqual(tokens, [
    "ob",
    "__QUOTED_TEXT__:exists su name alpha ob num 1 be number ya",
    "be",
    "text",
    "ya"
  ]);

  const sentence = parseTokens(tokens);
  assert.equal(sentence.mood, "ya");
  assert.equal(sentence.be, "text");
  assert.equal(sentence.ob.text, "exists su name alpha ob num 1 be number ya");
});

test("whisper english rejects duplicate mood tokens", () => {
  assert.throws(
    () => normalizeWhisperEnglishTokens("do be plus do"),
    /prefix and suffix/
  );
});

test("whisper english requires a mood token", () => {
  assert.throws(
    () => normalizeWhisperEnglishTokens("be plus object number 5"),
    /missing mood/
  );
});
