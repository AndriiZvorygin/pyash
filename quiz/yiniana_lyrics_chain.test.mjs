import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildSongPath,
  buildSourcePath,
  buildTeachingPath,
  buildTopicPattern,
  collectTopicExcerpts,
  readCardFromResult,
  runLyricsChain,
  slugifyTopic,
  verifySongStructure,
  writeFileAtomic
} from "../command/yiniana_lyrics_chain.mjs";

const VALID_CARD = [
  "SEED CONCEPT",
  "Dignity is the honour that resides inside your own reality.",
  "",
  "CARDINAL TRAINING SENTENCE",
  "Dignity is the honour you carry regardless of the weather outside.",
  "",
  "TEACHING PROGRESSION",
  "We recognise the gates that guard the inner temple.",
  "",
  "ORTHOGONAL FEATURES",
  "The dignity of reality feels sacred.",
  "",
  "SURPRISES AND MISUNDERSTANDINGS",
  "It is often necessary to be undignified in order to be spontaneous.",
  "",
  "AFFAIRS OR ACTIVITIES",
  "We take pride in ourselves and trust our guidance.",
  "",
  "CAUSATIVE AND CONSEQUENCE",
  "When we judge ourselves on intentions, wholeness enters our life.",
  "",
  "CARDINAL SCENES AND IDIOMS",
  "The lions guarding the gate mark the process of transformation.",
  "",
  "BRIEF MEMORY PHRASES",
  "- Feet on the right track",
  "- Remember who you are",
  "- Dignity of your reality",
  "- Judge on intentions",
  "",
  "CONCEPT RELATIONS",
  "Dignity connects directly to free will."
].join("\n");

async function makeCorpus(root) {
  await fs.mkdir(path.join(root, "1999"), { recursive: true });
  await fs.writeFile(
    path.join(root, "1999", "0101.txt"),
    [
      "A line about peace and quiet.",
      "Another line that never mentions the topic.",
      "Peace is the quiet after the storm."
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "1999", "0102.txt"),
    "Nothing here at all.\n",
    "utf8"
  );
  await fs.mkdir(path.join(root, "2000"), { recursive: true });
  await fs.writeFile(
    path.join(root, "2000", "0202.txt"),
    "Peace peace peace is the only word that matters here.\n",
    "utf8"
  );
}


// The artifacts folder is gitignored, so a fresh checkout does not have it.
// The tests create their own scratch space; they should not depend on it.
async function makeTempDir(prefix) {
  const parent = path.join(process.cwd(), "artifacts");
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, prefix));
}

test("slugifyTopic keeps single words and refuses multi-word topics", () => {
  assert.equal(slugifyTopic("dignity"), "dignity");
  assert.throws(() => slugifyTopic("two words"), /single word/u);
  assert.throws(() => slugifyTopic(""), /single word/u);
});

test("topic paths land under the radio lyrics folder", () => {
  assert.equal(buildSourcePath("/radio", "dignity"), "/radio/lyrics/source-dignity.txt");
  assert.equal(buildTeachingPath("/radio", "dignity"), "/radio/lyrics/teaching-dignity.txt");
  assert.equal(buildSongPath("/radio", "dignity"), "/radio/lyrics/song-dignity.txt");
});

test("buildTopicPattern matches the word and not its neighbours", () => {
  const pattern = buildTopicPattern("peace");
  assert.equal(pattern.test("peace and quiet"), true);
  assert.equal(pattern.test("peaceful noise"), false);
  assert.equal(pattern.test("dispeace"), false);
});

test("collectTopicExcerpts finds the lines and their context", async () => {
  const root = await makeTempDir("lyrics-chain-");
  await makeCorpus(root);

  const result = await collectTopicExcerpts({ corpusDir: root, topic: "peace" });

  assert.ok(result.matches >= 3);
  assert.ok(result.text.includes("1999/0101.txt:1:"));
  assert.ok(result.text.includes("2000/0202.txt:1:"));
  assert.equal(result.files.length, 2);

  await fs.rm(root, { recursive: true, force: true });
});

