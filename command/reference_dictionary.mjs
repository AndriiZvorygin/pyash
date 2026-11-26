#!/usr/bin/env node
// Maintain the accepted reference dictionary from one place.
//
// The volume is generated, so an edit made directly to `reference.pyac` would be
// overwritten by the next regeneration. Authoring therefore happens in the
// curated source that feeds the generator, and this command owns the
// regenerate-and-rebuild cycle:
//
//   node command/reference_dictionary.mjs rebuild          regenerate and rebuild
//   node command/reference_dictionary.mjs check            fail if the artifacts are stale
//   node command/reference_dictionary.mjs gloss <pya> <en> set an authored English gloss
//   node command/reference_dictionary.mjs verify           read back every canonical key
//
// `gloss` writes `program/library/translation/curated_glosses.pya`; run
// `rebuild` afterwards (or pass `--rebuild`) to publish it.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcceptedReferenceSource } from "../program/library/dictionary/build_reference_source.mjs";
import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import { runPyacDictionary } from "./pyac_dictionary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "program/library/dictionary/reference.pya");
const VOLUME = path.join(root, "program/library/dictionary/reference.pyac");
const CURATED_GLOSSES = path.join(root, "program/library/translation/curated_glosses.pya");
const CURATED_NAME = "translation_curated_glosses";

function usage(message) {
  const text = [
    message,
    "usage:",
    "  reference_dictionary rebuild           regenerate reference.pya and rebuild reference.pyac",
    "  reference_dictionary check             exit non-zero when the committed artifacts are stale",
    "  reference_dictionary verify            read every canonical key back from the volume",
    "  reference_dictionary gloss <pya> <en>  set an authored English gloss and rebuild",
    "  reference_dictionary digest            print entry counts and digests"
  ].join("\n");
  return new Error(text);
}

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Regenerate the snapshot and rebuild the volume in place. */
async function rebuild() {
  const summary = await generateAcceptedReferenceSource();
  const build = await runPyacDictionary([
    "build",
    "from",
    SOURCE,
    "to",
    VOLUME
  ], { stdout: { write() {} } });
  return {
    source: SOURCE,
    sourceBytes: summary.bytes,
    volume: VOLUME,
    volumeBytes: build.volumeBytes,
    entries: build.entries,
    codelets: build.codeletCount,
    sourceSha256: await digest(SOURCE),
    volumeSha256: await digest(VOLUME)
  };
}

/** Rebuild into a scratch directory and compare against the committed artifacts. */
async function check() {
  const committed = {
    sourceSha256: await digest(SOURCE),
    volumeSha256: await digest(VOLUME)
  };
  const scratch = await mkdtemp(path.join(tmpdir(), "reference-dictionary-"));
  try {
    const source = path.join(scratch, "reference.pya");
    const volume = path.join(scratch, "reference.pyac");
    await generateAcceptedReferenceSource({ output: source });
    await runPyacDictionary(["build", "from", source, "to", volume], { stdout: { write() {} } });
    const regenerated = {
      sourceSha256: await digest(source),
      volumeSha256: await digest(volume)
    };
    const stale = Object.keys(committed).filter((key) => committed[key] !== regenerated[key]);
    return { stale, committed, regenerated };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Set or replace one authored English gloss in the curated source. */
async function setGloss(pya, english) {
  const words = String(pya).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw usage("gloss needs a Pyash spelling");
  const text = String(english ?? "").trim();
  if (!text) throw usage("gloss needs English text");

  const current = await readFile(CURATED_GLOSSES, "utf8");
  const line = `su text ${JSON.stringify(words.join(" "))} ob text ${JSON.stringify(text)} ya`;
  const lines = current.split("\n");
  const header = lines.findIndex((value) => value.startsWith(`su name ${CURATED_NAME} be map def`));
  if (header < 0) throw new Error(`${CURATED_GLOSSES} has no ${CURATED_NAME} header`);

  const key = JSON.stringify(words.join(" "));
  const existing = lines.findIndex((value) => value.startsWith(`su text ${key} ob text`));
  if (existing >= 0) {
    lines[existing] = line;
  } else {
    const closing = lines.lastIndexOf("prah");
    if (closing < 0) throw new Error(`${CURATED_GLOSSES} has no closing prah`);
    lines.splice(closing, 0, line);
  }
  await writeFile(CURATED_GLOSSES, lines.join("\n"), "utf8");
  return { spelling: words.join(" "), gloss: text, source: CURATED_GLOSSES, replaced: existing >= 0 };
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "rebuild") {
    const result = await rebuild();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === "check") {
    const result = await check();
    if (result.stale.length) {
      process.stderr.write(
        `reference dictionary is stale (${result.stale.join(", ")}); run: node command/reference_dictionary.mjs rebuild\n`
      );
      return 1;
    }
    process.stdout.write("reference dictionary is current\n");
    return 0;
  }
  if (command === "verify") {
    const result = await runPyacDictionary(["verify", VOLUME], { stdout: { write() {} } });
    process.stdout.write(
      `verified ${result.keys} canonical keys in ${result.entries} entries: ok\n`
    );
    return 0;
  }
  if (command === "gloss") {
    const changed = await setGloss(rest[0], rest.slice(1).join(" "));
    const result = await rebuild();
    process.stdout.write(`${JSON.stringify({ ...changed, ...result }, null, 2)}\n`);
    return 0;
  }
  if (command === "digest") {
    const parsed = buildDictionarySource(await readFile(SOURCE, "utf8"));
    process.stdout.write(`${JSON.stringify({
      entries: parsed.entries.length,
      sourceSha256: await digest(SOURCE),
      volumeSha256: await digest(VOLUME),
      volumeBytes: (await readFile(VOLUME)).length
    }, null, 2)}\n`);
    return 0;
  }
  throw usage("unknown reference dictionary command");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}

export { rebuild, check, setGloss, digest };
