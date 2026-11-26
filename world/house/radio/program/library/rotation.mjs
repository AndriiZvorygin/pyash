import fs from "node:fs/promises";

/**
 * The lanes of the rotation: one topic per line, comments and blanks ignored.
 * A topic that is listed twice is one lane, not two.
 */
export function parseLanes(text) {
  const lanes = [];
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (lanes.includes(line)) continue;
    lanes.push(line);
  }
  return lanes;
}

/**
 * The lanes read from a file. A file that is not there leaves the rotation
 * empty: the station then plays whatever it finds, and the producer waits.
 */
export async function readLanes(file) {
  const name = String(file ?? "").trim();
  if (!name) return [];
  try {
    return parseLanes(await fs.readFile(name, "utf8"));
  } catch {
    return [];
  }
}

/**
 * The songs the rotation is made of: every lane, every engine. The name is
 * the folder contract, `radio/audio/<engine>-<topic>.mp3`.
 */
export function contractNames({ engines = [], topics = [] } = {}) {
  const names = new Set();
  for (const engine of engines) {
    const prefix = String(engine ?? "").trim();
    if (!prefix) continue;
    for (const topic of topics) {
      const lane = String(topic ?? "").trim();
      if (!lane) continue;
      names.add(`${prefix}-${lane}.mp3`);
    }
  }
  return names;
}

/**
 * The order the station plays. The rotation file names the songs that came
 * before the radio first, then the lanes of the rotation. A name without its
 * extension gets it.
 */
export function parseRotation(text) {
  const names = [];
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const name = line.toLowerCase().endsWith(".mp3") ? line : `${line}.mp3`;
    if (names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * The order read from a file. A file that is not there leaves the station
 * with the order it would have had anyway.
 */
export async function readRotation(file) {
  const name = String(file ?? "").trim();
  if (!name) return [];
  try {
    return parseRotation(await fs.readFile(name, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Put the songs in the order the station plays them: the songs the rotation
 * file names, in that order, then the rest of the catalogue.
 */
export function orderTracks(tracks = [], order = []) {
  const rank = new Map();
  order.forEach((name, index) => {
    if (!rank.has(name)) rank.set(name, index);
  });
  const rest = [];
  const named = [];
  for (const track of tracks) {
    const index = rank.get(track.filename);
    if (index === undefined) {
      rest.push(track);
      continue;
    }
    named.push({ track, index });
  }
  named.sort((left, right) => left.index - right.index);
  return [...named.map((entry) => entry.track), ...rest];
}

/**
 * The songs the station is contracted to play: every lane of every engine,
 * and every song the rotation file names.
 */
export function contractWithOrder({ engines = [], topics = [], order = [] } = {}) {
  const names = contractNames({ engines, topics });
  for (const name of order) names.add(name);
  return names;
}

/**
 * Is this file one of the songs of the rotation? An empty contract lets every
 * file through, so a station without a rotation still plays what it finds.
 */
export function inContract(filename, contract) {
  if (!contract || typeof contract.has !== "function") return true;
  if (!contract.size) return true;
  return contract.has(String(filename ?? ""));
}
