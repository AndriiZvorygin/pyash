#!/usr/bin/env node
// The Yiniana catalogue tags.
//
// The station plays songs; a listener plays them in a player, and a player
// shows what the file says about itself. This command writes those tags into
// every song of the catalogue.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

import { readId3Tags } from "../program/library/radio/id3.mjs";
import { readManifestDates, tagCatalogue } from "../command/yiniana_tag_catalogue.mjs";

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(Math.floor((144 * 128000) / 44100));
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function makeTempDir(prefix = "yiniana-catalogue-tags-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function run(line) {
  return interpret(parse(line));
}

test("the tags of every song of the catalogue are written into the songs", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  await fs.mkdir(audio, { recursive: true });
  const source = path.join(root, "house-song.opus");
  await fs.writeFile(source, "the song the house made");
  await fs.utimes(source, new Date(2026, 10, 22), new Date(2026, 10, 22));
  await fs.writeFile(path.join(audio, "az-mirror-stranger.mp3"), syntheticMp3());
  await fs.writeFile(path.join(audio, "ace-step-grace.mp3"), syntheticMp3());
  const manifest = path.join(root, "imports.txt");
  await fs.writeFile(manifest, [
    "az-mirror-stranger.mp3 | " + source + " | | Lover Is Closer"
  ].join("\n"));

  const summary = await tagCatalogue({
    manifestPath: manifest,
    catalogueDirectory: audio,
    cwd: root
  });

  assert.equal(summary.songs, 2);
  assert.equal(summary.stamped, 2);
  const house = readId3Tags(await fs.readFile(path.join(audio, "az-mirror-stranger.mp3")));
  assert.equal(house.title, "Lover Is Closer");
  assert.equal(house.artist, "Andrii Zvorygin");
  assert.equal(house.album, "Zvorygin Radio");
  assert.equal(house.date, "2026-11-22", "the song of the house carries the day it was made");
  const rendered = readId3Tags(await fs.readFile(path.join(audio, "ace-step-grace.mp3")));
  assert.equal(rendered.title, "Grace");
  assert.equal(rendered.artist, "Zvorygin Radio");
  assert.match(rendered.comment, /ACE-Step 1\.5 XL turbo/u, "the song says what made it");
  assert.match(rendered.date, /^\d{4}-\d{2}-\d{2}$/u);

  const again = await tagCatalogue({ manifestPath: manifest, catalogueDirectory: audio, cwd: root });
  assert.equal(again.stamped, 0, "the songs that already carry the tags are not written again");
  await fs.rm(root, { recursive: true, force: true });
});

test("a manifest that is not there leaves the catalogue to its own days", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  await fs.mkdir(audio, { recursive: true });
  await fs.writeFile(path.join(audio, "ace-step-grace.mp3"), syntheticMp3());

  const manifest = await readManifestDates("imports.txt", root);
  assert.deepEqual(manifest, [], "there is no manifest to read");

  const summary = await tagCatalogue({
    manifestPath: "imports.txt",
    catalogueDirectory: audio,
    cwd: root
  });
  assert.equal(summary.songs, 1);
  assert.equal(summary.stamped, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("the pyash ceremony runs the tag command", async () => {
  forget();
  await run('from filename "./module/radio_tags.pya" to name radio tags be import do');
  await run('ob text "printf radio-tags-up" to name text radio tags command be text do');

  const result = await run("su name radio tags stage be radio tags run do");

  const output = String(result?.result?.text ?? result?.ob?.text ?? "");
  assert.match(output, /radio-tags-up/u);
  forget();
});
