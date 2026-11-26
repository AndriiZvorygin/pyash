#!/usr/bin/env node
// The Yiniana catalogue transcripts.
//
// The house hears every song it makes: the hear lane says what it hears, and
// the words that came back are kept with the song. That transcript is what a
// listener reads along with, because it carries the time of every line.
//
// A song that was made before the radio has no transcript yet. This walks the
// catalogue, listens to the songs that do not have one, and keeps what it
// hears beside the sheet of the song.
//
// The song is written beside the sheet and renamed onto it, so a half written
// transcript is never on the air.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { findLyricSheet, scanCatalogue } from "../program/library/radio/catalogue.mjs";
import { alignedPathFor, keepFile, transcriptPathFor } from "../program/library/radio/ticker.mjs";
import { alignWordsToFile } from "./lyrics_to_srt_from_timing.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_CATALOGUE = "radio/audio";

/**
 * Run a command and wait for it to finish.
 */
export function run(command, args, { cwd = process.cwd(), label = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      const error = new Error(`${label || command} failed with status ${code}: ${stderr.trim().slice(-400)}`);
      error.statusCode = code;
      reject(error);
    });
  });
}

/**
 * The song as the hear lane takes it: one voice, sixteen kilohertz.
 */
export function buildListenArgs({ audioPath, windowPath }) {
  return ["-v", "error", "-y", "-i", audioPath, "-ar", "16000", "-ac", "1", windowPath];
}

/**
 * Listen to one song and keep what was heard beside its sheet, with the
 * words of the song placed at the times it was heard.
 *
 * A song that was already heard is not heard again: the transcript that is
 * already there is enough to place the words.
 */
export async function transcribeSong({
  track,
  lyricsDirectory,
  workDirectory,
  repoRoot = process.cwd(),
  hearBin = "",
  hearModel = "",
  ffmpeg = "ffmpeg",
  runCommand = run,
  log = () => {}
}) {
  const sheetPath = track.lyricSheet || await findLyricSheet(lyricsDirectory, track.topic, track.engine);
  if (!sheetPath) return { name: track.filename, status: "no-sheet" };
  const heard = transcriptPathFor(sheetPath);
  const aligned = alignedPathFor(sheetPath);
  try {
    await fs.access(aligned);
    return { name: track.filename, status: "present" };
  } catch {
    // the words are not placed yet
  }  await fs.mkdir(workDirectory, { recursive: true });
  const stem = path.basename(track.filename, ".mp3");
  let transcript = heard;
  try {
    await fs.access(heard);
    log(`${track.filename} was heard before`);
  } catch {
    const windowPath = path.join(workDirectory, `${stem}.wav`);
    const transcriptPath = path.join(workDirectory, `${stem}.txt`);
    await runCommand(ffmpeg, buildListenArgs({ audioPath: track.path, windowPath }), { cwd: repoRoot, label: `listen ${stem}` });
    await runCommand(process.execPath, [
      path.join(repoRoot, "command", "whisper_main.mjs"),
      "--input", windowPath,
      "--bin", hearBin,
      "--model", hearModel,
      "--output", transcriptPath
    ], { cwd: repoRoot, label: `hear ${stem}` });
    transcript = transcriptPath.replace(/\.txt$/u, ".srt");
  }
  const placed = await alignWordsToFile({
    sheetPath,
    timingPath: transcript,
    outputPath: path.join(workDirectory, `${stem}.aligned.srt`),
    log
  });
  if (!placed) return { name: track.filename, status: "unplaced" };
  // The words that were heard are kept beside the sheet too: they are the
  // record of what the house heard, and they are what the words of the song
  // are placed against.
  const kept = transcript === heard
    ? heard
    : await keepFile({ from: transcript, to: heard });
  const placedAligned = await keepFile({
    from: path.join(workDirectory, `${stem}.aligned.srt`),
    to: aligned
  });
  log(`placed the words of ${track.filename}`);
  return { name: track.filename, status: "heard", transcript: kept, aligned: placedAligned };
}
/**
 * Listen to every song of the catalogue that has no transcript yet.
 */
export async function transcribeCatalogue({
  catalogueDirectory = DEFAULT_CATALOGUE,
  lyricsDirectory = "",
  workDirectory = "",
  repoRoot = process.cwd(),
  hearBin = "",
  hearModel = "",
  runCommand = run,
  log = () => {}
} = {}) {
  const tracks = await scanCatalogue({ directory: catalogueDirectory, lyricsDirectory });
  const summary = { songs: tracks.length, heard: 0, present: 0, failed: 0, transcripts: [] };
  for (const track of tracks) {
    try {
      const result = await transcribeSong({
        track,
        lyricsDirectory,
        workDirectory: workDirectory || path.join(repoRoot, "artifacts", "radio-producer"),
        repoRoot,
        hearBin,
        hearModel,
        runCommand,
        log
      });
      if (result.status === "heard") {
        summary.heard += 1;
        summary.transcripts.push(result.transcript);
      } else if (result.status === "present") {
        summary.present += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      log(`could not hear ${track.filename}: ${String(error?.message ?? error)}`);
    }
  }
  return summary;
}

/**
 * Read the settings from the pyash configuration surface and listen to the
 * songs that have no transcript.
 */
export async function startCatalogueTranscripts({ cwd = process.cwd() } = {}) {
  await loadDefaultConfig({ cwd, interpretFn: interpret });
  const catalogueDirectory = path.resolve(cwd, resolveConfigText("radio catalogue") || DEFAULT_CATALOGUE);
  const lyricsDirectory = path.join(path.dirname(catalogueDirectory), "lyrics");
  const summary = await transcribeCatalogue({
    catalogueDirectory,
    lyricsDirectory,
    repoRoot: cwd,
    hearBin: resolveConfigText("hear bin") ?? "",
    hearModel: resolveConfigText("hear model") ?? "",
    log: (line) => process.stdout.write(`yiniana transcripts: ${line}\n`)
  });
  process.stdout.write(`${JSON.stringify({
    songs: summary.songs,
    heard: summary.heard,
    present: summary.present,
    failed: summary.failed
  }, null, 2)}\n`);
  return summary;
}

async function main() {
  await startCatalogueTranscripts({ cwd: process.cwd() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
