import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

import {
  buildWorkList,
  buildAuditionArgs,
  chooseSheetExample,
  chooseWinner,
  ensureSongName,
  parseLanes,
  keepTranscript,
  pickSeed,
  produce,
  publishSong,
  readSongName,
  songNamePath,
  SHEET_EXAMPLES
} from "../command/yiniana_producer.mjs";
import { readId3Tags } from "../program/library/radio/id3.mjs";

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(Math.floor((144 * 128000) / 44100));
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function makeStation(root, { lanes = ["dignity", "peace"], published = [] } = {}) {
  const radio = path.join(root, "radio");
  await fs.mkdir(path.join(radio, "audio"), { recursive: true });
  await fs.mkdir(path.join(radio, "lyrics"), { recursive: true });
  await fs.writeFile(path.join(radio, "topics.txt"), `${lanes.join("\n")}\n`);
  for (const topic of lanes) {
    await fs.writeFile(path.join(radio, "lyrics", `song-${topic}.txt`), "[Verse]\nWe carry the light inside the room\n");
  }
  for (const name of published) {
    await fs.writeFile(path.join(radio, "audio", name), "audio");
  }
  return radio;
}

async function writeName({ namePath, name = "We Carry the Light" }) {
  await fs.writeFile(namePath, `${name}\n`, "utf8");
  return namePath;
}

async function run(line) {
  return interpret(parse(line));
}

test("the producer reads the lanes of the rotation", () => {
  const lanes = parseLanes([
    "# the topic rotation",
    "",
    "dignity",
    "  peace  ",
    "dignity",
    "# comment"
  ].join("\n"));
  assert.deepEqual(lanes, ["dignity", "peace"]);
});

test("the producer queues every lane and engine the catalogue is missing", () => {
  const work = buildWorkList({
    lanes: ["dignity", "peace"],
    engines: ["ace-step", "yue2"],
    published: ["ace-step-dignity.mp3"]
  });
  assert.deepEqual(work.map((item) => item.filename), [
    "yue2-dignity.mp3",
    "ace-step-peace.mp3",
    "yue2-peace.mp3"
  ]);
});

test("the producer keeps the seed that carries the most of the words", () => {
  const winner = chooseWinner([
    { seed: 1, percent: 12 },
    { seed: 2, percent: 34 },
    { seed: 3, percent: 20 }
  ]);
  assert.equal(winner.seed, 2);
  const tie = chooseWinner([
    { seed: 7, percent: 30 },
    { seed: 8, percent: 30 }
  ]);
  assert.equal(tie.seed, 7);
});

test("the producer draws a seed the workflow will take", () => {
  for (let draw = 0; draw < 200; draw += 1) {
    const seed = pickSeed();
    assert.ok(Number.isInteger(seed), "the seed is a whole number");
    assert.ok(seed >= 0, "the seed is never negative");
    assert.ok(seed < 2 ** 32, "the seed fits the range the workflow takes");
  }
  assert.equal(pickSeed(() => 0), 0, "the lowest draw is zero");
  assert.equal(pickSeed(() => 0.9999999999), 4294967295, "the highest draw is the top of the range");
});

