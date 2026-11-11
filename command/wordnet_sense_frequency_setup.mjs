import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENGLISH_WORDNET_FREQUENCY_CONFIG_URL,
  parseEnglishWordNetFrequencyConfig,
  parsePrincetonWordNetSenseIndex
} from "../program/library/translation/english_wordnet_frequency.mjs";

const COMMAND_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(COMMAND_DIRECTORY, "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function extractPrincetonSenseIndex(archive) {
  if (!Buffer.isBuffer(archive)) throw new TypeError("WordNet archive must be a Buffer");
  return execFileSync("tar", ["-xOzf", "-", "dict/index.sense"], {
    input: archive,
    maxBuffer: 24 * 1024 * 1024,
    encoding: "buffer",
    stdio: ["pipe", "pipe", "pipe"]
  });
}

export async function setupPrincetonWordNetSenseIndex() {
  const config = parseEnglishWordNetFrequencyConfig(await readFile(ENGLISH_WORDNET_FREQUENCY_CONFIG_URL, "utf8"));
  const indexPath = resolve(REPOSITORY_ROOT, config["index-path"]);
  try {
    const existing = await readFile(indexPath);
    if (sha256(existing) === config["index-sha256"]) {
      parsePrincetonWordNetSenseIndex(existing.toString("utf8"));
      return { status: "already-current", indexPath, indexHash: sha256(existing) };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const response = await fetch(config["source-url"]);
  if (!response.ok) throw new Error(`WordNet frequency download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const archiveHash = sha256(archive);
  if (archiveHash !== config["archive-sha256"]) {
    throw new Error(`WordNet archive hash mismatch: expected ${config["archive-sha256"]}, received ${archiveHash}`);
  }
  const index = extractPrincetonSenseIndex(archive);
  const parsed = parsePrincetonWordNetSenseIndex(index.toString("utf8"));
  if (parsed.sourceHash !== config["index-sha256"]) {
    throw new Error(`WordNet sense index hash mismatch: expected ${config["index-sha256"]}, received ${parsed.sourceHash}`);
  }
  await mkdir(dirname(indexPath), { recursive: true });
  const temporary = `${indexPath}.${process.pid}.tmp`;
  await writeFile(temporary, index);
  await rename(temporary, indexPath);
  return { status: "installed", indexPath, indexHash: parsed.sourceHash, rows: parsed.rows.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupPrincetonWordNetSenseIndex().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
