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
 * Is this file one of the songs of the rotation? An empty contract lets every
 * file through, so a station without a rotation still plays what it finds.
 */
export function inContract(filename, contract) {
  if (!contract || typeof contract.has !== "function") return true;
  if (!contract.size) return true;
  return contract.has(String(filename ?? ""));
}