test("the producer makes the song the catalogue is missing and publishes it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, { lanes: ["dignity"], published: ["ace-step-dignity.mp3"] });
  const rendered = [];
  const published = [];

  const summary = await produce({
    repoRoot: root,
    lanesFile: "radio/topics.txt",
    engines: ["ace-step", "yue2"],
    workflows: { "ace-step": "audio_ace_step_1_5_xl_turbo", yue2: "audio_yue2_own_melody" },
    durations: { "ace-step": 175, yue2: 180 },
    catalogueDirectory: "radio/audio",
    radioDirectory: radio,
    seeds: 2,
    songsPerRun: 1,
    minRecovery: 10,
    render: async ({ outputPath, seed }) => {
      rendered.push({ seed });
      await fs.writeFile(outputPath, syntheticMp3());
      return outputPath;
    },
    score: async () => ({ percent: 40, hits: 40, total: 100, transcript: "words" }),
    name: writeName,
    publish: async ({ sourcePath, catalogueDirectory, filename }) => {
      published.push(filename);
      return publishSong({ sourcePath, catalogueDirectory, filename });
    }
  });

  assert.equal(rendered.length, 2, "two seeds were rendered");
  for (const { seed } of rendered) {
    assert.ok(seed >= 0, "the seed a render is given is never negative");
  }
  assert.equal(published.length, 1, "one song was published");
  assert.deepEqual(published, ["yue2-dignity.mp3"], "the lane is filled before the next one starts");
  assert.equal(summary.songs[0].status, "published");
  const written = await fs.readFile(path.join(radio, "audio", "yue2-dignity.mp3"));
  assert.ok(written.includes(syntheticMp3()), "the audio that was rendered is what plays");
  const tags = readId3Tags(written);
  assert.equal(tags.title, "We Carry the Light", "the song carries the name the house gave it");
  assert.equal(tags.artist, "Zvorygin Radio", "the song is by the house");
  assert.equal(tags.album, "Zvorygin Radio");
  assert.match(tags.date, /^\d{4}-\d{2}-\d{2}$/u, "the song carries the day it was made");
  const leftovers = (await fs.readdir(path.join(radio, "audio"))).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "a half written song was left behind");
});

test("the words the house heard are kept with the song", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(lyrics, { recursive: true });
  const sheetPath = path.join(lyrics, "song-dignity.txt");
  await fs.writeFile(sheetPath, "[Verse]\nThe words of the sheet\n");
  const heard = path.join(root, "dignity.srt");
  await fs.writeFile(heard, "1\n00:00:04,000 --> 00:00:09,000\nThe words the house heard.\n");

  const kept = await keepTranscript({ srtPath: heard, sheetPath });

  assert.equal(kept, path.join(lyrics, "song-dignity.srt"));
  assert.match(await fs.readFile(kept, "utf8"), /The words the house heard/u);
  const leftovers = (await fs.readdir(lyrics)).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "no part file was left behind");
  await fs.rm(root, { recursive: true, force: true });
});

test("the producer does not publish a song whose words never arrive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, { lanes: ["dignity"], published: ["ace-step-dignity.mp3"] });
  const published = [];

  const summary = await produce({
    repoRoot: root,
    lanesFile: "radio/topics.txt",
    engines: ["ace-step", "yue2"],
    workflows: { "ace-step": "audio_ace_step_1_5_xl_turbo", yue2: "audio_yue2_own_melody" },
    catalogueDirectory: "radio/audio",
    radioDirectory: radio,
    seeds: 2,
    songsPerRun: 1,
    minRecovery: 10,
    render: async ({ outputPath, seed }) => {
      await fs.writeFile(outputPath, `render ${seed}`);
      return outputPath;
    },
    score: async () => ({ percent: 0, hits: 0, total: 100, transcript: "(upbeat music)" }),
    name: writeName,
    publish: async ({ sourcePath, catalogueDirectory, filename }) => {
      published.push(filename);
      return publishSong({ sourcePath, catalogueDirectory, filename });
    }
  });

  assert.deepEqual(published, [], "a silent song was published");
  assert.equal(summary.songs[0].status, "rejected");
  assert.match(summary.songs[0].note, /below the 10%/u);
});

test("the producer leaves the catalogue alone when every song is there", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, {
    lanes: ["dignity"],
    published: ["ace-step-dignity.mp3", "yue2-dignity.mp3"]
  });
  let rendered = 0;

  const summary = await produce({
    repoRoot: root,
    lanesFile: "radio/topics.txt",
    engines: ["ace-step", "yue2"],
    workflows: { "ace-step": "audio_ace_step_1_5_xl_turbo", yue2: "audio_yue2_own_melody" },
    catalogueDirectory: "radio/audio",
    radioDirectory: radio,
    render: async ({ outputPath }) => {
      rendered += 1;
      await fs.writeFile(outputPath, "render");
      return outputPath;
    },
    score: async () => ({ percent: 50, hits: 50, total: 100, transcript: "words" })
  });

  assert.equal(rendered, 0, "the producer rendered anyway");
  assert.equal(summary.queued, 0);
  assert.deepEqual(summary.songs, []);
});

