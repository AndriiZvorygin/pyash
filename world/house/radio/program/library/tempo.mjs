// The tempo of a song.
//
// A radio that plays at one pace is a radio that never rests. The house wants
// a night programme as well as a day one, and to build it the house has to
// know how fast each song actually is — not what it was asked for, but what it
// is.
//
// The tempo is measured from the song itself: the audio is decoded, the
// strength of every onset is counted, and the beat is the one the onsets agree
// on. The work is the ordinary way music is measured: a spectrum, the rise of
// every frequency between one moment and the next, and the rhythm those rises
// keep.
//
// No Python and no library: the house does this in Node, in the same style as
// the rest of the radio.

import { spawn } from "node:child_process";

// The audio is measured at this rate: high enough to hear the beat of a slow
// song, low enough to keep the work quick.
const SAMPLE_RATE = 22050;
// The window of one moment of music, and how far the window moves.
const FRAME_SIZE = 2048;
const HOP_SIZE = 512;
// The tempi the house plays: a slow night song and a fast day one.
const MIN_BPM = 50;
const MAX_BPM = 200;
// The tempo the house believes a song is most likely to be at, when the
// measurement cannot tell one beat from another.
const LIKELY_BPM = 120;
// The bands of the spectrum that carry the beat: the kick and the bass.
const BEAT_BAND_FROM = 1;
const BEAT_BAND_TO = 16;

/**
 * Run a command and collect what it writes to its standard output.
 */
function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`${command} failed with status ${code}: ${stderr.trim().slice(-300)}`));
    });
  });
}

/**
 * The audio of a song, as the house hears it: one voice, sixteen-bit samples.
 */
export async function decodeAudio(audioPath, { ffmpeg = "ffmpeg", sampleRate = SAMPLE_RATE } = {}) {
  const raw = await capture(ffmpeg, [
    "-v", "error", "-i", audioPath,
    "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-"
  ]);
  const samples = new Float32Array(Math.floor(raw.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = raw.readInt16LE(index * 2) / 32768;
  }
  return { samples, sampleRate };
}

/**
 * The spectrum of a window of music: what frequencies are loud in it.
 *
 * The transform is the ordinary one: the signal is split into even and odd
 * parts, each part is transformed again, and the parts are put back together.
 */
export function spectrum(frame) {
  const size = frame.length;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  real.set(frame);
  // The order the transform wants the samples in.
  for (let index = 1, swap = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      const held = real[index];
      real[index] = real[swap];
      real[swap] = held;
      const turned = imag[index];
      imag[index] = imag[swap];
      imag[swap] = turned;
    }
  }
  // The transform itself: pairs of samples are put together, then pairs of
  // pairs, and so on, until the whole window is one sum.
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let turnReal = 1;
      let turnImag = 0;
      for (let step = 0; step < length / 2; step += 1) {
        const even = start + step;
        const odd = even + length / 2;
        const oddReal = real[odd] * turnReal - imag[odd] * turnImag;
        const oddImag = real[odd] * turnImag + imag[odd] * turnReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = turnReal * stepReal - turnImag * stepImag;
        turnImag = turnReal * stepImag + turnImag * stepReal;
        turnReal = nextReal;
      }
    }
  }
  const half = size / 2;
  const magnitude = new Float64Array(half);
  for (let index = 0; index < half; index += 1) {
    magnitude[index] = Math.hypot(real[index], imag[index]);
  }
  return magnitude;
}

/**
 * How strong every onset of the song is.
 *
 * Between one moment and the next, every frequency is heard again. The
 * frequencies that grew are the ones that were struck: a drum, a chord, a
 * syllable. The strength of every onset is the sum of those rises.
 *
 * The low bands are the ones that are heard. The beat of a song lives in the
 * kick and the bass, and the notes above them are the song's own eighth notes
 * and sixteenth notes: a slow hymn counted in the low band keeps the beat the
 * listener taps, while counted in every band it answers with the double.
 */
