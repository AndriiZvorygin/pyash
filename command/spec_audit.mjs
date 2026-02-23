#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const SPEC_DIR = path.resolve("documentation/specifications");
const MAX_FILES = 24;
const MAX_BYTES = 16 * 1024;

const entries = await readdir(SPEC_DIR);
const files = entries.filter((name) => name.endsWith(".md")).sort();

const results = [];
for (const name of files) {
  const full = path.join(SPEC_DIR, name);
  const info = await stat(full);
  results.push({ name, bytes: info.size });
}

const tooLarge = results.filter((item) => item.bytes > MAX_BYTES);
let failed = false;

if (results.length > MAX_FILES) {
  failed = true;
  console.error(`spec audit failed: ${results.length} files > limit ${MAX_FILES}`);
}

if (tooLarge.length > 0) {
  failed = true;
  for (const item of tooLarge) {
    console.error(`spec audit failed: ${item.name} is ${item.bytes} bytes > ${MAX_BYTES}`);
  }
}

if (!failed) {
  console.log(`spec audit ok: ${results.length} files, max ${MAX_BYTES} bytes per file`);
}

process.exit(failed ? 1 : 0);
