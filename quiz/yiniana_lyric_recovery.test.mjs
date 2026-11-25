import test from "node:test";
import assert from "node:assert/strict";

import {
  phrases,
  recoverRate,
  stripTags,
  transcriptText,
  words
} from "../command/yiniana_lyric_recovery.mjs";

test("stripTags removes the section markers from a song sheet", () => {
  assert.equal(stripTags("[intro]We are one\n\n[verse 1]Minds clear away"), " We are one\n\n Minds clear away");
});

test("words keeps only the sung words, folded to lower case", () => {
  assert.deepEqual(words("[chorus]We are ONE with everything!"), ["we", "are", "one", "with", "everything"]);
  assert.deepEqual(words(""), []);
});

test("phrases builds the n-gram set of a lyric", () => {
  assert.deepEqual([...phrases(["a", "b", "c"], 2)], ["a b", "b c"]);
  assert.deepEqual([...phrases(["a", "b"], 3)], []);
});

test("recoverRate counts the sheet's n-grams the recording carries back", () => {
  const song = "[verse 1]We are one with everything\nWe lift the light within";
  const heard = "we are one with everything we lift the light within";
  const result = recoverRate(song, heard, 4);
  assert.equal(result.total, 7);
  assert.equal(result.hits, 7);
  assert.equal(result.fraction, 1);
  assert.deepEqual(result.missing, []);
});

test("recoverRate names the n-grams the recording dropped", () => {
  const song = "[verse 1]We are one with everything\nWarm bread breaks soft";
  const heard = "we are one with everything warm bread breaks hard";
  const result = recoverRate(song, heard, 4);
  assert.equal(result.total, 6);
  assert.equal(result.hits, 5);
  assert.ok(result.fraction < 1);
  assert.deepEqual(result.missing, ["warm bread breaks soft"]);
});

test("transcriptText reads plain text, hear-runner JSON and whisper segments", () => {
  assert.equal(transcriptText("just words"), "just words");
  assert.equal(transcriptText('{"transcript":"sung words"}'), "sung words");
  assert.equal(transcriptText('{"segments":[{"text":"first"},{"text":"second"}]}'), "first second");
  assert.equal(transcriptText(""), "");
});

test("recoverRate runs against a whisper segment transcript", () => {
  const song = "[chorus]We are one with everything";
  const heard = JSON.stringify({ segments: [{ text: "We are one" }, { text: "with everything" }] });
  const result = recoverRate(song, transcriptText(heard), 4);
  assert.equal(result.total, 2);
  assert.equal(result.hits, 2);
  assert.equal(result.fraction, 1);
});
