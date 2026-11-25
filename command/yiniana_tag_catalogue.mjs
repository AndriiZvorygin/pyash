#!/usr/bin/env node
// The Yiniana catalogue tags.
//
// The station plays songs; a listener plays them in a player, and a player
// shows what the file says about itself. This writes those tags into every
// song of the catalogue: the name of the song, who made it, the album it
// belongs to, the day the audio was made, and a word about the song.
//
// The date of a song is the day the house made the audio: the day of the
// source of an imported song, and the day a song was rendered for the rest.
// A song that already carries a date keeps it.
//
// The song is written beside the catalogue and renamed onto it, so a half
// written song is never on the air, and the station picks the tagged songs up
// on its next scan.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { parseImports } from "../program/library/radio/imports.mjs";
import { stampCatalogue } from "../program/library/radio/tags.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_MANIFEST = "radio/imports.txt";
const DEFAULT_CATALOGUE = "radio/audio";

/**
 * The songs the house made before the radio, with the day each one was made.
 * A song of the manifest is dated by its source, not by the file in the
 * catalogue, which was copied long after the house made the audio.
 */
export async function readManifestDates(manifestPath = DEFAULT_MANIFEST, cwd = process.cwd()) {
  let text = "";
  try {
    text = await fs.readFile(path.resolve(cwd, manifestPath), "utf8");
  } catch {
    return [];
  }
  return parseImports(text);
}

/**
 * Write the tags of every song of the catalogue.
 */
export async function tagCatalogue({
  manifestPath = DEFAULT_MANIFEST,
  catalogueDirectory = DEFAULT_CATALOGUE,
  cwd = process.cwd(),
  log = () => {}
} = {}) {
  const manifest = await readManifestDates(manifestPath, cwd);
  const summary = await stampCatalogue({
    catalogueDirectory: path.resolve(cwd, catalogueDirectory),
    manifest
  });
  for (const song of summary.songs_detail) {
    log(`${song.name}: ${song.title} — ${song.artist} — ${song.date}`);
  }
  return summary;
}

/**
 * Read the settings from the pyash configuration surface and write the tags.
 */
export async function startCatalogueTags({ cwd = process.cwd() } = {}) {
  await loadDefaultConfig({ cwd, interpretFn: interpret });
  const manifestPath = path.resolve(cwd, resolveConfigText("radio song imports") || DEFAULT_MANIFEST);
  const catalogueDirectory = path.resolve(cwd, resolveConfigText("radio catalogue") || DEFAULT_CATALOGUE);
  const summary = await tagCatalogue({
    manifestPath,
    catalogueDirectory,
    cwd,
    log: (line) => process.stdout.write(`yiniana tags: ${line}\n`)
  });
  process.stdout.write(`${JSON.stringify({
    songs: summary.songs,
    stamped: summary.stamped
  }, null, 2)}\n`);
  return summary;
}

async function main() {
  await startCatalogueTags({ cwd: process.cwd() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