test("collectTopicExcerpts follows linked corpus directories", async () => {
  const root = await makeTempDir("lyrics-chain-");
  const real = path.join(root, "real");
  await fs.mkdir(real, { recursive: true });
  await fs.writeFile(path.join(real, "0303.txt"), "Healing arrives quietly.\n", "utf8");
  await fs.symlink(real, path.join(root, "linked"), "dir");

  const result = await collectTopicExcerpts({ corpusDir: path.join(root, "linked"), topic: "healing" });

  assert.equal(result.matches, 1);
  assert.ok(result.text.includes("0303.txt:1:Healing arrives quietly."));

  await fs.rm(root, { recursive: true, force: true });
});

test("collectTopicExcerpts stays inside its bounds", async () => {
  const root = await makeTempDir("lyrics-chain-");
  await makeCorpus(root);

  const result = await collectTopicExcerpts({ corpusDir: root, topic: "peace", maxFiles: 1 });

  assert.equal(result.files.length, 1);

  await fs.rm(root, { recursive: true, force: true });
});

test("writeFileAtomic leaves the target in place and no temp file behind", async () => {
  const root = await makeTempDir("lyrics-chain-");
  const target = path.join(root, "nested", "song.txt");

  await writeFileAtomic(target, "the song\n");

  assert.equal(await fs.readFile(target, "utf8"), "the song\n");
  const entries = await fs.readdir(path.dirname(target));
  assert.deepEqual(entries, ["song.txt"]);

  await fs.rm(root, { recursive: true, force: true });
});

test("readCardFromResult follows the verbose result file", async () => {
  assert.equal(readCardFromResult("SEED CONCEPT\nsomething\n"), "SEED CONCEPT\nsomething");
  const root = await makeTempDir("lyrics-chain-");
  const cardPath = path.join(root, "card.txt");
  await fs.writeFile(cardPath, "SEED CONCEPT\nfrom the file\n", "utf8");
  assert.equal(readCardFromResult(`FINAL_RESULT_FILE: ${cardPath}\n`), "SEED CONCEPT\nfrom the file");
  await fs.rm(root, { recursive: true, force: true });
});

test("runLyricsChain writes the source and the teaching, and refuses a broken card", async () => {
  const root = await makeTempDir("lyrics-chain-");
  const corpus = path.join(root, "corpus");
  const radio = path.join(root, "radio");
  await makeCorpus(corpus);

  const result = await runLyricsChain({
    topic: "peace",
    radioDir: radio,
    corpusDir: corpus,
    runLearn: async () => ({ card: VALID_CARD, stderr: "" })
  });

  assert.equal(result.teachingPath, buildTeachingPath(radio, "peace"));
  assert.ok((await fs.readFile(result.sourcePath, "utf8")).includes("1999/0101.txt:1:"));
  assert.equal(await fs.readFile(result.teachingPath, "utf8"), VALID_CARD);

  await assert.rejects(() => runLyricsChain({
    topic: "peace",
    radioDir: radio,
    corpusDir: corpus,
    runLearn: async () => ({ card: "SEED CONCEPT\nnothing else\n", stderr: "" })
  }), /learn card defective/u);

  await fs.rm(root, { recursive: true, force: true });
});

test("runLyricsChain fails loudly when the corpus has nothing on the topic", async () => {
  const root = await makeTempDir("lyrics-chain-");
  const corpus = path.join(root, "corpus");
  await makeCorpus(corpus);

  await assert.rejects(() => runLyricsChain({
    topic: "nowhere",
    radioDir: path.join(root, "radio"),
    corpusDir: corpus
  }), /no channeling excerpts/u);

  await fs.rm(root, { recursive: true, force: true });
});

test("verifySongStructure reads the bracketed section tags", () => {
  const full = [
    "[intro]We recognise the dignity before we begin",
    "[verse 1]Walking in our sovereign light,",
    "[chorus]We recognise stately dignity",
    "[verse 2]We sew honor where broken fabric meets,",
    "[bridge]Accept sorrow, watch the dark weave gold,",
    "[chorus]We recognise stately dignity",
    "[outro]Bright beauty lives inside us always."
  ].join("\n");

  const verdict = verifySongStructure(full);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.tags, ["intro", "verse", "chorus", "verse", "bridge", "chorus", "outro"]);

  const partial = verifySongStructure("[intro]\n[verse 1]One\n[chorus]Two\n");
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes("verse"));
  assert.ok(partial.missing.includes("bridge"));
  assert.ok(partial.missing.includes("outro"));
});
