import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

import { id3v2Size, measureMp3Buffer, parseFrameHeader } from "../program/library/radio/mp3.mjs";
import { parseTrackName, publicCatalogue, scanCatalogue } from "../program/library/radio/catalogue.mjs";
import { renderStationPage } from "../program/library/radio/page.mjs";
import { createRadioStation } from "../program/library/radio/station.mjs";
import { createRadioServer, formatHost } from "../command/yiniana_radio.mjs";

const FRAME_BYTES = Math.floor((144 * 128000) / 44100);
const FRAME_SECONDS = 1152 / 44100;

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

function taggedMp3(audio, { size = 64 } = {}) {
  const header = Buffer.alloc(10);
  header.write("ID3", 0, "latin1");
  header[3] = 4;
  header[6] = (size >>> 21) & 0x7f;
  header[7] = (size >>> 14) & 0x7f;
  header[8] = (size >>> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, Buffer.alloc(size), audio]);
}

async function makeTempDir(prefix = "yiniana-radio-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeTrack(root, name, { frames = 6, tagged = false } = {}) {
  const audio = syntheticMp3({ frames });
  const filePath = path.join(root, name);
  await fs.writeFile(filePath, tagged ? taggedMp3(audio) : audio);
  const media = measureMp3Buffer(tagged ? taggedMp3(audio) : audio);
  return {
    filename: name,
    path: filePath,
    title: name.replace(/\.mp3$/u, ""),
    topic: "dignity",
    engine: "ace-step",
    durationSeconds: media.durationSeconds,
    dataOffset: media.dataOffset,
    frameOffsets: media.frameOffsets,
    frameSeconds: media.frameSeconds
  };
}

function fakeClient({ writableLength = 0 } = {}) {
  const chunks = [];
  return {
    chunks,
    destroyed: false,
    writableEnded: false,
    writableLength,
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    destroy() {
      this.destroyed = true;
    },
    on() {
      return this;
    }
  };
}

async function waitFor(predicate, { timeoutMs = 3000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

async function run(line) {
  return interpret(parse(line));
}

test("the mp3 reader finds the audio behind an id3 tag", () => {
  const audio = syntheticMp3({ frames: 10 });
  const tagged = taggedMp3(audio);

  assert.equal(id3v2Size(tagged), 74);
  assert.equal(id3v2Size(audio), 0);

  const media = measureMp3Buffer(tagged);
  assert.equal(media.frames, 10);
  assert.equal(media.dataOffset, 74);
  assert.ok(Math.abs(media.durationSeconds - 10 * FRAME_SECONDS) < 0.001);
  assert.equal(media.sampleRate, 44100);
  assert.equal(media.channels, 2);
  assert.equal(media.frameOffsets[0], 74);
  assert.equal(media.frameOffsets[1], 74 + FRAME_BYTES);
});

test("the mp3 reader refuses bytes that are not a frame", () => {
  assert.equal(parseFrameHeader(Buffer.from("not audio at all"), 0), null);
  const media = measureMp3Buffer(Buffer.from("not audio at all"));
  assert.equal(media.frames, 0);
  assert.equal(media.durationSeconds, 0);
});

test("the catalogue reads the engine and the topic from the file name", () => {
  assert.deepEqual(parseTrackName("ace-step-dignity.mp3"), {
    engine: "ace-step",
    topic: "dignity",
    title: "Dignity"
  });
  assert.deepEqual(parseTrackName("yue2-dignity-reference-shape.mp3"), {
    engine: "yue2",
    topic: "dignity-reference-shape",
    title: "Dignity Reference Shape"
  });
  const unknown = parseTrackName("mystery-tune.mp3");
  assert.equal(unknown.engine, "");
  assert.equal(unknown.topic, "mystery-tune");
});

test("the catalogue keeps only the audio it can play", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(audio, { recursive: true });
  await fs.mkdir(lyrics, { recursive: true });
  await fs.writeFile(path.join(audio, "ace-step-dignity.mp3"), syntheticMp3({ frames: 8 }));
  await fs.writeFile(path.join(audio, "broken.mp3"), "this is not audio");
  await fs.writeFile(path.join(audio, "STYLES.txt"), "notes");
  await fs.writeFile(path.join(lyrics, "song-dignity.txt"), "a sheet");

  const tracks = await scanCatalogue({ directory: audio, lyricsDirectory: lyrics });

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].filename, "ace-step-dignity.mp3");
  assert.equal(tracks[0].engine, "ace-step");
  assert.equal(tracks[0].topic, "dignity");
  assert.ok(tracks[0].durationSeconds > 0);
  assert.equal(path.basename(tracks[0].lyricSheet), "song-dignity.txt");
});

test("the catalogue of a folder that is not there is empty", async () => {
  const tracks = await scanCatalogue({ directory: "/nowhere/at/all", lyricsDirectory: "/nowhere/at/all" });
  assert.deepEqual(tracks, []);
});

test("the catalogue keeps its private details to itself", async () => {
  const root = await makeTempDir();
  await writeTrack(root, "ace-step-dignity.mp3");
  const tracks = await scanCatalogue({ directory: root });
  const published = publicCatalogue(tracks);
  assert.equal(published.length, 1);
  assert.deepEqual(Object.keys(published[0]).sort(), [
    "durationSeconds",
    "engine",
    "filename",
    "lyricSheet",
    "title",
    "topic"
  ]);
});

