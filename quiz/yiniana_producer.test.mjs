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
  chooseWinner,
  parseLanes,
  pickSeed,
  produce,
  publishSong
} from "../command/yiniana_producer.mjs";

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
      await fs.writeFile(outputPath, `render ${seed}`);
      return outputPath;
    },
    score: async () => ({ percent: 40, hits: 40, total: 100, transcript: "words" }),
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
  const written = await fs.readFile(path.join(radio, "audio", "yue2-dignity.mp3"), "utf8");
  assert.match(written, /^render /u);
  const leftovers = (await fs.readdir(path.join(radio, "audio"))).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "a half written song was left behind");
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
