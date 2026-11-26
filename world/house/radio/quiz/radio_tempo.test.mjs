#!/usr/bin/env node
// The tempo of a song.
//
// The house measures the pace of a song from the song itself: the audio is
// decoded, the strength of every onset is counted, and the beat is the one
// the onsets agree on.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { estimateTempo, measureTempo, onsetStrength, spectrum } from "../program/library/tempo.mjs";

const SAMPLE_RATE = 22050;

async function makeTempDir(prefix = "yiniana-tempo-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * The bytes of a wav file that holds the samples.
 */
function wavBytes(samples, sampleRate = SAMPLE_RATE) {
  const total = samples.length;
  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36 + total * 2, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(total * 2, 40);
  for (let index = 0; index < total; index += 1) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), 44 + index * 2);
  }
  return buffer;
}

/**
 * A wav of claps: a short burst of noise every so many seconds. The beat of
 * the file is the beat of the claps.
 */
function clapWav({ bpm = 120, seconds = 12, sampleRate = SAMPLE_RATE } = {}) {
  const total = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(total);
  const every = Math.floor((60 / bpm) * sampleRate);
  const clap = Math.floor(0.05 * sampleRate);
  let seed = 12345;
  for (let start = 0; start < total; start += every) {
    for (let index = 0; index < clap && start + index < total; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed / 0x3fffffff) - 1;
      const fall = 1 - index / clap;
      samples[start + index] = noise * 0.8 * fall;
    }
  }
  return wavBytes(samples, sampleRate);
}

test("the spectrum of a window of music says what is loud in it", () => {
  const size = 256;
  const frame = new Float32Array(size);
  // A tone of a quarter of the sample rate: it lies in the band of a quarter
  // of the window.
  for (let index = 0; index < size; index += 1) {
    frame[index] = Math.sin((2 * Math.PI * (size / 4) * index) / size);
  }

  const magnitude = spectrum(frame);

  assert.equal(magnitude.length, size / 2);
  const loudest = magnitude.indexOf(Math.max(...magnitude));
  assert.ok(Math.abs(loudest - size / 4) <= 1, `the loudest band is the one that was sung (${loudest})`);
});

test("the strength of the onsets follows the beats of the song", () => {
  const bpm = 120;
  const sampleRate = 22050;
  const total = Math.floor(12 * sampleRate);
  const samples = new Float32Array(total);
  const every = Math.floor((60 / bpm) * sampleRate);
  for (let start = 0; start < total; start += every) {
    for (let index = 0; index < 400 && start + index < total; index += 1) {
      samples[start + index] = 0.9 * (1 - index / 400);
    }
  }

  const strength = onsetStrength(samples, { frameSize: 1024, hopSize: 512 });

  assert.ok(strength.length > 100, "the song was heard in many moments");
  const strongest = strength.indexOf(Math.max(...strength));
  const framesPerBeat = every / 512;
  const near = Math.round(strongest / framesPerBeat) * framesPerBeat;
  assert.ok(Math.abs(strongest - near) <= 2, "the strongest onset falls on a beat");
});

test("the tempo of a rhythm is the beat the onsets agree on", () => {
  const frameRate = 43;
  const bpm = 120;
  const period = (60 / bpm) * frameRate;
  const onsets = Array.from({ length: 400 }, (_, index) => {
    const phase = index % period;
    return phase < 1.5 ? 1 : 0;
  });

  const measured = estimateTempo(onsets, { frameRate });

  assert.ok(Math.abs(measured.bpm - 120) < 2, `the beat was found at ${measured.bpm} bpm`);
  assert.ok(measured.confidence > 0, "the house is sure of the beat");
});

test("a rhythm that is too short to be a rhythm has no tempo", () => {
  const measured = estimateTempo([1, 0, 1, 0], { frameRate: 43 });
  assert.equal(measured.bpm, 0);
  assert.equal(measured.confidence, 0);
});

test("the tempo of a song is measured from the song itself", async () => {
  const root = await makeTempDir();
  const file = path.join(root, "claps.wav");
  await fs.writeFile(file, clapWav({ bpm: 120, seconds: 12 }));

  const measured = await measureTempo(file);

  assert.ok(measured.bpm > 100 && measured.bpm < 140, `the song was measured at ${measured.bpm} bpm`);

  const slow = path.join(root, "slow.wav");
  await fs.writeFile(slow, clapWav({ bpm: 75, seconds: 16 }));
  const slowMeasured = await measureTempo(slow);

  assert.ok(slowMeasured.bpm > 60 && slowMeasured.bpm < 90, `the slow song was measured at ${slowMeasured.bpm} bpm`);
  assert.ok(slowMeasured.bpm < measured.bpm, "the slow song is slower than the fast one");

  await fs.rm(root, { recursive: true, force: true });
});

/**
 * A wav of claps that keeps two beats at once: every clapper, and every
 * second clapper louder. The song can be counted at either pace, and the
 * channel decides which one the house is asking about.
 */
function ambiguousWav({ seconds = 16, sampleRate = SAMPLE_RATE } = {}) {
  const total = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(total);
  const every = Math.floor((60 / 150) * sampleRate);
  const clap = Math.floor(0.05 * sampleRate);
  let seed = 12345;
  let index = 0;
  for (let start = 0; start < total; start += every, index += 1) {
    const loud = index % 2 === 0 ? 0.9 : 0.35;
    for (let offset = 0; offset < clap && start + offset < total; offset += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed / 0x3fffffff) - 1;
      samples[start + offset] = noise * loud * (1 - offset / clap);
    }
  }
  return wavBytes(samples, sampleRate);
}

test("a slow song is counted at the pace the channel asked for", async () => {
  const root = await makeTempDir();
  const clear = path.join(root, "clear.wav");
  await fs.writeFile(clear, clapWav({ bpm: 75, seconds: 16 }));

  const counted = await measureTempo(clear, { likelyBpm: 128 });
  assert.ok(Math.abs(counted.bpm - 75) < 8, `a rhythm with one beat keeps it (${counted.bpm} bpm)`);

  const ambiguous = path.join(root, "ambiguous.wav");
  await fs.writeFile(ambiguous, ambiguousWav({ seconds: 16 }));

  const atNight = await measureTempo(ambiguous, { likelyBpm: 75 });
  const atDay = await measureTempo(ambiguous, { likelyBpm: 150 });
  assert.ok(Math.abs(atNight.bpm - 75) < 8, `the night channel counts it at ${atNight.bpm} bpm`);
  assert.ok(Math.abs(atDay.bpm - 150) < 10, `the day channel counts it at ${atDay.bpm} bpm`);

  await fs.rm(root, { recursive: true, force: true });
});
