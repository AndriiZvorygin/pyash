import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

const program = [
  "su name total ob num 5 be number ya",
  "su name today ob date 2025-05-01 be date ya",
  "su name message ob text \"hello\" be text ya",
  "su name ok ob bool truth ya",
  "su name nums ob ve num 1 2 3 be vector ya",
  "ob num 5 to name total be plus do",
  "ob num 3 from name total be subtract do",
  "ob num 2 with name total be multiply do",
  "ob num 4 with name total be divide do",
  "ob num 10 from num 3 to name rem be remains do",
  "ob text \"hi\" to name output be write do",
  "ob name outbox be write do",
  "ob text \"speak\" be say do",
  "from name input be read do",
  "from filename artifacts/example.txt be read do",
  "ob num 3 from num 5 be tiny then ob text \"ok\" to name output be write do"
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

test("translation core roundtrip (english)", async () => {
  forget();
  await roundtrip("english");
});

test("translation core roundtrip (french)", async () => {
  forget();
  await roundtrip("french");
});

test("translation core roundtrip (russian)", async () => {
  forget();
  await roundtrip("russian");
});
