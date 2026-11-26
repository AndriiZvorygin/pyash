import fs from "node:fs/promises";
import path from "node:path";

import { measureMp3Buffer } from "./mp3.mjs";
import { downloadUrlFor } from "./download.mjs";
import { readId3Title } from "./id3.mjs";
import { inContract } from "./rotation.mjs";

// The rendered catalogue follows the house folder contract
// `radio/audio/<engine>-<topic>.mp3`. The engine prefix is known, so the
// topic can be read off the name without guessing where the engine ends.
// "az" is Andrii Zvorygin, the house's own voice, for the songs the house
// made before the radio. "night" is the voice of the night channel.
const ENGINE_PREFIXES = ["ace-step", "yue2", "az", "night"];

function titleCase(text) {
  return String(text ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Split a catalogue file name into its engine, its topic and a display title.
 * A name that carries no known engine prefix is all topic.
 */
export function parseTrackName(filename) {
  const stem = String(filename ?? "").replace(/\.mp3$/iu, "");
  const lower = stem.toLowerCase();
  let engine = "";
  for (const candidate of ENGINE_PREFIXES) {
    if (lower === candidate || lower.startsWith(`${candidate}-`)) {
      engine = candidate;
      break;
    }
  }
  const topic = engine ? stem.slice(engine.length + 1) : stem;
  return {
    engine,
    topic,
    title: titleCase(topic.split("-").filter(Boolean).join(" ")) || stem
  };
}

/**
 * The lyric sheet that belongs to a song, when the chain has written one.
 *
 * A song of the house carries its own sheet, named for the song, so two songs
 * about the same theme do not fight over one file. A song of the rotation
 * carries the sheet of its lane.
 *
 * A channel that sings in a voice of its own keeps to the sheet of that
 * voice: a song sung slow is timed by its own hearing, and never by the
 * hearing of the lane it was made for.
 */
export async function findLyricSheet(lyricsDirectory, topic, engine = "", { own = false } = {}) {
  const directory = String(lyricsDirectory ?? "").trim();
  const name = String(topic ?? "").trim();
  if (!directory || !name) return "";
  const prefix = String(engine ?? "").trim();
  const candidates = [];
  if (prefix) candidates.push(path.join(directory, `song-${prefix}-${name}.txt`));
  if (!own) candidates.push(path.join(directory, `song-${name}.txt`));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return "";
}

/**
 * Read the catalogue directory and describe every playable track. Files that
 * are not audio, and files whose frames cannot be read, are left out: the
 * station plays what it can play.
 *
 * When a contract is given, only the songs of the rotation are read. An
 * experiment that shares the catalogue folder is kept on disk and stays out
 * of the programme.
 */
export async function scanCatalogue({ directory, lyricsDirectory = "", contract = null, own = false } = {}) {
  const folder = String(directory ?? "").trim();
  if (!folder) return [];
  let entries = [];
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const tracks = [];
  for (const filename of names) {
    if (!inContract(filename, contract)) continue;
    const filePath = path.join(folder, filename);
    let buffer = null;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      continue;
    }
    const media = measureMp3Buffer(buffer);
    if (!media.frames) continue;
    const { engine, topic, title: laneTitle } = parseTrackName(filename);
    // A song that carries its own title is named by that title. A song that
    // carries none is named by the lane it was made for.
    const title = readId3Title(buffer) || laneTitle;
    tracks.push({
      filename,
      path: filePath,
      engine,
      topic,
      title,
      durationSeconds: media.durationSeconds,
      dataOffset: media.dataOffset,
      frameOffsets: media.frameOffsets,
      frameSeconds: media.frameSeconds,
      bytes: media.bytes,
      sampleRate: media.sampleRate,
      channels: media.channels,
      lyricSheet: await findLyricSheet(lyricsDirectory, topic, engine, { own })
    });
  }
  return tracks;
}

/**
 * The catalogue as the station reports it: no paths, no offsets.
 */
export function publicCatalogue(tracks = []) {
  return tracks.map((track) => ({
    filename: track.filename,
    title: track.title,
    topic: track.topic,
    engine: track.engine,
    durationSeconds: track.durationSeconds,
    lyricSheet: track.lyricSheet ? path.basename(track.lyricSheet) : "",
    downloadUrl: downloadUrlFor(track.filename)
  }));
}
