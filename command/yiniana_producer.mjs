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
import { resolveConfigBool, resolveConfigMap, resolveConfigMapNum, resolveConfigMapText, resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { parseLanes } from "../program/library/radio/rotation.mjs";
import { alignedPathFor, keepFile, srtPathFor, transcriptPathFor } from "../program/library/radio/ticker.mjs";
import { fileDay, songTags, stampSong } from "../program/library/radio/tags.mjs";
import { alignWordsToFile } from "./lyrics_to_srt_from_timing.mjs";
import { recoverRate, transcriptText } from "./yiniana_lyric_recovery.mjs";
import { readCardIfItMatches } from "./yiniana_lyrics_chain.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

// The lane parser lives with the rotation now. The producer keeps exporting
// it, so the producer's own surface does not change under its callers.
export { parseLanes };

const DEFAULT_LANES = "radio/topics.txt";
const DEFAULT_SEEDS = 2;
const DEFAULT_SONGS_PER_RUN = 1;
export const DEFAULT_AUDITION_SECONDS = 0;
export const DEFAULT_CARD_DEPTH = "radio";
export const DEFAULT_MIN_RECOVERY = 10;
const DEFAULT_DURATION_SECONDS = 175;
const DEFAULT_COMFYUI_HOST = "http://localhost:8188";
const DEFAULT_HOUSEKEEPER_URL = "http://localhost:18886";

/**
 * A seed for a render. The seed is a whole number the workflow takes as it
 * is, and it is never negative: a node that refuses a negative seed fails
 * the whole render, so the lottery draws from the non-negative range only.
 */
export function pickSeed(random = Math.random) {
  return Math.floor(random() * 2 ** 32);
}

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
 * The ffmpeg arguments that cut the render into the shape the hear lane
 * takes. The whole render is heard by default; a positive number of seconds
 * hears only the opening.
 */
export function buildAuditionArgs({ audioPath, windowPath, auditionSeconds = DEFAULT_AUDITION_SECONDS }) {
  const args = ["-v", "error", "-y", "-i", audioPath];
  if (Number(auditionSeconds) > 0) {
    args.push("-ss", "0", "-to", String(auditionSeconds));
  }
  args.push("-ar", "16000", "-ac", "1", windowPath);
  return args;
}

/**
 * Cut the render into the shape the hear lane takes, and let the hear lane
 * say what it hears. The whole render is heard by default: a window that
 * covers only the opening judges a song by its intro, and a song whose
 * words arrive late is thrown away for it.
 */
export async function scoreRender({
  audioPath,
  sheetPath,
  auditionSeconds = DEFAULT_AUDITION_SECONDS,
  hearBin = "",
  hearModel = "",
  repoRoot = process.cwd(),
  workDir = ""
}) {
  const dir = workDir || path.join(repoRoot, "artifacts", "radio-producer");
  await fs.mkdir(dir, { recursive: true });
  // Every render is heard on its own: the transcript of a song is kept with
  // the song, not overwritten by the next one. The subtitle beside it carries
  // the time of every line, which is what a ticker follows.
  const stem = path.basename(audioPath, path.extname(audioPath));
  const windowPath = path.join(dir, `${stem}.wav`);
  const transcriptPath = path.join(dir, `${stem}.txt`);
  await run("ffmpeg", buildAuditionArgs({ audioPath, windowPath, auditionSeconds }), { label: "ffmpeg window" });
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
    transcript: transcriptText(heard),
    transcriptPath,
    srtPath: srtPathFor(transcriptPath)
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
 * Keep the transcript of a song beside its sheet: the words the house heard,
 * with the time of every line. The file is written beside the sheet and
 * renamed onto it, so a half written transcript is never on the air.
 */
export async function keepTranscript({ srtPath = "", sheetPath = "", log = () => {} }) {
  if (!srtPath || !sheetPath) return "";
  const target = transcriptPathFor(sheetPath);
  try {
    await fs.access(srtPath);
  } catch {
    return "";
  }
  const staging = `${target}.part`;
  await fs.copyFile(srtPath, staging);
  await fs.rename(staging, target);
  log(`kept the transcript of ${path.basename(sheetPath, ".txt")}`);
  return target;
}

/**
 * Place the words of the song at the times the house heard them.
 *
 * The hear lane says what it heard, and what it heard is not always the song:
 * a word can come out of the mouth of the song garbled. So the transcript is
 * not what a listener reads. The house's own alignment is: the words of the
 * sheet, placed at the times of the transcript.
 *
 * The alignment is written in the work folder, where its report lies too, and
 * the words are then kept beside the sheet of the song.
 *
 * A song whose words cannot be placed is left with its sheet alone.
 */
export async function alignWords({
  srtPath = "",
  sheetPath = "",
  alignedPath = "",
  workDirectory = "",
  repoRoot = process.cwd(),
  log = () => {}
} = {}) {
  if (!srtPath || !sheetPath || !alignedPath) return "";
  try {
    await fs.access(srtPath);
  } catch {
    return "";
  }
  const work = workDirectory || path.join(repoRoot, "artifacts", "radio-producer");
  await fs.mkdir(work, { recursive: true });
  const staged = path.join(work, `${path.basename(srtPath, ".srt")}.aligned.srt`);
  const placed = await alignWordsToFile({
    sheetPath,
    timingPath: srtPath,
    outputPath: staged,
    log: (line) => log(`${path.basename(sheetPath, ".txt")}: ${line}`)
  });
  if (!placed) return "";
  await keepFile({ from: staged, to: alignedPath });
  return alignedPath;
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
 * The examples that write a sheet. A card the radio already has is never
 * written twice: when the card is there and it is the card the radio wants,
 * only the hymn is written from it.
 */
export const SHEET_EXAMPLES = {
  hymn: "examples/pyash/yiniana-radio-hymn.pya",
  chain: "examples/pyash/yiniana-radio-lyrics.pya"
};

export async function chooseSheetExample({ teachingPath, cardDepth = DEFAULT_CARD_DEPTH }) {
  const card = await readCardIfItMatches(teachingPath, cardDepth);
  return card ? SHEET_EXAMPLES.hymn : SHEET_EXAMPLES.chain;
}

/**
 * Write the sheet for a topic when the station does not have one yet.
 */
async function ensureSheet({ repoRoot, topic, radioDirectory, cardDepth = DEFAULT_CARD_DEPTH, log }) {
  const sheetPath = path.join(radioDirectory, "lyrics", `song-${topic}.txt`);
  try {
    await fs.access(sheetPath);
    return sheetPath;
  } catch {
    // no sheet yet
  }
  const teachingPath = path.join(radioDirectory, "lyrics", `teaching-${topic}.txt`);
  const example = await chooseSheetExample({ teachingPath, cardDepth });
  const card = example === SHEET_EXAMPLES.hymn;
  log(card
    ? `writing the lyrics for ${topic} from the card it already has`
    : `writing the lyrics for ${topic}`);
  await run(process.execPath, [
    path.join(repoRoot, "command", "run_pya_program.mjs"),
    example,
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
  auditionSeconds = DEFAULT_AUDITION_SECONDS,
  minRecovery = DEFAULT_MIN_RECOVERY,
  cardDepth = DEFAULT_CARD_DEPTH,
  hearBin = "",
  hearModel = "",
  comfyHost = DEFAULT_COMFYUI_HOST,
  housekeeperUrl = DEFAULT_HOUSEKEEPER_URL,
  render = renderSeed,
  score = scoreRender,
  publish = publishSong,
  loop = false,
  pauseSeconds = 0,
  log = () => {}
} = {}) {
  const lanes = parseLanes(await fs.readFile(path.resolve(repoRoot, lanesFile), "utf8"));
  const catalogue = path.resolve(repoRoot, catalogueDirectory);
  const radio = path.resolve(repoRoot, radioDirectory);
  await fs.mkdir(catalogue, { recursive: true });
  const listPublished = async () => (await fs.readdir(catalogue))
    .filter((name) => name.toLowerCase().endsWith(".mp3"));
  let published = await listPublished();
  const summary = {
    lanes: lanes.length,
    engines: engines.length,
    published: published.length,
    queued: buildWorkList({ lanes, engines, published }).length,
    songs: []
  };
  for (;;) {
    const work = buildWorkList({ lanes, engines, published });
    summary.queued = work.length;
    summary.published = published.length;
    if (!work.length) {
      log("the catalogue holds every song of the rotation");
      break;
    }
    const queue = work.slice(0, Math.max(1, songsPerRun));
    for (const item of queue) {
      const record = { topic: item.topic, engine: item.engine, status: "skipped", seeds: [], published: "" };
      const workflow = workflows[item.engine];
      const duration = Number(durations[item.engine] ?? DEFAULT_DURATION_SECONDS);
      const sheetPath = await ensureSheet({ repoRoot, topic: item.topic, radioDirectory: radio, cardDepth, log });
      const lyrics = await fs.readFile(sheetPath, "utf8");
      for (let attempt = 0; attempt < Math.max(1, seeds); attempt += 1) {
        const seed = pickSeed();
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
          auditionSeconds,
          hearBin,
          hearModel,
          repoRoot
        });
        record.seeds.push({
          seed,
          percent: measured.percent,
          hits: measured.hits,
          total: measured.total,
          srtPath: measured.srtPath
        });
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
      // The words the house heard are kept with the song, so a listener can
      // read along with it.
      await keepTranscript({
        srtPath: winner.srtPath,
        sheetPath,
        log
      });
      // The words of the song, placed at the times the house heard them.
      await alignWords({
        srtPath: winner.srtPath,
        sheetPath,
        alignedPath: alignedPathFor(sheetPath),
        repoRoot,
        log
      });
      // The song is stamped before it is heard: a player shows who made it,
      // what it is called, and the day the render finished.
      const tags = songTags({ filename: item.filename, date: await fileDay(sourcePath) });
      await stampSong({ targetPath: target, tags });
      record.status = "published";
      record.seed = winner.seed;
      record.percent = winner.percent;
      record.published = target;
      log(`published ${item.filename} from seed ${winner.seed}`);
      summary.songs.push(record);
    }
    if (!loop) break;
    published = await listPublished();
    if (pauseSeconds > 0) {
      log(`waiting ${pauseSeconds}s before the next song`);
      await new Promise((resolve) => setTimeout(resolve, pauseSeconds * 1000));
    }
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
    auditionSeconds: resolveConfigNum("radio producer audition seconds") ?? DEFAULT_AUDITION_SECONDS,
    minRecovery: resolveConfigNum("radio producer min recovery") ?? DEFAULT_MIN_RECOVERY,
    cardDepth: resolveConfigText("radio card depth") ?? DEFAULT_CARD_DEPTH,
    loop: resolveConfigBool("radio producer loop") ?? false,
    pauseSeconds: resolveConfigNum("radio producer pause seconds") ?? 0,
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
