#!/usr/bin/env node
// The Yiniana producer.
//
// The station plays what has been rendered. This is what makes more: it takes
// the next topic the catalogue is missing, writes the lyrics, renders a few
// seeds, keeps the seed that carries the words, and publishes the song into
// the catalogue folder. The station's own catalogue scan picks the song up
// within the minute, with no restart.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigMap, resolveConfigMapNum, resolveConfigMapText, resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { parseLanes } from "../program/library/radio/rotation.mjs";
import { recoverRate, transcriptText } from "./yiniana_lyric_recovery.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

// The lane parser lives with the rotation now. The producer keeps exporting
// it, so the producer's own surface does not change under its callers.
export { parseLanes };

const DEFAULT_LANES = "radio/topics.txt";
const DEFAULT_SEEDS = 2;
const DEFAULT_SONGS_PER_RUN = 1;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MIN_RECOVERY = 10;
const DEFAULT_DURATION_SECONDS = 175;
const DEFAULT_COMFYUI_HOST = "http://localhost:8188";
const DEFAULT_HOUSEKEEPER_URL = "http://localhost:18886";

/**
 * The songs the catalogue is still missing: every lane, every engine, in the
 * order the rotation should hear them. A song that is already in the
 * catalogue is never made again.
 */
export function buildWorkList({ lanes = [], engines = [], published = [] } = {}) {
  const done = new Set(published);
  const work = [];
  for (const topic of lanes) {
    for (const engine of engines) {
      const filename = `${engine}-${topic}.mp3`;
      if (done.has(filename)) continue;
      work.push({ topic, engine, filename });
    }
  }
  return work;
}

/**
 * The seed that carries the most of the words wins. A tie goes to the seed
 * that was rendered first, so the choice is stable.
 */
export function chooseWinner(candidates = []) {
  let best = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    if (Number(candidate.percent ?? 0) > Number(best.percent ?? 0)) best = candidate;
  }
  return best;
}

function run(command, args, { cwd = process.cwd(), env = process.env, label = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: "", stderr });
        return;
      }
      const error = new Error(`${label || command} failed with status ${code}: ${stderr.trim().slice(-600)}`);
      error.statusCode = code;
      reject(error);
    });
  });
}

/**
 * Cut the opening of a render into the shape the hear lane takes, and let the
 * hear lane say what it hears. The opening is what decides a song: a render
 * that carries the words from the first minute carries them.
 */
export async function scoreRender({
  audioPath,
  sheetPath,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  hearBin = "",
  hearModel = "",
  repoRoot = process.cwd(),
  workDir = ""
}) {
  const dir = workDir || path.join(repoRoot, "artifacts", "radio-producer");
  await fs.mkdir(dir, { recursive: true });
  const windowPath = path.join(dir, "opening.wav");
  const transcriptPath = path.join(dir, "opening.txt");
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-i", audioPath,
    "-ss", "0", "-to", String(windowSeconds),
    "-ar", "16000", "-ac", "1",
    windowPath
  ], { label: "ffmpeg window" });
  await run(process.execPath, [
    path.join(repoRoot, "command", "whisper_main.mjs"),
    "--input", windowPath,
    "--bin", hearBin,
    "--model", hearModel,
    "--output", transcriptPath
  ], { label: "hear" });
  const [expected, heard] = await Promise.all([
    fs.readFile(sheetPath, "utf8"),
    fs.readFile(transcriptPath, "utf8")
  ]);
  const result = recoverRate(expected, transcriptText(heard));
  return {
    percent: Number((result.fraction * 100).toFixed(1)),
    hits: result.hits,
    total: result.total,
    transcript: transcriptText(heard)
  };
}

/**
 * Put a song into the catalogue without ever publishing half of one: the
 * render is written beside the catalogue first and then renamed into place.
 */
export async function publishSong({ sourcePath, catalogueDirectory, filename }) {
  const target = path.join(catalogueDirectory, filename);
  const staging = `${target}.part`;
  await fs.copyFile(sourcePath, staging);
  await fs.rename(staging, target);
  return target;
}

/**
 * The render of one seed, through the house keeper.
 */
