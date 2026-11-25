import fs from "node:fs/promises";
import path from "node:path";

import { measureMp3Buffer } from "./mp3.mjs";

// The rendered catalogue follows the house folder contract
// `radio/audio/<engine>-<topic>.mp3`. The engine prefix is known, so the
// topic can be read off the name without guessing where the engine ends.
const ENGINE_PREFIXES = ["ace-step", "yue2"];

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
 * The lyric sheet that belongs to a topic, when the chain has written one.
 */
export async function findLyricSheet(lyricsDirectory, topic) {
  const directory = String(lyricsDirectory ?? "").trim();
  const name = String(topic ?? "").trim();
  if (!directory || !name) return "";
  const candidate = path.join(directory, `song-${name}.txt`);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return "";
  }
}

/**
 * Read the catalogue directory and describe every playable track. Files that
 * are not audio, and files whose frames cannot be read, are left out: the
 * station plays what it can play.
 */
export async function scanCatalogue({ directory, lyricsDirectory = "" } = {}) {
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
    const filePath = path.join(folder, filename);
    let buffer = null;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      continue;
    }
    const media = measureMp3Buffer(buffer);
    if (!media.frames) continue;
    const { engine, topic, title } = parseTrackName(filename);
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
      lyricSheet: await findLyricSheet(lyricsDirectory, topic)
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
    lyricSheet: track.lyricSheet ? path.basename(track.lyricSheet) : ""
  }));
}
