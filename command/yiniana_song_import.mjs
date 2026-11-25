#!/usr/bin/env node
// The Yiniana song import.
//
// The house made songs before the radio existed. This brings them into the
// rotation: the audio becomes an mp3 the station can stream, the words become
// a sheet the station page can show, and the song takes its place in the
// catalogue without the station being restarted.
//
// The station rescans the catalogue every few seconds, so a song that lands
// here joins the programme on its own.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { parseTrackName } from "../program/library/radio/catalogue.mjs";
import { parseImports, pendingImports } from "../program/library/radio/imports.mjs";
import { writeId3Tags } from "../program/library/radio/id3.mjs";
import { measureMp3Buffer } from "../program/library/radio/mp3.mjs";
import { fileDay, readSongTags, songTags, stampSong } from "../program/library/radio/tags.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_MANIFEST = "radio/imports.txt";
const DEFAULT_CATALOGUE = "radio/audio";
const MP3_BITRATE = "192k";
const MP3_RATE = "48000";

/**
 * The sheet a song carries. A song of the house carries its own sheet, named
 * for the song, so two songs about compassion do not fight over one file.
 */
export function sheetNameFor(name) {
  const { engine, topic } = parseTrackName(name);
  return engine ? `song-${engine}-${topic}.txt` : `song-${topic}.txt`;
}

