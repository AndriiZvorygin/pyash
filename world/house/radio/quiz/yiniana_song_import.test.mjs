#!/usr/bin/env node
// The Yiniana song import: the songs the house made before the radio.
//
// The import reads a manifest of songs that already exist somewhere on this
// machine, turns each one into an mp3 the station can stream, and puts it in
// the catalogue. The station finds it there on its next scan, without a
// restart.
//
// The manifest is radio/imports.txt, one song per line:
//
//   <name>.mp3 | <source file> | <lyric sheet> | <title>
//
// The sheet is optional. The title is the name the house gave the song, and
// it is written into the tag of the file. A song that is already in the
// catalogue is left alone, so the command can be run again whenever the house
// makes more songs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../../../../program/understand/index.mjs";
import { interpret } from "../../../../program/bridge/index.mjs";
import { forget } from "../../../../program/remember/index.mjs";

import { parseTrackName, scanCatalogue } from "../program/library/catalogue.mjs";
import { parseImports, pendingImports } from "../program/library/imports.mjs";
import { readId3Tags } from "../program/library/id3.mjs";
import {
  importSong,
  importSongs,
  inspectMp3,
  publishFile,
  sheetNameFor
} from "../command/yiniana_song_import.mjs";

async function makeTempDir(prefix = "yiniana-import-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(Math.floor((144 * 128000) / 44100));
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function run(line) {
  return interpret(parse(line));
}

test("the manifest reads the songs the house already made", () => {
  const imports = parseImports([
    "# the songs of the house",
    "",
    "az-god-remembers.mp3 | /know/AZ-God_Remembers_All.opus | /know/AZ-God_Remembers_All.lyrics.txt | God Remembers All",
    "az-go-forth.mp3 | /know/go_forth.opus | |",
    "not a song.txt | /know/notes.txt |",
    "az-god-remembers.mp3 | /know/other.opus |"
  ].join("\n"));

  assert.equal(imports.length, 2, "the repeat and the file that is not a song are left out");
  assert.equal(imports[0].name, "az-god-remembers.mp3");
  assert.equal(imports[0].source, "/know/AZ-God_Remembers_All.opus");
  assert.equal(imports[0].sheet, "/know/AZ-God_Remembers_All.lyrics.txt");
  assert.equal(imports[0].title, "God Remembers All", "the manifest carries the name of the song");
  assert.equal(imports[1].sheet, "", "a song without a sheet is still a song");
  assert.equal(imports[1].title, "", "a song without a name is named by its lane");
});

test("a song that is already in the catalogue is never imported again", () => {
  const pending = pendingImports({
    imports: [
      { name: "az-go-forth.mp3", source: "/know/go_forth.opus", sheet: "" },
      { name: "az-love-leads.mp3", source: "/know/love.opus", sheet: "" }
    ],
    published: ["AZ-GO-FORTH.MP3"]
  });
  assert.deepEqual(pending.map((entry) => entry.name), ["az-love-leads.mp3"]);
});

test("the sheet of a song is named for the song, so two songs do not fight over one file", () => {
  assert.equal(sheetNameFor("az-god-remembers.mp3"), "song-az-god-remembers.txt");
  assert.equal(sheetNameFor("ace-step-dignity.mp3"), "song-ace-step-dignity.txt");
  assert.equal(parseTrackName("az-god-remembers.mp3").engine, "az");
  assert.equal(parseTrackName("az-god-remembers.mp3").topic, "god-remembers");
});

test("the import brings a song into the catalogue and the station can play it", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(catalogue, { recursive: true });
  await fs.mkdir(lyrics, { recursive: true });
  const source = path.join(root, "song.opus");
  await fs.writeFile(source, "not really opus, but the import is given a transcode");

  const song = await importSong({
    entry: { name: "az-god-remembers.mp3", source, sheet: "" },
    catalogueDirectory: catalogue,
    lyricsDirectory: lyrics,
    transcode: async ({ outputPath }) => {
      await fs.writeFile(outputPath, syntheticMp3());
      return outputPath;
    }
  });

  assert.equal(song.status, "imported");
  const published = path.join(catalogue, "az-god-remembers.mp3");
  assert.ok(await fs.readFile(published, "utf8"), "the song is in the catalogue");
});

test("a song that is already there is left alone", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  await fs.writeFile(path.join(catalogue, "az-go-forth.mp3"), "the song we have");

  let transcodeCalls = 0;
  const song = await importSong({
    entry: { name: "az-go-forth.mp3", source: "/nowhere/song.opus", sheet: "" },
    catalogueDirectory: catalogue,
    transcode: async () => {
      transcodeCalls += 1;
      return "";
    }
  });

  assert.equal(song.status, "present");
  assert.equal(transcodeCalls, 0, "the song was not made again");
});

