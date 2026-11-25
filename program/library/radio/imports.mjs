/**
 * The songs the house already made, before the radio: a manifest of what to
 * bring into the rotation.
 *
 * One song per line:
 *
 *   <name>.mp3 | <source file> | <lyric sheet> | <title>
 *
 * The sheet is optional. A line without one is a song we have the audio for
 * and no words for. The name follows the folder contract, so the station
 * reads the engine and the topic off it like any other song.
 *
 * The title is optional too, and it is the song's own name: the house named
 * some of its songs before the radio existed, and the title is what the
 * station shows for them. A song without a title is named by its lane.
 */
export function parseImports(text) {
  const imports = [];
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((part) => part.trim());
    const [name, source, sheet, title] = parts;
    if (!name || !source) continue;
    if (!name.toLowerCase().endsWith(".mp3")) continue;
    if (imports.some((entry) => entry.name === name)) continue;
    imports.push({ name, source, sheet: sheet ?? "", title: title ?? "" });
  }
  return imports;
}

/**
 * The songs of a manifest that are not in the catalogue yet. A song that is
 * already there is never imported again.
 */
export function pendingImports({ imports = [], published = [] } = {}) {
  const done = new Set(published.map((name) => String(name ?? "").toLowerCase()));
  return imports.filter((entry) => !done.has(entry.name.toLowerCase()));
}