export function onsetStrength(samples, {
  frameSize = FRAME_SIZE,
  hopSize = HOP_SIZE,
  from = BEAT_BAND_FROM,
  to = BEAT_BAND_TO
} = {}) {
  if (!samples.length) return [];
  const frames = Math.max(0, Math.floor((samples.length - frameSize) / hopSize));
  const strength = new Float64Array(frames);
  let previous = null;
  for (let index = 0; index < frames; index += 1) {
    const start = index * hopSize;
    const magnitude = spectrum(samples.subarray(start, start + frameSize));
    if (previous) {
      let rise = 0;
      for (let band = from; band < to && band < magnitude.length; band += 1) {
        const difference = magnitude[band] - previous[band];
        if (difference > 0) rise += difference;
      }
      strength[index] = rise;
    }
    previous = magnitude;
  }
  const out = [];
  for (let index = 0; index < strength.length; index += 1) {
    // The quiet parts of the song are not onsets; the loud ones are.
    out.push(Math.log1p(strength[index]));
  }
  return out;
}

/**
 * The tempo of a rhythm: the beat that the onsets keep.
 *
 * The onsets are compared with themselves, later and later, and the delay that
 * they agree on is the beat. A rhythm that is felt in half time and counted in
 * full time gives two answers; the one the house believes more is the one
 * nearer the tempo a song is usually at.
 */
export function estimateTempo(strength, { frameRate = 43, minBpm = MIN_BPM, maxBpm = MAX_BPM, likelyBpm = LIKELY_BPM } = {}) {
  const onsets = Array.isArray(strength) ? strength : [];
  if (onsets.length < 32) return { bpm: 0, confidence: 0 };
  let mean = 0;
  for (const value of onsets) mean += value;
  mean /= onsets.length;
  const centred = onsets.map((value) => value - mean);
  let spread = 0;
  for (const value of centred) spread += value * value;
  spread = Math.sqrt(spread / centred.length) || 1;
  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(centred.length - 1, Math.ceil((60 * frameRate) / minBpm));
  let best = null;
  let bestScore = 0;
  const scores = new Map();
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let total = 0;
    for (let index = 0; index + lag < centred.length; index += 1) {
      total += centred[index] * centred[index + lag];
    }
    const score = total / ((centred.length - lag) * spread * spread);
    scores.set(lag, score);
    const bpm = (60 * frameRate) / lag;
    // A song is more often near the tempo a song is usually at than twice or
    // half of it.
    const belief = Math.exp(-0.5 * Math.pow(Math.log2(bpm / likelyBpm) / 0.9, 2));
    const value = score * belief;
    if (!best || value > best.value) {
      best = { lag, score, bpm, value };
      bestScore = score;
    }
  }
  if (!best) return { bpm: 0, confidence: 0 };
  // The beat falls between two delays as often as it falls on one, so the
  // delay is read off the curve around the peak.
  const before = scores.get(best.lag - 1) ?? bestScore;
  const after = scores.get(best.lag + 1) ?? bestScore;
  const shift = (0.5 * (before - after)) / (before - 2 * bestScore + after || 1);
  const lag = best.lag + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);
  return {
    bpm: Number(((60 * frameRate) / lag).toFixed(1)),
    confidence: Number(Math.max(0, Math.min(1, bestScore)).toFixed(3))
  };
}

/**
 * The tempo of a song, measured from its audio.
 *
 * The pace a song is counted in is a matter of convention: a slow hymn keeps
 * the same periodicity at twice the pace, and the measurement has to choose one
 * of them. The house's choice is the pace the channel asked for, so the
 * measurement answers the question the channel is really asking: is this song
 * as slow as the programme says it is?
 */
export async function measureTempo(audioPath, {
  ffmpeg = "ffmpeg",
  sampleRate = SAMPLE_RATE,
  frameSize = FRAME_SIZE,
  hopSize = HOP_SIZE,
  likelyBpm = LIKELY_BPM
} = {}) {
  const { samples } = await decodeAudio(audioPath, { ffmpeg, sampleRate });
  const strength = onsetStrength(samples, { frameSize, hopSize });
  const tempo = estimateTempo(strength, { frameRate: sampleRate / hopSize, likelyBpm });
  return tempo;
}
