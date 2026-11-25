#!/usr/bin/env node
// The tag at the head of an mp3.
//
// A song can carry its own name in the tag. The house gave the songs it made
// before the radio their real titles, and the station shows the title a file
// carries rather than the lane the file was named for.

import test from "node:test";
import assert from "node:assert/strict";

import { id3Frames, id3v2Size, readId3Tags, readId3Title, writeId3Tags } from "../program/library/radio/id3.mjs";
import { measureMp3Buffer } from "../program/library/radio/mp3.mjs";

const FRAME_BYTES = Math.floor((144 * 128000) / 44100);

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

function synchsafe(value) {
  const bytes = Buffer.alloc(4);
  bytes[0] = (value >>> 21) & 0x7f;
  bytes[1] = (value >>> 14) & 0x7f;
  bytes[2] = (value >>> 7) & 0x7f;
  bytes[3] = value & 0x7f;
  return bytes;
}

function buildFrame(id, data) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, "latin1");
  synchsafe(data.length).copy(header, 4);
  return Buffer.concat([header, data]);
}

function taggedMp3(frames, audio = syntheticMp3()) {
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write("ID3", 0, "latin1");
  header[3] = 4;
  synchsafe(body.length).copy(header, 6);
  return Buffer.concat([header, body, audio]);
}

test("a file that carries no title has no title to read", () => {
  const audio = syntheticMp3();

  assert.equal(id3v2Size(audio), 0, "there is no tag at the head of the file");
  assert.equal(readId3Title(audio), "");
  assert.deepEqual(id3Frames(audio), [], "there are no frames to walk");
});

test("the title of a file is the title its tag carries", () => {
  const titleFrame = buildFrame("TIT2", Buffer.concat([
    Buffer.from([0x03]),
    Buffer.from("Lover Is Closer", "utf8"),
    Buffer.from([0])
  ]));
  const tagged = taggedMp3([titleFrame]);

  assert.equal(id3v2Size(tagged), 10 + titleFrame.length);
  assert.equal(readId3Title(tagged), "Lover Is Closer");
});

test("a title written onto a file can be read back, and the audio is untouched", () => {
  const audio = syntheticMp3({ frames: 8 });
  const tagged = writeId3Tags(audio, { title: "Polish the Armour of Light" });

  assert.equal(readId3Title(tagged), "Polish the Armour of Light");
  assert.ok(tagged.includes(audio), "the audio the station plays is still there");
  const media = measureMp3Buffer(tagged);
  assert.equal(media.frames, 8, "the station still finds every frame");
  assert.equal(media.durationSeconds, measureMp3Buffer(audio).durationSeconds);
});

test("a title written twice is the title that was written last", () => {
  const once = writeId3Tags(syntheticMp3(), { title: "A Seed Planted" });
  const twice = writeId3Tags(once, { title: "A Seed Was Planted" });

  assert.equal(readId3Title(twice), "A Seed Was Planted");
  assert.equal(id3Frames(twice).filter((frame) => frame.id === "TIT2").length, 1, "there is one title, not two");
});

test("a title written onto a file keeps the frames the file already carried", () => {
  const prompt = buildFrame("TXXX", Buffer.concat([
    Buffer.from([0x03]),
    Buffer.from("prompt\0", "utf8"),
    Buffer.from("{\"3\": \"inputs\"}", "utf8")
  ]));
  const tagged = writeId3Tags(taggedMp3([prompt]), { title: "God Remembers All" });

  const frames = id3Frames(tagged);
  assert.deepEqual(frames.map((frame) => frame.id), ["TXXX", "TIT2"], "the prompt is still in the tag");
  assert.equal(readId3Title(tagged), "God Remembers All");
});

test("a tag the writer does not know is left alone rather than rewritten from a guess", () => {
  const audio = syntheticMp3();
  const header = Buffer.alloc(10);
  header.write("ID3", 0, "latin1");
  header[3] = 4;
  header[5] = 0x02;
  synchsafe(4).copy(header, 6);
  const tagged = Buffer.concat([header, Buffer.alloc(4), audio]);

  assert.equal(readId3Title(tagged), "");
  assert.equal(writeId3Tags(tagged, { title: "True Power" }), tagged, "the file is left as it was");
});

test("an empty title is not a title, and a file that is not audio is not touched", () => {
  const audio = syntheticMp3();

  assert.equal(writeId3Tags(audio, { title: "   " }), audio, "an empty title changes nothing");
  assert.equal(writeId3Tags("not audio", { title: "Lover Is Closer" }), "not audio");
});

test("a player reads the tags of a song from the tag of the file", () => {
  const tagged = writeId3Tags(syntheticMp3(), {
    title: "Lover Is Closer",
    artist: "Andrii Zvorygin",
    album: "Yiniana Radio",
    date: "2026-11-22",
    year: "2026",
    comment: "Yiniana Radio · Andrii Zvorygin · mirror-stranger"
  });

  const tags = readId3Tags(tagged);
  assert.equal(tags.title, "Lover Is Closer");
  assert.equal(tags.artist, "Andrii Zvorygin");
  assert.equal(tags.album, "Yiniana Radio");
  assert.equal(tags.date, "2026-11-22");
  assert.equal(tags.year, "2026");
  assert.equal(tags.comment, "Yiniana Radio · Andrii Zvorygin · mirror-stranger");
  assert.deepEqual(id3Frames(tagged).map((frame) => frame.id), ["TIT2", "TPE1", "TALB", "TDRC", "TYER", "COMM"]);
});

test("the tags of a song are written over the tags the file carried", () => {
  const once = writeId3Tags(syntheticMp3(), { title: "A Seed Planted", artist: "Yiniana Radio" });
  const twice = writeId3Tags(once, { title: "A Seed Was Planted", artist: "Andrii Zvorygin" });

  const tags = readId3Tags(twice);
  assert.equal(tags.title, "A Seed Was Planted");
  assert.equal(tags.artist, "Andrii Zvorygin");
  assert.deepEqual(id3Frames(twice).map((frame) => frame.id), ["TIT2", "TPE1"]);
});

test("a tag the house has decided against does not linger", () => {
  const tagged = writeId3Tags(syntheticMp3(), { title: "Grace", date: "2026-11-22", year: "2026" });
  assert.deepEqual(id3Frames(tagged).map((frame) => frame.id), ["TIT2", "TDRC", "TYER"]);

  const cleaned = writeId3Tags(tagged, { year: null });
  assert.deepEqual(id3Frames(cleaned).map((frame) => frame.id), ["TIT2", "TDRC"]);
  assert.equal(readId3Tags(cleaned).date, "2026-11-22", "the day of the song is still there");
});
