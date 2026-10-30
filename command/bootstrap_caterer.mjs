#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, chmodSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const WASMTIME_VERSION = "41.0.0";
const WASMTIME_ASSETS = {
  "linux-x64": {
    url: `https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-x86_64-linux.tar.xz`,
    sha256: "07b82a195dc3bda0be010f73d48778b43a209829e9912a4bcd46a8e3760d74e9",
    dir: `wasmtime-v${WASMTIME_VERSION}-x86_64-linux`
  },
  "linux-arm64": {
    url: `https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-aarch64-linux.tar.xz`,
    sha256: "99d9dd1e314f60eb96256615685bc28f8669b613efcf162881abdf5ad646d35a",
    dir: `wasmtime-v${WASMTIME_VERSION}-aarch64-linux`
  },
  "darwin-x64": {
    url: `https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-x86_64-macos.tar.xz`,
    sha256: "ec91e9d4130fe1776bde8601c2dffde299dc59b4dbdad6f8f471bac04bd86094",
    dir: `wasmtime-v${WASMTIME_VERSION}-x86_64-macos`
  },
  "darwin-arm64": {
    url: `https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-aarch64-macos.tar.xz`,
    sha256: "3f8520e697e9d2105fc8e5c77f03185a75629065d0b84c90b8e57e09adb029f1",
    dir: `wasmtime-v${WASMTIME_VERSION}-aarch64-macos`
  }
};

const WHISPER_TAG = "v1.9.5";
const WHISPER = {
  url: `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_TAG}.tar.gz`,
  sha256: "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720"
};

// Open English WordNet 2025 JSON: read-only semantic evidence for translation.
// The source URL, license, and the loader's own content hash are recorded in
// program/verbs/exchange/translation/english_wordnet.pya.
const WORDNET = {
  url: "https://en-word.net/static/english-wordnet-2025-json.zip",
  sha256: "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51",
  dir: join("know", "wordnet", "open-english-wordnet-2025-json")
};

function usage() {
  console.log(`Usage: npm run bootstrap [-- --with-whisper] [--force]

Downloads the pinned external toolchains that are not stored in git:
  wasmtime ${WASMTIME_VERSION}    -> caterer/wasmtime/bin/wasmtime (interpret verb, compiled interpret)
  whisper.cpp ${WHISPER_TAG} -> caterer/whisper.cpp/ (only with --with-whisper; hear builds)
  Open English WordNet 2025 -> ${WORDNET.dir}/ (translation semantic evidence)

The zsv and curl header/source subsets used by C compilation stay in git.
Existing downloads are kept; pass --force to replace them.`);
}

function platform() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) throw new Error(`unsupported architecture: ${process.arch}`);
  const key = `${process.platform}-${arch}`;
  if (!WASMTIME_ASSETS[key]) throw new Error(`unsupported platform: ${key}`);
  return key;
}

async function fetchChecksumed(url, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`);
  }
  return bytes;
}

function run(command, args, options = {}) {
  const res = spawnSync(command, args, { encoding: "utf8", ...options });
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${res.status}\n${res.stderr ?? ""}`);
  }
  return res;
}

function writeTempArchive(name, bytes) {
  const path = join(tmpdir(), `pyash-bootstrap-${process.pid}-${name}`);
  rmSync(path, { force: true });
  writeFileSync(path, bytes);
  return path;
}

async function bootstrapWasmtime({ force }) {
  const dest = join(ROOT, "caterer", "wasmtime", "bin", "wasmtime");
  if (!force && existsSync(dest)) {
    console.log(`wasmtime ${WASMTIME_VERSION}: already present at caterer/wasmtime/bin/wasmtime`);
    return;
  }
  const key = platform();
  const asset = WASMTIME_ASSETS[key];
  console.log(`wasmtime ${WASMTIME_VERSION}: downloading ${key}...`);
  const bytes = await fetchChecksumed(asset.url, asset.sha256);
  const archive = writeTempArchive("wasmtime.tar.xz", bytes);
  const extractDir = join(tmpdir(), `pyash-bootstrap-${process.pid}-wasmtime`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run("tar", ["-xJf", archive, "-C", extractDir]);
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  copyFileSync(join(extractDir, asset.dir, "wasmtime"), dest);
  chmodSync(dest, 0o755);
  const version = run(dest, ["--version"]).stdout.trim();
  rmSync(archive, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`wasmtime ${WASMTIME_VERSION}: installed (${version})`);
}

async function bootstrapWhisper({ force }) {
  const dest = join(ROOT, "caterer", "whisper.cpp");
  if (!force && existsSync(join(dest, "README.md"))) {
    console.log(`whisper.cpp ${WHISPER_TAG}: already present at caterer/whisper.cpp/`);
    return;
  }
  console.log(`whisper.cpp ${WHISPER_TAG}: downloading...`);
  const bytes = await fetchChecksumed(WHISPER.url, WHISPER.sha256);
  const archive = writeTempArchive("whisper.tar.gz", bytes);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xzf", archive, "-C", dest, "--strip-components=1"]);
  rmSync(archive, { force: true });
  console.log(`whisper.cpp ${WHISPER_TAG}: installed at caterer/whisper.cpp/`);
  console.log("  build hear binaries with: bash command/build_whisper_cpp_linux_x64.sh");
}

async function bootstrapWordnet({ force }) {
  const dest = join(ROOT, WORDNET.dir);
  if (!force && existsSync(join(dest, "entries-a.json"))) {
    console.log(`Open English WordNet 2025: already present at ${WORDNET.dir}/`);
    return;
  }
  console.log("Open English WordNet 2025: downloading...");
  const bytes = await fetchChecksumed(WORDNET.url, WORDNET.sha256);
  const archive = writeTempArchive("wordnet.zip", bytes);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run("unzip", ["-oq", archive, "-d", dest]);
  rmSync(archive, { force: true });
  console.log(`Open English WordNet 2025: installed at ${WORDNET.dir}/`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  const force = args.includes("--force");
  const withWhisper = args.includes("--with-whisper");
  const unknown = args.filter((arg) => !["--force", "--with-whisper"].includes(arg));
  if (unknown.length > 0) {
    usage();
    throw new Error(`unknown argument(s): ${unknown.join(" ")}`);
  }
  await bootstrapWasmtime({ force });
  if (withWhisper) await bootstrapWhisper({ force });
  else console.log("whisper.cpp: skipped (pass --with-whisper for hear builds)");
  await bootstrapWordnet({ force });
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
