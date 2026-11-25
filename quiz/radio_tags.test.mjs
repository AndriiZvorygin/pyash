#!/usr/bin/env node
// The tags a song carries.
//
// A listener plays a song in a player, and a player shows what the file says
// about itself: what the song is called, who made it, what it belongs to,
// when the audio was made, and a word about the song.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readId3Tags } from "../program/library/radio/id3.mjs";
import {
  ALBUM,
  dayOf,
  fileDay,
  readSongTags,
  songTags,
  stampCatalogue,
  stampSong,
  voiceForEngine
} from "../program/library/radio/tags.mjs";

const FRAME_BYTES = Math.floor((144 * 128000) / 44100);

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function makeTempDir(prefix = "yiniana-tags-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("a song of the house is by Andrii Zvorygin, and a song of the station is by the station", () => {
  assert.equal(voiceForEngine("az").artist, "Andrii Zvorygin");
  assert.equal(voiceForEngine("ace-step").artist, ALBUM);
  assert.equal(voiceForEngine("yue2").artist, ALBUM);
  assert.equal(voiceForEngine("").artist, ALBUM, "a song of an unknown engine is by the house");
});

test("the tags of a song carry its name, its author, its album and its day", () => {
  const tags = songTags({ filename: "az-mirror-stranger.mp3", title: "Lover Is Closer", date: "2026-11-22" });

  assert.equal(tags.title, "Lover Is Closer");
  assert.equal(tags.artist, "Andrii Zvorygin");
  assert.equal(tags.album, "Zvorygin Radio");
  assert.equal(tags.date, "2026-11-22");
  assert.equal(tags.comment, "Zvorygin Radio · Andrii Zvorygin · mirror-stranger");
});

test("a song without a name of its own is named by the lane it was made for", () => {
  const tags = songTags({ filename: "ace-step-grace.mp3", date: "2026-11-25" });

  assert.equal(tags.title, "Grace");
  assert.equal(tags.artist, "Zvorygin Radio");
  assert.equal(tags.comment, "Zvorygin Radio · ACE-Step 1.5 XL turbo · grace");
});

test("the day of a date is the day the house wrote down", () => {
  assert.equal(dayOf(new Date(2026, 10, 22)), "2026-11-22");
  assert.equal(dayOf(new Date("not a date")), "");
});

test("a song is stamped with the tags of a song, and the audio is left alone", async () => {
  const root = await makeTempDir();
  const song = path.join(root, "az-mirror-stranger.mp3");
  await fs.writeFile(song, syntheticMp3({ frames: 8 }));

  const stamped = await stampSong({
    targetPath: song,
    tags: songTags({ filename: "az-mirror-stranger.mp3", title: "Lover Is Closer", date: "2026-11-22" })
  });

  assert.equal(stamped, true);
  const tags = readId3Tags(await fs.readFile(song));
  assert.equal(tags.title, "Lover Is Closer");
  assert.equal(tags.artist, "Andrii Zvorygin");
  assert.equal(tags.date, "2026-11-22");
  const media = await fs.readFile(song);
  assert.ok(media.includes(syntheticMp3({ frames: 8 })), "the audio is still there");
  const leftovers = (await fs.readdir(root)).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "no part file was left behind");
  await fs.rm(root, { recursive: true, force: true });
});

test("a song that already carries the tags is not written again", async () => {
  const root = await makeTempDir();
  const song = path.join(root, "ace-step-grace.mp3");
  await fs.writeFile(song, syntheticMp3());
  const tags = songTags({ filename: "ace-step-grace.mp3", date: "2026-11-25" });

  assert.equal(await stampSong({ targetPath: song, tags }), true, "the first stamp writes");
  const before = await fs.stat(song);
  assert.equal(await stampSong({ targetPath: song, tags }), false, "the second stamp does not");
  const after = await fs.stat(song);
  assert.equal(after.mtimeMs, before.mtimeMs, "the file was not touched again");
  await fs.rm(root, { recursive: true, force: true });
});

test("the day of a song is written once, and a later pass leaves it alone", async () => {
  const root = await makeTempDir();
  const song = path.join(root, "ace-step-grace.mp3");
  await fs.writeFile(song, syntheticMp3());

  await stampSong({ targetPath: song, tags: songTags({ filename: "ace-step-grace.mp3", date: "2026-11-25" }) });
  await stampSong({ targetPath: song, tags: songTags({ filename: "ace-step-grace.mp3", date: "2027-01-01" }) });

  const tags = readId3Tags(await fs.readFile(song));
  assert.equal(tags.date, "2026-11-25", "the day of the song did not move");
  await fs.rm(root, { recursive: true, force: true });
});

test("the tags of a file are read from the head of the file alone", async () => {
  const root = await makeTempDir();
  const song = path.join(root, "az-fresh-light.mp3");
  await fs.writeFile(song, syntheticMp3({ frames: 40 }));
  await stampSong({
    targetPath: song,
    tags: songTags({ filename: "az-fresh-light.mp3", title: "Fresh Light for Valentina", date: "2026-03-21" })
  });

  const tags = await readSongTags({ filePath: song });
  assert.equal(tags.title, "Fresh Light for Valentina");
  assert.equal(tags.date, "2026-03-21");
  await fs.rm(root, { recursive: true, force: true });
});

test("the catalogue is stamped song by song, and the day of an imported song is the day of its source", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  await fs.mkdir(audio, { recursive: true });
  const source = path.join(root, "house-song.mp3");
  await fs.writeFile(source, syntheticMp3());
  const sourceDay = "2026-03-21";
  await fs.utimes(source, new Date(2026, 2, 21), new Date(2026, 2, 21));
  await fs.writeFile(path.join(audio, "az-fresh-light.mp3"), syntheticMp3());
  await fs.writeFile(path.join(audio, "ace-step-grace.mp3"), syntheticMp3());

  const summary = await stampCatalogue({
    catalogueDirectory: audio,
    manifest: [{ name: "az-fresh-light.mp3", source, sheet: "", title: "Fresh Light for Valentina" }]
  });

  assert.equal(summary.songs, 2);
  assert.equal(summary.stamped, 2, "both songs were stamped");
  const imported = readId3Tags(await fs.readFile(path.join(audio, "az-fresh-light.mp3")));
  assert.equal(imported.title, "Fresh Light for Valentina");
  assert.equal(imported.date, sourceDay, "the imported song is dated by its source");
  const rendered = readId3Tags(await fs.readFile(path.join(audio, "ace-step-grace.mp3")));
  assert.equal(rendered.title, "Grace");
  assert.equal(rendered.artist, "Zvorygin Radio");
  assert.match(rendered.date, /^\d{4}-\d{2}-\d{2}$/u, "the rendered song is dated by the day it was published");
  await fs.rm(root, { recursive: true, force: true });
});

test("a catalogue that is not there is stamped without a word", async () => {
  const summary = await stampCatalogue({ catalogueDirectory: "/nowhere/at/all" });
  assert.equal(summary.songs, 0);
  assert.equal(summary.stamped, 0);
});

test("the day of a file is the day the file says", async () => {
  const root = await makeTempDir();
  const song = path.join(root, "song.mp3");
  await fs.writeFile(song, syntheticMp3());
  const day = await fileDay(song);
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(await fileDay(path.join(root, "missing.mp3")), "", "a file that is not there has no day");
  await fs.rm(root, { recursive: true, force: true });
});
