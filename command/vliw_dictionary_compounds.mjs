import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadVliwDictionaryCompoundSelection,
  writeVliwDictionaryCompoundSelection
} from "../program/library/vliw/dictionary_disambiguation.mjs";

const selection = await loadVliwDictionaryCompoundSelection();
const output = await writeVliwDictionaryCompoundSelection(selection);
const repositoryRoot = new URL("../", import.meta.url);
const outputPath = relative(fileURLToPath(repositoryRoot), fileURLToPath(output));

process.stdout.write(`${JSON.stringify({ ...selection.summary, output: outputPath }, null, 2)}\n`);
