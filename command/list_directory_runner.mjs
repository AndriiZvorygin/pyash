import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dir: ".",
    filter: "all",
    hidden: false,
    recursive: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--dir") {
      options.dir = args[i + 1] ?? ".";
      i += 1;
      continue;
    }
    if (token === "--filter") {
      options.filter = args[i + 1] ?? "all";
      i += 1;
      continue;
    }
    if (token === "--hidden") {
      options.hidden = true;
      continue;
    }
    if (token === "--recursive") {
      options.recursive = true;
      continue;
    }
  }
  const normalized = String(options.filter ?? "all").toLowerCase();
  options.filter = normalized === "file" || normalized === "files"
    ? "file"
    : normalized === "dir" || normalized === "dirs"
      ? "dir"
      : "all";
  return options;
}

function asciiCompare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

async function walkDir(root, options) {
  const entries = [];
  const includeFiles = options.filter === "file" || options.filter === "all";
  const includeDirs = options.filter === "dir" || options.filter === "all";

  async function visit(current, relBase) {
    const dirents = await fsPromises.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!options.hidden && dirent.name.startsWith(".")) continue;
      const fullPath = path.join(current, dirent.name);
      const relPath = relBase ? path.join(relBase, dirent.name) : dirent.name;
      const outputPath = options.recursive ? normalizePath(relPath) : dirent.name;
      if (dirent.isDirectory()) {
        if (includeDirs) entries.push(outputPath);
        if (options.recursive) {
          await visit(fullPath, relPath);
        }
        continue;
      }
      if (includeFiles) entries.push(outputPath);
    }
  }

  await visit(root, "");
  return entries.sort(asciiCompare);
}

async function main() {
  const options = parseArgs(process.argv);
  const root = options.dir || ".";
  const entries = await walkDir(root, options);
  fs.writeFileSync(1, JSON.stringify(entries));
}

main().catch((err) => {
  process.stderr.write(String(err?.message ?? err));
  process.exit(1);
});