test("the station plays the catalogue and says what is playing", async () => {
  const root = await makeTempDir();
  const track = await writeTrack(root, "ace-step-dignity.mp3", { frames: 40 });
  const station = createRadioStation({ tracks: [track], gapMs: 0 });
  const client = fakeClient();
  station.subscribe(client);
  station.start();

  const heard = await waitFor(() => client.chunks.length > 0);
  assert.ok(heard, "the listener heard nothing");
  assert.ok(client.chunks[0].length > 0);
  assert.equal(station.state().track.filename, "ace-step-dignity.mp3");
  assert.equal(station.state().total, 1);
  assert.equal(station.state().listeners, 1);
  station.stop();
});

test("the station moves on to the next track when the song ends", async () => {
  const root = await makeTempDir();
  const first = await writeTrack(root, "ace-step-dignity.mp3", { frames: 4 });
  const second = await writeTrack(root, "ace-step-peace.mp3", { frames: 4 });
  const station = createRadioStation({ tracks: [first, second], gapMs: 10 });
  station.start();

  const moved = await waitFor(() => station.state().index === 1);
  assert.ok(moved, "the station stayed on the first track");
  assert.equal(station.state().track.filename, "ace-step-peace.mp3");
  station.stop();
});

test("the station drops a listener that cannot keep up", async () => {
  const root = await makeTempDir();
  const track = await writeTrack(root, "ace-step-dignity.mp3", { frames: 40 });
  const station = createRadioStation({ tracks: [track], gapMs: 0 });
  const slow = fakeClient({ writableLength: 8 * 1024 * 1024 });
  station.subscribe(slow);
  station.start();

  const dropped = await waitFor(() => slow.destroyed);
  assert.ok(dropped, "the slow listener was not dropped");
  assert.equal(station.state().listeners, 0);
  station.stop();
});

test("the station stays quiet when the catalogue is empty", async () => {
  const station = createRadioStation({ tracks: [], gapMs: 0 });
  station.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(station.state().track, null);
  assert.equal(station.state().playing, false);
  assert.equal(station.state().total, 0);
  station.stop();
});

test("a fresh catalogue keeps the song that is playing", async () => {
  const root = await makeTempDir();
  const track = await writeTrack(root, "ace-step-dignity.mp3", { frames: 40 });
  const station = createRadioStation({ tracks: [track], gapMs: 0 });
  station.start();
  await waitFor(() => station.state().track);

  station.setTracks([track]);

  assert.equal(station.state().track.filename, "ace-step-dignity.mp3");
  assert.equal(station.state().index, 0);
  station.stop();
});

test("an ipv6 address in a url is written in brackets", () => {
  assert.equal(formatHost("::"), "[::]");
  assert.equal(formatHost("eb22:3b21:2100:e8c1::"), "[eb22:3b21:2100:e8c1::]");
  assert.equal(formatHost("0.0.0.0"), "0.0.0.0");
  assert.equal(formatHost(""), "");
});

test("the station page carries the station name and the stream", () => {  const page = renderStationPage({ stationName: "Yiniana Radio", streamUrl: "/stream.mp3" });
  assert.match(page, /Yiniana Radio/u);
  assert.match(page, /\/stream\.mp3/u);
  assert.match(page, /<audio/u);
});

test("the station answers over http", async () => {
  const root = await makeTempDir();
  const track = await writeTrack(root, "ace-step-dignity.mp3", { frames: 40 });
  const station = createRadioStation({ tracks: [track], gapMs: 0 });
  station.start();
  const { server } = createRadioServer({ station, stationName: "Yiniana Radio" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).tracks, 1);

  const playlist = await fetch(`${base}/playlist.json`);
  const listed = await playlist.json();
  assert.equal(listed.tracks[0].filename, "ace-step-dignity.mp3");

  const status = await fetch(`${base}/status.json`);
  const state = await status.json();
  assert.equal(state.station, "Yiniana Radio");
  assert.equal(state.track.filename, "ace-step-dignity.mp3");

  const page = await fetch(`${base}/`);
  assert.match(await page.text(), /Yiniana Radio/u);

  const missing = await fetch(`${base}/nowhere`);
  assert.equal(missing.status, 404);

  const stream = await fetch(`${base}/stream.mp3`);
  assert.equal(stream.headers.get("content-type"), "audio/mpeg");
  const reader = stream.body.getReader();
  const first = await reader.read();
  assert.ok(first.value.length > 0, "the stream carried no audio");
  await reader.cancel();

  await new Promise((resolve) => server.close(resolve));
  station.stop();
});

test("a malformed request does not take the station down", async () => {
  const root = await makeTempDir();
  const track = await writeTrack(root, "ace-step-dignity.mp3", { frames: 40 });
  const station = createRadioStation({ tracks: [track], gapMs: 0 });
  station.start();
  const { server } = createRadioServer({ station, stationName: "Yiniana Radio" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  // A request target that is not a url at all: the station must answer it
  // and keep playing.
  const raw = await new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write("GET //%2e%2e%2f%2eenv HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
    });
    socket.on("close", () => resolve(text));
    socket.on("error", () => resolve(text));
    setTimeout(() => socket.destroy(), 2000);
  });
  assert.match(raw, /^HTTP\/1\.1 400/u);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);

  await new Promise((resolve) => server.close(resolve));
  station.stop();
});

test("the pyash ceremony runs the station command", async () => {
  forget();
  await run('from filename "./module/radio_station.pya" to name radio station be import do');
  await run('ob text "printf radio-station-up" to name text radio station command be text do');

  const result = await run("su name radio server stage be radio station serve do");

  const output = String(result?.result?.text ?? result?.ob?.text ?? "");
  assert.match(output, /radio-station-up/u);
  forget();
});