test("a song that is already there is given the name the house gave it", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  const published = path.join(catalogue, "az-mirror-stranger.mp3");
  await fs.writeFile(published, syntheticMp3({ frames: 6 }));
  const source = path.join(root, "house-song.opus");
  await fs.writeFile(source, "the song the house made");
  await fs.utimes(source, new Date(2026, 10, 22), new Date(2026, 10, 22));

  const song = await importSong({
    entry: { name: "az-mirror-stranger.mp3", source, sheet: "", title: "Lover Is Closer" },
    catalogueDirectory: catalogue
  });

  assert.equal(song.status, "titled");
  const tags = readId3Tags(await fs.readFile(published));
  assert.equal(tags.title, "Lover Is Closer");
  assert.equal(tags.artist, "Andrii Zvorygin", "the song says who made it");
  assert.equal(tags.album, "Zvorygin Radio");
  assert.equal(tags.date, "2026-11-22", "the song carries the day the house made it");
  const tracks = await scanCatalogue({ directory: catalogue });
  assert.equal(tracks[0].title, "Lover Is Closer", "the station shows the name of the song");
});

test("a song that is brought in is named before it is published", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  const source = path.join(root, "song.opus");
  await fs.writeFile(source, "the song we have");
  await fs.utimes(source, new Date(2026, 2, 21), new Date(2026, 2, 21));

  await importSong({
    entry: { name: "az-open-the-weights.mp3", source, sheet: "", title: "Open the Weights" },
    catalogueDirectory: catalogue,
    transcode: async ({ outputPath }) => {
      await fs.writeFile(outputPath, syntheticMp3());
      return outputPath;
    }
  });

  const published = path.join(catalogue, "az-open-the-weights.mp3");
  const tags = readId3Tags(await fs.readFile(published));
  assert.equal(tags.title, "Open the Weights");
  assert.equal(tags.artist, "Andrii Zvorygin");
  assert.equal(tags.date, "2026-03-21", "the song carries the day the house made it");
  const leftovers = (await fs.readdir(catalogue)).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "no part file was left behind");
});

test("the import never leaves a half written song in the catalogue", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  const target = path.join(catalogue, "az-love-leads.mp3");
  const staging = path.join(root, "staging.mp3");
  await fs.writeFile(staging, "the whole song");

  await publishFile(staging, target);

  assert.equal(await fs.readFile(target, "utf8"), "the whole song");
  const leftovers = (await fs.readdir(catalogue)).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "no part file was left behind");
});

test("an mp3 the station cannot play is not published", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });

  await assert.rejects(() => importSong({
    entry: { name: "az-broken.mp3", source: "/nowhere/song.opus", sheet: "" },
    catalogueDirectory: catalogue,
    transcode: async ({ outputPath }) => {
      await fs.writeFile(outputPath, "this is not audio");
      return outputPath;
    }
  }), /cannot play/u);

  const published = await fs.readdir(catalogue);
  assert.deepEqual(published.filter((name) => name.endsWith(".mp3")), [], "the broken song is not in the catalogue");
});

test("the reader says what it found in the mp3", () => {
  const frame = Buffer.alloc(Math.floor((144 * 128000) / 44100));
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  const audio = Buffer.concat(Array.from({ length: 6 }, () => frame));
  const media = inspectMp3(audio);
  assert.equal(media.frames, 6);
  assert.ok(media.playable);
  assert.equal(inspectMp3(Buffer.from("not audio")).playable, false);
});

test("the import brings every song of the manifest that is missing", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  await fs.writeFile(path.join(catalogue, "az-go-forth.mp3"), "already here");
  const manifest = path.join(root, "imports.txt");
  await fs.writeFile(manifest, [
    "az-go-forth.mp3 | /know/go_forth.opus |",
    "az-love-leads.mp3 | /know/love.opus |"
  ].join("\n"));

  const summary = await importSongs({
    manifestPath: manifest,
    catalogueDirectory: catalogue,
    transcode: async ({ outputPath }) => {
      await fs.writeFile(outputPath, syntheticMp3());
      return outputPath;
    }
  });

  assert.equal(summary.manifest, 2);
  assert.equal(summary.pending, 1, "only the song that is missing is imported");
  assert.equal(summary.imported, 1);
});

test("the station reads the imported song like any other", async () => {
  const root = await makeTempDir();
  const catalogue = path.join(root, "audio");
  await fs.mkdir(catalogue, { recursive: true });
  const frame = Buffer.alloc(Math.floor((144 * 128000) / 44100));
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  await fs.writeFile(
    path.join(catalogue, "az-god-remembers.mp3"),
    Buffer.concat(Array.from({ length: 6 }, () => frame))
  );

  const tracks = await scanCatalogue({ directory: catalogue });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].engine, "az");
  assert.equal(tracks[0].topic, "god-remembers");
});

test("the pyash ceremony runs the import command", async () => {
  forget();
  await run('from filename "./world/house/radio/module/radio_import.pya" to name radio import be import do');
  await run('ob text "printf radio-import-up" to name text radio import command be text do');

  const result = await run("su name radio import stage be radio import run do");

  const output = String(result?.result?.text ?? result?.ob?.text ?? "");
  assert.match(output, /radio-import-up/u);
  forget();
});
