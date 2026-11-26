#!/usr/bin/env node
// The name of a song.
//
// The house asks the mind for the name of a song, and the mind answers in
// words. The name is what the song is called on the air and in a player, so
// the house reads the answer itself: a reply that cannot be read as a name is
// no name, and the line the song repeats is the name instead.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../../../../program/understand/index.mjs";
import { interpret } from "../../../../program/bridge/index.mjs";
import { forget } from "../../../../program/remember/index.mjs";
import { lookupSignature } from "../../../../program/bridge/signature/registry.mjs";

import {
  MAX_NAME_WORDS,
  extractSongName,
  firstClauses,
  shortenName,
  songName,
  splitSongNameInput,
  stripDecorations,
  stripLabel,
  titleCase
} from "../command/extract_song_name.mjs";
import { songHook } from "../command/song_hook.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SHEET = [
  "[Verse]",
  "We serve the neighbor and our own heart grows bright.",
  "",
  "[Chorus]",
  "We serve each other with love and light while hearts ignite.",
  "",
  "[Verse]",
  "We lift the hand to help the weary walk the steep hill.",
  "",
  "[Chorus]",
  "We serve each other with love and light while hearts ignite.",
  ""
].join("\n");

async function run(line) {
  return interpret(parse(line));
}

test("the name the mind gave is read out of the words it used", () => {
  assert.equal(extractSongName("Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("  Fresh Light for Valentina  "), "Fresh Light for Valentina");
  assert.equal(extractSongName("Go Forth in Your Armour of Light"), "Go Forth in Your Armour of Light");
});

test("the furniture around a name is thrown away", () => {
  assert.equal(extractSongName("\"Love Expands the Light\""), "Love Expands the Light");
  assert.equal(extractSongName("**Love Expands the Light**"), "Love Expands the Light");
  assert.equal(extractSongName("- Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("1. Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("Name: Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("The name of this song is: Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("The song is called Love Expands the Light"), "Love Expands the Light");
  assert.equal(extractSongName("Love Expands the Light — a song about love"), "Love Expands the Light");
  assert.equal(extractSongName("Here is a name:\nLove Expands the Light"), "Love Expands the Light");
});

test("a reply that is not a name is no name", () => {
  assert.equal(extractSongName(""), "", "an empty reply names nothing");
  assert.equal(extractSongName("   \n  \n"), "", "a blank reply names nothing");
  assert.equal(
    extractSongName("The song repeats the phrase love expands the light in every chorus."),
    "",
    "a sentence is not a name"
  );
  assert.equal(
    extractSongName("Sure, here is the name of the song."),
    "",
    "the talk around a name is not the name"
  );
  assert.equal(extractSongName("Is it Love Expands the Light?"), "", "a question is not a name");
});

test("a name that is too long keeps its first clause", () => {
  assert.equal(
    extractSongName("We Serve Each Other With Love And Light While Hearts Ignite"),
    "We Serve Each Other with Love and Light",
    "the name stops before the word that joins two halves of a line"
  );
  assert.equal(
    extractSongName("You are welcome to join us here today, where open gates let peace softly play."),
    "You Are Welcome to Join Us Here Today",
    "the name stops before the comma"
  );
  assert.equal(
    shortenName("Love Expands the Light"),
    "Love Expands the Light",
    "a name that already fits is left alone"
  );
  assert.deepEqual(
    firstClauses("Turn mercy inward overflow outward and heal your own heart today"),
    ["Turn mercy inward overflow outward"],
    "the clause of a line is the part before the word that joins two halves"
  );
  assert.deepEqual(
    firstClauses("You are welcome to join us here today, where open gates let peace softly play."),
    ["You are welcome to join us here today", "You are welcome to join us here today"],
    "a comma and a joining word cut the line in the same place"
  );
});

test("a name is written in title case, with the small words small", () => {
  assert.equal(titleCase("love expands the light"), "Love Expands the Light");
  assert.equal(titleCase("every walk one in christ"), "Every Walk One in Christ");
  assert.equal(titleCase("LOVE EXPANDS THE LIGHT"), "Love Expands the Light");
  assert.equal(titleCase("the armour of light"), "The Armour of Light");
  assert.equal(titleCase("light in the hand"), "Light in the Hand");
});

test("the parts of a name are read apart", () => {
  assert.equal(stripDecorations("- **Love Expands the Light**"), "Love Expands the Light");
  assert.equal(stripLabel("Name: Love Expands the Light"), "Love Expands the Light");
  assert.equal(stripLabel("Love Expands the Light"), "Love Expands the Light");
});

test("a name is at most a handful of words", () => {
  assert.equal(MAX_NAME_WORDS, 10);
  const long = Array.from({ length: MAX_NAME_WORDS + 1 }, () => "light").join(" ");
  assert.equal(extractSongName(long), "", "a name with nothing to cut is not a name");
  const exact = Array.from({ length: MAX_NAME_WORDS }, () => "light").join(" ");
  assert.equal(extractSongName(exact), "Light Light Light Light Light Light Light Light Light Light");
});

test("the line a song repeats is the name the house falls back on", () => {
  assert.equal(
    songHook(SHEET),
    "We serve each other with love and light while hearts ignite.",
    "the line the sheet sings twice is the hook of the song"
  );
  assert.equal(
    songName({ reply: "Love Expands the Light", sheet: SHEET }),
    "Love Expands the Light",
    "the name the mind gave is the name of the song"
  );
  assert.equal(
    songName({ reply: "", sheet: SHEET }),
    "We Serve Each Other with Love and Light",
    "the line the song repeats is the name when the mind gave none"
  );
  assert.equal(songName({ reply: "", sheet: "" }), "", "nothing at all names nothing");
});

test("the answer of the mind and the sheet are read apart", () => {
  const input = [
    "THE NAME THE MIND GAVE:",
    "Love Expands the Light",
    "",
    "THE SHEET:",
    SHEET
  ].join("\n");
  const parts = splitSongNameInput(input);
  assert.equal(parts.reply, "Love Expands the Light");
  assert.match(parts.sheet, /^\[Verse\]/u);
  assert.equal(songName(parts), "Love Expands the Light");
});

test("the house keeps the naming ceremony and the prompt it reads", async () => {
  const moduleText = await fs.readFile(path.join(repoRoot, "world", "house", "radio", "module", "radio_song_name.pya"), "utf8");
  assert.match(moduleText, /exists su name radio song name prompt ob text quoted\.text\./u);
  assert.match(moduleText, /exists su name radio song name mind be mind fromtext name radio song name prompt ya/u);
  assert.match(
    moduleText,
    /su name radio song name from text sheet to name text song name out be ceremony def/u
  );
  assert.match(moduleText, /node world\/house\/radio\/command\/extract_song_name\.mjs/u, "the answer is read by the house");

  const exampleText = await fs.readFile(
    path.join(repoRoot, "world", "house", "radio", "examples", "yiniana-radio-song-name.pya"),
    "utf8"
  );
  assert.match(exampleText, /from filename "\.\.\/module\/radio_song_name\.pya" to name radio song name be import do/u);
  assert.match(exampleText, /ob ve filename text sheet filename text target be input ya/u);
});

test("the naming ceremony is part of the house", async () => {
  forget();
  await run('from filename "./world/house/radio/module/radio_song_name.pya" to name radio song name be import do');

  const ceremony = lookupSignature("be radio song name from text to name text");
  assert.ok(
    String(ceremony ?? "").endsWith("radio song name"),
    "the house can ask for the name of a song"
  );

  forget();
});
