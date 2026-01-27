import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

const program = [
  "exists su name profile be map def",
  "su name name ob text \"Ada\" be text ya",
  "su name profile be map prah",
  "exists su name greet be ceremony def",
  "ob text \"hi\" be write do",
  "su name greet be ceremony prah"
].join("\\n");

async function roundtrip(language) {
  const toLang = parse(
    `from text quoted.pyash.${program}.pyash.quoted from state pyash to state ${language} to name output be translation do`
  );
  const langResult = await interpret(toLang);
  const langText = langResult?.ob?.text ?? langResult?.value?.text;
  assert.ok(langText, `${language} translation should return text`);

  const backToPyash = parse(
    `from text quoted.pyash.${langText}.pyash.quoted from state ${language} to state pyash to name pyash_out be translation do`
  );
  const pyashResult = await interpret(backToPyash);
  const sentences = pyashResult?.ob?.sentences ?? pyashResult?.value?.sentences;
  assert.ok(Array.isArray(sentences), "roundtrip should yield sentences array");
  const roundtripText = sentences.map(sentenceToPyash).join("\\n");
  assert.equal(roundtripText, program);
}

test("translation map/ceremony roundtrip (english)", async () => {
  forget();
  await roundtrip("english");
});

test("translation map/ceremony roundtrip (french)", async () => {
  forget();
  await roundtrip("french");
});

test("translation map/ceremony roundtrip (russian)", async () => {
  forget();
  await roundtrip("russian");
});
