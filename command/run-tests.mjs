#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function testFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.test\.mjs$/u.test(entry.name)) files.push(fullPath);
    }
  };
  visit(directory);
  return files;
}

const rootTests = [
  ...testFilesUnder(path.join(root, "quiz")),
  ...testFilesUnder(path.join(root, "quiz", "runtime")),
  ...testFilesUnder(path.join(root, "quiz", "runtime", "gpu")),
];

const includeHouseTests = !/^(0|false|no)$/iu.test(String(process.env.PYASH_INCLUDE_HOUSE_TESTS || ""));
const houseTests = !includeHouseTests
  ? []
  : fs.existsSync(path.join(root, "world", "house"))
    ? fs.readdirSync(path.join(root, "world", "house"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .flatMap((entry) => [
        ...testFilesUnder(path.join(root, "world", "house", entry.name, "quiz")),
        ...testFilesUnder(path.join(root, "world", "house", entry.name, "program", "test")),
      ])
    : [];

const files = [...new Set([...rootTests, ...houseTests])].sort();
if (files.length === 0) {
  console.error("No test files found.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...files, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