async function renderSeed({
  repoRoot,
  workflow,
  lyrics,
  seed,
  duration,
  outputPath,
  comfyHost,
  housekeeperUrl
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await run(process.execPath, [
    path.join(repoRoot, "command", "music_comfyui_runner.mjs"),
    "--lyrics", lyrics,
    "--workflow-name", workflow,
    "--workflow-root", "./music/",
    "--host", comfyHost,
    "--options-json", JSON.stringify({ seed, maxDuration: duration }),
    "--output", outputPath
  ], {
    cwd: repoRoot,
    env: { ...process.env, PYA_GPU_HOUSEKEEPER_URL: housekeeperUrl },
    label: "render"
  });
  return outputPath;
}

/**
 * Write the sheet for a topic when the station does not have one yet.
 */
async function ensureSheet({ repoRoot, topic, radioDirectory, log }) {
  const sheetPath = path.join(radioDirectory, "lyrics", `song-${topic}.txt`);
  try {
    await fs.access(sheetPath);
    return sheetPath;
  } catch {
    // no sheet yet
  }
  log(`writing the lyrics for ${topic}`);
  await run(process.execPath, [
    path.join(repoRoot, "command", "run_pya_program.mjs"),
    "examples/pyash/yiniana-radio-lyrics.pya",
    "ob", "text", topic, "to", "name", "topic", "ya",
    "ob", "text", radioDirectory, "to", "name", "radio_dir"
  ], { cwd: repoRoot, label: "lyrics chain" });
  await fs.access(sheetPath);
  return sheetPath;
}

/**
 * The producer: pick the next song the catalogue is missing, make it, keep
 * the seed that carries the words, publish it.
 */
export async function produce({
  repoRoot = process.cwd(),
  lanesFile = DEFAULT_LANES,
  engines = [],
  workflows = {},
  durations = {},
  catalogueDirectory = "",
  radioDirectory = "",
  seeds = DEFAULT_SEEDS,
  songsPerRun = DEFAULT_SONGS_PER_RUN,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  minRecovery = DEFAULT_MIN_RECOVERY,
  hearBin = "",
  hearModel = "",
  comfyHost = DEFAULT_COMFYUI_HOST,
  housekeeperUrl = DEFAULT_HOUSEKEEPER_URL,
  render = renderSeed,
  score = scoreRender,
  publish = publishSong,
  log = () => {}
} = {}) {
  const lanes = parseLanes(await fs.readFile(path.resolve(repoRoot, lanesFile), "utf8"));
  const catalogue = path.resolve(repoRoot, catalogueDirectory);
  const radio = path.resolve(repoRoot, radioDirectory);
  await fs.mkdir(catalogue, { recursive: true });
  const published = (await fs.readdir(catalogue))
    .filter((name) => name.toLowerCase().endsWith(".mp3"));
  const work = buildWorkList({ lanes, engines, published });
  const summary = {
    lanes: lanes.length,
    engines: engines.length,
    published: published.length,
    queued: work.length,
    songs: []
  };
  if (!work.length) {
    log("the catalogue holds every song of the rotation");
    return summary;
  }
  const queue = work.slice(0, Math.max(1, songsPerRun));
  for (const item of queue) {
    const record = { topic: item.topic, engine: item.engine, status: "skipped", seeds: [], published: "" };
    const workflow = workflows[item.engine];
    const duration = Number(durations[item.engine] ?? DEFAULT_DURATION_SECONDS);
    const sheetPath = await ensureSheet({ repoRoot, topic: item.topic, radioDirectory: radio, log });
    const lyrics = await fs.readFile(sheetPath, "utf8");
    for (let attempt = 0; attempt < Math.max(1, seeds); attempt += 1) {
      const seed = Math.floor((Math.random() * 2 ** 31) - 2 ** 31);
      const renderPath = path.join(repoRoot, "artifacts", "radio-producer", `${item.engine}-${item.topic}-${seed}.mp3`);
      await fs.mkdir(path.dirname(renderPath), { recursive: true });
      log(`rendering ${item.engine} ${item.topic} with seed ${seed}`);
      await render({
        repoRoot,
        workflow,
        lyrics,
        seed,
        duration,
        outputPath: renderPath,
        comfyHost,
        housekeeperUrl
      });
      const measured = await score({
        audioPath: renderPath,
        sheetPath,
        windowSeconds,
        hearBin,
        hearModel,
        repoRoot
      });
      record.seeds.push({ seed, percent: measured.percent, hits: measured.hits, total: measured.total });
      log(`seed ${seed} carried ${measured.percent}% of the words`);
    }
    const winner = chooseWinner(record.seeds);
    if (!winner || Number(winner.percent ?? 0) < Number(minRecovery)) {
      record.status = "rejected";
      record.note = `the best seed carried ${winner?.percent ?? 0}% of the words, below the ${minRecovery}% the song needs`;
      log(record.note);
      summary.songs.push(record);
      continue;
    }
    const sourcePath = path.join(repoRoot, "artifacts", "radio-producer", `${item.engine}-${item.topic}-${winner.seed}.mp3`);
    const target = await publish({
      sourcePath,
      catalogueDirectory: catalogue,
      filename: item.filename
    });
    record.status = "published";
    record.seed = winner.seed;
    record.percent = winner.percent;
    record.published = target;
    log(`published ${item.filename} from seed ${winner.seed}`);
    summary.songs.push(record);
  }
  return summary;
}

/**
 * Read the producer's settings from the pyash configuration surface and run
 * the producer.
 */
export async function startProducer({ cwd = process.cwd() } = {}) {
  await loadDefaultConfig({ cwd, interpretFn: interpret });
  const engines = [];
  const workflows = {};
  const durations = {};
  for (const engine of Object.keys(resolveConfigMap("radio producer engines") ?? {})) {
    const workflow = resolveConfigMapText("radio producer engines", engine);
    if (!workflow) continue;
    engines.push(engine);
    workflows[engine] = workflow;
    durations[engine] = resolveConfigMapNum("radio producer durations", engine) ?? DEFAULT_DURATION_SECONDS;
  }
  const catalogueDirectory = resolveConfigText("radio catalogue") ?? "radio/audio";
  const radioDirectory = path.dirname(path.resolve(cwd, catalogueDirectory));
  const summary = await produce({
    repoRoot: cwd,
    lanesFile: resolveConfigText("radio producer lanes") ?? DEFAULT_LANES,
    engines,
    workflows,
    durations,
    catalogueDirectory,
    radioDirectory,
    seeds: resolveConfigNum("radio producer seeds") ?? DEFAULT_SEEDS,
    songsPerRun: resolveConfigNum("radio producer song count") ?? DEFAULT_SONGS_PER_RUN,
    windowSeconds: resolveConfigNum("radio producer window seconds") ?? DEFAULT_WINDOW_SECONDS,
    minRecovery: resolveConfigNum("radio producer min recovery") ?? DEFAULT_MIN_RECOVERY,
    hearBin: resolveConfigText("hear bin") ?? "",
    hearModel: resolveConfigText("hear model") ?? "",
    comfyHost: resolveConfigText("music host") ?? DEFAULT_COMFYUI_HOST,
    housekeeperUrl: resolveConfigText("gpu housekeeper url") ?? DEFAULT_HOUSEKEEPER_URL,
    log: (line) => process.stdout.write(`yiniana producer: ${line}\n`)
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  await startProducer({ cwd: process.cwd() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
