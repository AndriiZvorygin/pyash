import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../../../../program/understand/index.mjs";
import { interpret } from "../../../../program/bridge/index.mjs";
import { forget, remember } from "../../../../program/remember/index.mjs";

const VERSE_ONE = "We clear our minds to widen holy sight,\nAnd rest as light within the carnival night.";
const VERSE_TWO = "We step into shadow where the lost wander alone,\nAnd find their hands in ours before they feel unalone.";
const CHORUS = "Choose the dark carnival with light\nListen to the sound of your own truth\nWe carry what we cannot see\nAnd set the captives free";
const VERSE_THREE = "We walk where shadows fall and let our inner fire ignite,\nThe path ahead reveals a brighter dawn that never hides.";
const BRIDGE = "True dignity rests in one Creator within us all,\nWe become somber bright beauty where broken worlds stand still.";
const FINAL_CHORUS = "Choose the dark carnival with light\nListen to the sound of your own truth\nWe carry what we cannot see\nAnd set the captives free";
const OUTRO = "End of session.\n(Who is listening?)\nYou are.";

async function run(line) {
  return interpret(parse(line));
}

async function assembleSheet() {
  forget();
  await run('from filename "./world/house/radio/module/hymn_manuscript.pya" to name hymn manuscript be import do');
  await run(`ob text ${JSON.stringify(VERSE_ONE)} to name text verse one out be text do`);
  await run(`ob text ${JSON.stringify(VERSE_TWO)} to name text verse two out be text do`);
  await run(`ob text ${JSON.stringify(CHORUS)} to name text chorus out be text do`);
  await run(`ob text ${JSON.stringify(VERSE_THREE)} to name text verse three out be text do`);
  await run(`ob text ${JSON.stringify(BRIDGE)} to name text bridge out be text do`);
  await run(`ob text ${JSON.stringify(FINAL_CHORUS)} to name text final chorus out be text do`);
  await run(`ob text ${JSON.stringify(OUTRO)} to name text outro out be text do`);
  await run("su name sheet stage to name text sheet out be hymn sheet assemble do");
  return String(remember("sheet out")?.ob?.text ?? "");
}

test("hymn sheet assemble writes the reference section order and tag vocabulary", async () => {
  const sheet = await assembleSheet();

  const order = ["[Verse]", "[Verse]", "[Chorus]", "[Verse]", "[Chorus]", "[Bridge]", "[Chorus]", "[Outro]"];
  const tags = sheet.split("\n").filter((line) => /^\[(?:Verse|Chorus|Bridge|Outro)\]$/u.test(line));
  assert.deepEqual(tags, order);

  assert.equal(
    sheet,
    [
      "[Verse]",
      VERSE_ONE,
      "",
      "[Verse]",
      VERSE_TWO,
      "",
      "[Chorus]",
      CHORUS,
      "",
      "[Verse]",
      VERSE_THREE,
      "",
      "[Chorus]",
      CHORUS,
      "",
      "[Bridge]",
      BRIDGE,
      "",
      "[Chorus]",
      FINAL_CHORUS,
      "",
      "[Outro]",
      OUTRO
    ].join("\n")
  );
});

test("hymn sheet assemble keeps every section tag on its own line", async () => {
  const sheet = await assembleSheet();
  for (const line of sheet.split("\n")) {
    assert.doesNotMatch(line, /\[[A-Za-z ]+\]\S/u, `tag is glued to its first lyric line: ${line}`);
  }
  assert.match(sheet, /^\[Verse\]\n/u);
  assert.match(sheet, /\n\n\[Chorus\]\n/u);
});

test("hymn sheet assemble repeats the chorus verbatim and turns only the last chorus line", async () => {
  const sheet = await assembleSheet();
  const choruses = sheet
    .split("\n\n")
    .filter((block) => block.startsWith("[Chorus]"))
    .map((block) => block.replace(/^\[Chorus\]\n/u, ""));

  assert.equal(choruses.length, 3);
  assert.equal(choruses[0], CHORUS);
  assert.equal(choruses[1], CHORUS);
  assert.equal(choruses[2], FINAL_CHORUS);

  const firstLines = choruses.map((block) => block.split("\n")[0]);
  assert.deepEqual(firstLines, [firstLines[0], firstLines[0], firstLines[0]]);
});

test("hymn sheet assemble exports the deterministic assembly ceremony", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");
  assert.match(text, /exists su name hymn sheet assemble be export ya/);
  assert.match(text, /su name hymn sheet assemble to name text sheet out be ceremony def/);
  assert.match(text, /su name hymn sheet stage to name text hymn out be hymn sheet assemble do/);
});
