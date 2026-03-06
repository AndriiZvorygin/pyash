import fs from "node:fs/promises";
import path from "node:path";

import { ensureSpoolDirs } from "../../library/spool.mjs";

function normalizeLaneName(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  return text.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "lane";
}

export function holdingLanePaths(worldRoot, { lane } = {}) {
  const laneName = normalizeLaneName(lane);
  const root = path.join(worldRoot, "holding", laneName);
  const produceRoot = path.join(root, "produce");
  return {
    laneName,
    root,
    inputDir: path.join(root, "input"),
    runtimeDir: path.join(root, "runtime"),
    produceDir: path.join(produceRoot, "waiting"),
    produceSuccessDir: path.join(produceRoot, "success"),
    produceFailDir: path.join(produceRoot, "fail"),
    artifactsDir: path.join(root, "artifacts"),
    tmpDir: path.join(root, "tmp")
  };
}

async function migrateLegacyProduceWaiting(paths) {
  const legacyDir = path.join(paths.root, "produce");
  let entries = [];
  try {
    entries = await fs.readdir(legacyDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const moves = [];
  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    const fromPath = path.join(legacyDir, entry.name);
    const toPath = path.join(paths.produceDir, entry.name);
    moves.push(fs.rename(fromPath, toPath).catch(() => {}));
  }
  await Promise.all(moves);
}

export async function ensureHoldingLaneDirs(worldRoot, { lane, migrateLegacyProduce = true } = {}) {
  const paths = holdingLanePaths(worldRoot, { lane });
  await ensureSpoolDirs(paths.root, [
    paths.inputDir,
    paths.runtimeDir,
    paths.produceDir,
    paths.produceSuccessDir,
    paths.produceFailDir,
    paths.artifactsDir,
    paths.tmpDir
  ]);
  if (migrateLegacyProduce) {
    await migrateLegacyProduceWaiting(paths);
  }
  return paths;
}