test("the pyash ceremony runs the producer command", async () => {
  forget();
  await run('from filename "./module/radio_producer.pya" to name radio producer be import do');
  await run('ob text "printf producer-up" to name text radio producer command be text do');

  const result = await run("su name radio producer stage be radio producer run do");

  const output = String(result?.result?.text ?? result?.ob?.text ?? "");
  assert.match(output, /producer-up/u);
  forget();
});

test("the audition hears the whole render unless a window is asked for", () => {
  const whole = buildAuditionArgs({ audioPath: "song.mp3", windowPath: "opening.wav" });
  assert.ok(!whole.includes("-to"), "the whole render is heard, not only its opening");
  assert.deepEqual(whole, ["-v", "error", "-y", "-i", "song.mp3", "-ar", "16000", "-ac", "1", "opening.wav"]);

  const window = buildAuditionArgs({ audioPath: "song.mp3", windowPath: "opening.wav", auditionSeconds: 60 });
  assert.deepEqual(window, [
    "-v", "error", "-y", "-i", "song.mp3", "-ss", "0", "-to", "60", "-ar", "16000", "-ac", "1", "opening.wav"
  ]);
});

test("the producer writes only the hymn when the radio already has the card", async () => {  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, { lanes: ["dignity"] });
  const teachingPath = path.join(radio, "lyrics", "teaching-dignity.txt");
  await fs.writeFile(teachingPath, [
    "SEED CONCEPT",
    "The light we carry is the light we give.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "We carry the light we give.",
    "",
    "TEACHING PROGRESSION",
    "- We notice the light",
    "- We share the light",
    "- We become the light",
    "",
    "CAUSATIVE AND CONSEQUENCE",
    "- We give, and we receive",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- A lamp carried through the dark",
    "",
    "BRIEF MEMORY PHRASES",
    "- We carry the light",
    "- The light we give",
    "- A lamp in the dark",
    "- We share what we are"
  ].join("\n"), "utf8");

  assert.equal(await chooseSheetExample({ teachingPath, cardDepth: "radio" }), SHEET_EXAMPLES.hymn);
  assert.equal(await chooseSheetExample({ teachingPath, cardDepth: "full" }), SHEET_EXAMPLES.chain,
    "a card of another depth is written again");

  const missingPath = path.join(radio, "lyrics", "teaching-peace.txt");
  assert.equal(await chooseSheetExample({ teachingPath: missingPath, cardDepth: "radio" }), SHEET_EXAMPLES.chain);

  await fs.rm(root, { recursive: true, force: true });
});

test("the house names a song once, beside its sheet", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, { lanes: ["dignity"] });
  const sheetPath = path.join(radio, "lyrics", "song-dignity.txt");
  let asked = 0;

  const name = await ensureSongName({
    repoRoot: root,
    topic: "dignity",
    radioDirectory: radio,
    sheetPath,
    name: async ({ namePath }) => {
      asked += 1;
      return writeName({ namePath });
    }
  });

  assert.equal(name, "We Carry the Light", "the name the house gave is the name of the song");
  assert.equal(asked, 1, "the house asked for the name of the song");
  assert.equal(
    songNamePath(radio, "dignity"),
    path.join(radio, "lyrics", "name-dignity.txt"),
    "the name lies beside the sheet of the song"
  );

  const again = await ensureSongName({
    repoRoot: root,
    topic: "dignity",
    radioDirectory: radio,
    sheetPath,
    name: async () => {
      asked += 1;
      throw new Error("the house asked twice");
    }
  });

  assert.equal(again, "We Carry the Light", "the name that is there is kept");
  assert.equal(asked, 1, "a song is named once");

  await fs.rm(root, { recursive: true, force: true });
});

test("a song that cannot be named keeps the lane it was made for", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yiniana-producer-"));
  const radio = await makeStation(root, { lanes: ["dignity"] });
  const sheetPath = path.join(radio, "lyrics", "song-dignity.txt");

  const name = await ensureSongName({
    repoRoot: root,
    topic: "dignity",
    radioDirectory: radio,
    sheetPath,
    name: async () => {
      throw new Error("the mind is away");
    }
  });

  assert.equal(name, "", "a name that cannot be asked for is no name");
  assert.equal(await readSongName({ namePath: songNamePath(radio, "dignity") }), "");

  await fs.rm(root, { recursive: true, force: true });
});