function run(command, args, { cwd = process.cwd(), env = process.env, label = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
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
 * The mp3 the station plays. The house keeps its songs in opus and wav; the
 * station streams mp3, so the audio is re-encoded once, here, and the copy
 * in the catalogue is the one that plays.
 */
export async function transcodeToMp3({
  sourcePath,
  outputPath,
  ffmpeg = "ffmpeg",
  cwd = process.cwd(),
  env = process.env
}) {
  await run(ffmpeg, [
    "-v", "error",
    "-y",
    "-i", sourcePath,
    "-c:a", "libmp3lame",
    "-b:a", MP3_BITRATE,
    "-ar", MP3_RATE,
    "-ac", "2",
    outputPath
  ], { cwd, env, label: `transcode ${path.basename(sourcePath)}` });
  return outputPath;
}

/**
 * Read an mp3 and say whether the station can play it: the frames have to be
 * there, and the song has to have a length.
 */
export function inspectMp3(buffer) {
  const media = measureMp3Buffer(buffer);
  return {
    frames: media.frames,
    durationSeconds: media.durationSeconds,
    playable: Boolean(media.frames) && media.durationSeconds > 0
  };
}

/**
 * Write a file into place without ever showing a half written song: the
 * bytes go to a part file, and the part file is renamed onto the name.
 */
export async function publishFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const staging = `${targetPath}.part`;
  await fs.copyFile(sourcePath, staging);
  await fs.rename(staging, targetPath);
  return targetPath;
}

/**
 * Give a file in the catalogue the tags of a song: the name the house gave
 * it, who made it, the album it belongs to, and the day the audio was made.
 *
 * The tags are written into the tag of the file, so the station reads them
 * there and the file carries them with it wherever it goes.
 *
 * A file that already carries the tags is left untouched, so the import can
 * be run again without touching a single byte.
 */
export async function applyTags(targetPath, { title = "", date = "" } = {}) {
  const current = await readSongTags({ filePath: targetPath });
  const tags = songTags({
    filename: path.basename(targetPath),
    title: current.title || title,
    date
  });
  return stampSong({ targetPath, tags });
}

/**
 * Bring one song into the catalogue: the audio, and the words if we have
 * them.
 */
export async function importSong({
  entry,
  catalogueDirectory,
  lyricsDirectory = "",
  workDirectory = "",
  transcode = transcodeToMp3,
  log = () => {}
}) {
  const target = path.join(catalogueDirectory, entry.name);
  try {
    await fs.access(target);
    // The song is already in the catalogue. The only thing left to do is to
    // give it the name and the tags the house gave it.
    const day = entry.source ? await fileDay(entry.source) : "";
    const tagged = await applyTags(target, { title: entry.title, date: day });
    if (tagged) {
      log(`titled ${entry.name} as ${entry.title || path.basename(entry.name, ".mp3")}`);
      return { name: entry.name, status: "titled", title: entry.title, sheet: "" };
    }
    return { name: entry.name, status: "present", sheet: "" };
  } catch {
    // not there yet
  }
  const scratch = workDirectory
    ? path.join(workDirectory, `${path.basename(entry.name, ".mp3")}.import.mp3`)
    : path.join(catalogueDirectory, `${path.basename(entry.name, ".mp3")}.import.mp3`);
  await fs.mkdir(path.dirname(scratch), { recursive: true });
  await transcode({ sourcePath: entry.source, outputPath: scratch });
  let buffer = await fs.readFile(scratch);
  const media = inspectMp3(buffer);
  if (!media.playable) {
    await fs.rm(scratch, { force: true });
    throw new Error(`the import of ${entry.name} produced an mp3 the station cannot play`);
  }
  // The song is named and dated before it is published, so the file that
  // lands in the catalogue already carries its own tags.
  const day = await fileDay(entry.source);
  buffer = writeId3Tags(buffer, songTags({ filename: entry.name, title: entry.title, date: day }));
  await fs.writeFile(scratch, buffer);
  await publishFile(scratch, target);
  await fs.rm(scratch, { force: true });
  let sheet = "";
  if (entry.sheet && lyricsDirectory) {
    sheet = path.join(lyricsDirectory, sheetNameFor(entry.name));
    await publishFile(entry.sheet, sheet);
  }
  log(`imported ${entry.name} (${media.durationSeconds.toFixed(1)}s)`);
  return { name: entry.name, status: "imported", durationSeconds: media.durationSeconds, sheet };
}

/**
 * Every song of the manifest that the catalogue does not hold yet.
 */
export async function importSongs({
  manifestPath = DEFAULT_MANIFEST,
  catalogueDirectory = DEFAULT_CATALOGUE,
  lyricsDirectory = "",
  workDirectory = "",
  transcode = transcodeToMp3,
  log = () => {}
} = {}) {
  const manifest = await fs.readFile(manifestPath, "utf8");
  const imports = parseImports(manifest);
  let published = [];
  try {
    published = (await fs.readdir(catalogueDirectory)).filter((name) => name.toLowerCase().endsWith(".mp3"));
  } catch {
    published = [];
  }
  const pending = pendingImports({ imports, published });
  const songs = [];
  for (const entry of imports) {
    try {
      songs.push(await importSong({
        entry,
        catalogueDirectory,
        lyricsDirectory,
        workDirectory,
        transcode,
        log
      }));
    } catch (error) {
      // One song that cannot be brought in does not stop the rest of the house.
      const message = String(error?.message ?? error);
      log(`skipped ${entry.name}: ${message}`);
      songs.push({ name: entry.name, status: "failed", error: message, sheet: "" });
    }
  }
  return {
    manifest: imports.length,
    pending: pending.length,
    imported: songs.filter((song) => song.status === "imported").length,
    titled: songs.filter((song) => song.status === "titled").length,
    failed: songs.filter((song) => song.status === "failed").length,
    songs
  };
}

/**
 * Read the import settings from the pyash configuration surface and bring
 * the songs in.
 */
export async function startSongImport({ cwd = process.cwd() } = {}) {
  await loadDefaultConfig({ cwd, interpretFn: interpret });
  const manifestPath = path.resolve(cwd, resolveConfigText("radio song imports") || DEFAULT_MANIFEST);
  const catalogueDirectory = path.resolve(cwd, resolveConfigText("radio catalogue") || DEFAULT_CATALOGUE);
  const lyricsDirectory = path.resolve(path.dirname(catalogueDirectory), "lyrics");
  const summary = await importSongs({
    manifestPath,
    catalogueDirectory,
    lyricsDirectory,
    log: (line) => process.stdout.write(`yiniana import: ${line}\n`)
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  await startSongImport({ cwd: process.cwd() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
