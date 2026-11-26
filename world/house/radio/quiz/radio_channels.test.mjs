#!/usr/bin/env node
// The channels of the station.
//
// A radio that plays one programme at one pace is a radio that never rests.
// The house wants a night programme as well as a day one, and a night
// programme is a different pace and a different voice, not a different name.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  channelByName,
  channelLanes,
  channelProgramme,
  channelProgrammes,
  channelSongs,
  parseChannels,
  readChannels
} from "../program/library/channels.mjs";

const CHANNELS = [
  "# the channels of the station",
  "",
  "day | ace-step | 128 | - | *",
  "night | night | 75 | plain Mennonite hymn, natural male lead | peace, stillness",
  ""
].join("\n");

async function makeTempDir(prefix = "yiniana-channels-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("a channel is a name, a voice, a pace, a style and its lanes", () => {
  const channels = parseChannels(CHANNELS);

  assert.equal(channels.length, 2);
  assert.deepEqual(channels[0], {
    name: "day",
    engine: "ace-step",
    bpm: 128,
    style: "",
    lanes: [],
    everyLane: true
  });
  assert.deepEqual(channels[1].lanes, ["peace", "stillness"]);
  assert.equal(channels[1].everyLane, false);
  assert.equal(channels[1].style, "plain Mennonite hymn, natural male lead");
});

test("a channel that is not written down is not a channel", () => {
  assert.deepEqual(parseChannels(""), []);
  assert.deepEqual(parseChannels("# only a comment\n\n"), []);
  assert.deepEqual(parseChannels("| ace-step | 128 | - | *"), [], "a channel without a name is not a channel");
  assert.deepEqual(parseChannels("day | | 128 | - | *"), [], "a channel without a voice is not a channel");
  const broken = parseChannels("day | ace-step | fast | - | *");
  assert.equal(broken[0].bpm, 0, "a pace that is not a number is no pace");
});

test("a channel carries every lane of the house, or the lanes it names", () => {
  const [day, night] = parseChannels(CHANNELS);

  assert.deepEqual(channelLanes(day, ["love", "peace"]), ["love", "peace"]);
  assert.deepEqual(channelLanes(night, ["love", "peace"]), ["peace", "stillness"]);
  assert.deepEqual(channelLanes(null, ["love"]), []);
});

test("the song of a lane is named for the voice that sings it", () => {
  const [day, night] = parseChannels(CHANNELS);

  assert.deepEqual(channelSongs(night, ["love"]), ["night-peace.mp3", "night-stillness.mp3"]);
  assert.deepEqual(channelSongs(day, ["love"]), ["ace-step-love.mp3"]);
  assert.deepEqual(channelSongs({ engine: "" }, ["love"]), [], "a channel without a voice sings nothing");
});

test("the songs that came before the radio open the first programme", () => {
  const programmes = channelProgrammes({
    channels: parseChannels(CHANNELS),
    topics: ["peace"],
    house: ["az-compassion.mp3"]
  });

  const day = programmes[0];
  const night = programmes[1];
  assert.deepEqual(day.songs, ["az-compassion.mp3", "ace-step-peace.mp3"], "the house opens the programme");
  assert.ok(day.contract.has("az-compassion.mp3"));
  assert.ok(!night.contract.has("az-compassion.mp3"), "the house songs do not play in the night programme");
  assert.ok(night.contract.has("night-peace.mp3"));
  assert.equal(night.songs.length, 2, "the night programme plays its own lanes");
});

test("the first channel is the one a listener gets by default", () => {
  const channels = parseChannels(CHANNELS);

  assert.equal(channelByName(channels, "").name, "day", "a listener who asks for nothing gets the first channel");
  assert.equal(channelByName(channels, "night").name, "night");
  assert.equal(channelByName(channels, "morning").name, "day", "a channel the station does not have falls back");
  assert.equal(channelByName(channels, "morning", { fallback: false }), null, "the truth is asked for");
  assert.equal(channelByName([], "day"), null, "a station without channels has no channel");
});

test("a channel that is not the first one sings in a voice of its own", () => {
  const programmes = channelProgrammes({
    channels: parseChannels(CHANNELS),
    topics: ["peace"]
  });

  assert.equal(programmes[0].own, false, "the day programme shares the sheet of its lane");
  assert.equal(programmes[1].own, true, "the night programme carries a sheet of its own");
});

test("a programme without a channel is an empty programme", () => {
  const programme = channelProgramme({ channel: null, topics: ["peace"] });

  assert.deepEqual(programme.songs, []);
  assert.equal(programme.contract.size, 0);
});

test("the channels of a file that is not there are the ones the caller holds", async () => {
  const root = await makeTempDir();
  const file = path.join(root, "channels.txt");
  await fs.writeFile(file, CHANNELS);

  const read = await readChannels(file);
  assert.equal(read.length, 2);

  const missing = await readChannels(path.join(root, "nowhere.txt"), {
    fallback: [{ name: "house", engine: "ace-step", bpm: 0, style: "", lanes: [], everyLane: true }]
  });
  assert.equal(missing.length, 1, "the house keeps the programme it was given");
  assert.equal(missing[0].name, "house");
  assert.deepEqual(await readChannels(""), []);

  await fs.rm(root, { recursive: true, force: true });
});
