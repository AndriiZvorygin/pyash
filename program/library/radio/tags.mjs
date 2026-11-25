// The tags a song carries.
//
// A listener plays a song in a player, and the player shows what the file
// says about itself: what the song is called, who made it, what it belongs
// to, when the audio was made, and a word about the song. These are the tags
// the house writes on every song it puts on the air.
//
// The date of a song is written once, when the song enters the catalogue: the
// day the house made the audio. A later pass fills in what is missing and
// leaves the date alone, because the file's own timestamp moves whenever the
// file is touched.

import fs from "node:fs/promises";
import path from "node:path";

import { readId3Tags, id3v2Size, writeId3Tags } from "./id3.mjs";
import { measureMp3Buffer } from "./mp3.mjs";
import { parseTrackName } from "./catalogue.mjs";

/**
 * The album every song of the house belongs to.
 */
export const ALBUM = "Yiniana Radio";

// The voice behind each engine: who the listener hears, and what made the
// song. The songs of the house are Andrii Zvorygin's own; the rest the
// station made for itself.
const VOICES = {
  "ace-step": { artist: "Yiniana Radio", label: "ACE-Step 1.5 XL turbo" },
  "az": { artist: "Andrii Zvorygin", label: "Andrii Zvorygin" },
  "yue2": { artist: "Yiniana Radio", label: "YuE2" }
};

/**
 * The voice of an engine: who the song is by, and what made it.
 */
export function voiceForEngine(engine) {
  const key = String(engine ?? "").trim().toLowerCase();
  if (VOICES[key]) return { ...VOICES[key] };
  return { artist: ALBUM, label: key };
}

/**
 * The day of a date, as the house writes it: the year, the month, the day.
 */
export function dayOf(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * The day a file was made, the day its own timestamp says.
 */
export async function fileDay(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return dayOf(stats.mtime);
  } catch {
    return "";
  }
}

/**
 * The tags of a song: what it is called, who made it, the album it belongs
 * to, the day the audio was made, and a word about the song.
 *
 * The title of the song is the title the file carries; without one it is the
 * lane the song was made for, written out.
 */
export function songTags({ filename, title = "", date = "" } = {}) {
  const { engine, topic, title: laneTitle } = parseTrackName(filename);
  const voice = voiceForEngine(engine);
  const day = String(date ?? "").trim();
  return {
    title: String(title ?? "").trim() || laneTitle,
    artist: voice.artist,
    album: ALBUM,
    date: day,
    comment: [ALBUM, voice.label, topic].filter(Boolean).join(" · ")
  };
}

/**
 * The tags a file carries, read from the head of the file alone: the tag is
 * at the front, so a catalogue of songs can be read without reading the
 * audio.
 */
export async function readSongTags({ filePath }) {
  const empty = readId3Tags(Buffer.alloc(0));
  let handle = null;
  try {
    handle = await fs.open(filePath, "r");
    const head = Buffer.alloc(10);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead < head.length) return empty;
    const tagLength = id3v2Size(head);
    if (!tagLength) return empty;
    const tag = Buffer.alloc(tagLength);
    await handle.read(tag, 0, tagLength, 0);
    return readId3Tags(tag);
  } catch {
    return empty;
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * Write the tags of a song into the file, and leave the audio alone.
 *
 * The file is written beside the song and renamed onto it, so a half written
 * song is never on the air. A song that already carries the tags is not
 * touched at all.
 *
 * The date of a song is written once: a song that already carries one keeps
 * it, unless the caller insists.
 */
export async function stampSong({ targetPath, tags = {}, force = false }) {
  const wanted = { ...tags };
  let buffer = null;
  try {
    buffer = await fs.readFile(targetPath);
  } catch {
    return false;
  }
  // The tag belongs to an audio file. A file without frames is not a song, so
  // it is not stamped.
  if (!measureMp3Buffer(buffer).frames) return false;
  const current = readId3Tags(buffer);
  const day = String(wanted.date ?? "").trim();
  const merged = {
    title: String(wanted.title ?? "").trim(),
    artist: String(wanted.artist ?? "").trim(),
    album: String(wanted.album ?? "").trim(),
    comment: String(wanted.comment ?? "").trim()
  };
  if (day && (force || !current.date)) {
    merged.date = day;
  } else if (current.date) {
    merged.date = current.date;
  }
  // The house writes the day of a song in the frame that holds the whole day.
  // A file that carries only the year is left with the day alone.
  merged.year = null;
  const changed = Object.keys(merged).some((key) => {
    const wanted = merged[key];
    if (wanted === null) return Boolean(current[key]);
    return (wanted ?? "") !== (current[key] ?? "");
  });
  if (!changed) return false;
  const stamped = writeId3Tags(buffer, merged);
  if (stamped === buffer) return false;
  const staging = `${targetPath}.part`;
  await fs.writeFile(staging, stamped);
  await fs.rename(staging, targetPath);
  return true;
}

/**
 * The tags of every song of a catalogue, written into the songs that do not
 * carry them yet.
 *
 * The day of a song is the day the house made the audio: the day of the
 * source of an imported song, and the day the song was published for the
 * rest.
 */
export async function stampCatalogue({ catalogueDirectory, manifest = [] } = {}) {
  const folder = String(catalogueDirectory ?? "").trim();
  const summary = { songs: 0, stamped: 0, dates: [], songs_detail: [] };
  if (!folder) return summary;
  let names = [];
  try {
    names = (await fs.readdir(folder)).filter((name) => name.toLowerCase().endsWith(".mp3"));
  } catch {
    return summary;
  }
  const known = new Map((manifest ?? []).map((entry) => [entry.name, entry]));
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    const filePath = path.join(folder, name);
    const entry = known.get(name);
    const day = entry?.source ? await fileDay(entry.source) : await fileDay(filePath);
    const current = await readSongTags({ filePath });
    const title = current.title || entry?.title || "";
    const tags = songTags({ filename: name, title, date: day });
    const stamped = await stampSong({ targetPath: filePath, tags });
    summary.songs += 1;
    if (stamped) summary.stamped += 1;
    summary.songs_detail.push({ name, title: tags.title, artist: tags.artist, date: tags.date, stamped });
  }
  summary.dates = summary.songs_detail.map((song) => `${song.title} — ${song.date}`);
  return summary;
}
