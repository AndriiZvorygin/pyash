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
import { channelLanes, channelProgrammes, parseChannels, readChannels } from "../program/library/radio/channels.mjs";
import { countSheetWords, songLength } from "../program/library/radio/length.mjs";
import { parseLanes } from "../program/library/radio/rotation.mjs";
import { keepFile, wordPathsFor } from "../program/library/radio/ticker.mjs";
import { measureTempo } from "../program/library/radio/tempo.mjs";
import { fileDay, songTags, stampSong } from "../program/library/radio/tags.mjs";
import { alignWordsToFile } from "./lyrics_to_srt_from_timing.mjs";
import { HEAR_EXAMPLE } from "./yiniana_transcribe_catalogue.mjs";
import { recoverRate, transcriptText } from "./yiniana_lyric_recovery.mjs";
import { readCardIfItMatches } from "./yiniana_lyrics_chain.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

// The lane parser lives with the rotation now. The producer keeps exporting
// it, so the producer's own surface does not change under its callers.
export { parseLanes };

const DEFAULT_LANES = "radio/topics.txt";
const DEFAULT_CHANNELS = "radio/channels.txt";
const DEFAULT_SEEDS = 2;
const DEFAULT_SONGS_PER_RUN = 1;
export const DEFAULT_AUDITION_SECONDS = 0;
export const DEFAULT_CARD_DEPTH = "radio";
export const DEFAULT_MIN_RECOVERY = 10;
const DEFAULT_DURATION_SECONDS = 300;
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
 * The songs the catalogue is still missing: every lane of every channel, in
 * the order the channels should hear them. A song that is already in the
 * catalogue is never made again.
 *
 * A channel carries its own voice, its own tempo and its own style, so the
 * song of a lane is made the way that channel sings it.
 */
export function buildWorkList({ channels = [], topics = [], published = [] } = {}) {
  const done = new Set(published);
  const work = [];
  for (const channel of channels) {
    for (const topic of channelLanes(channel, topics)) {
      const filename = `${channel.engine}-${topic}.mp3`;
      if (done.has(filename)) continue;
      work.push({
        topic,
        engine: channel.engine,
        filename,
        channel: channel.name,
        bpm: Number(channel.bpm ?? 0),
        style: String(channel.style ?? ""),
        own: Boolean(channel.own)
      });
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
  await run("ffmpeg", buildAuditionArgs({ audioPath, windowPath, auditionSeconds }), { label: "ffmpeg window" });
  // The song is heard through the hear lane, never by a machine named here:
  // the lane owns the engine, the chunks a long song is heard in, and what to
  // do when a chunk is refused. A song is sung, not spoken, so the lane hears
  // it with the engine the house keeps for singing.
  await run(process.execPath, [
    path.join(repoRoot, "command", "run_pya_program.mjs"),
    HEAR_EXAMPLE,
    "ob", "filename", windowPath, "to", "name", "audio", "ya",
    "ob", "filename", path.join(dir, `${stem}.srt`), "to", "name", "output"
  ], { label: "hear" });
  const wordsPath = path.join(dir, `${stem}.srt.plain.txt`);
  const [expected, heard] = await Promise.all([
    fs.readFile(sheetPath, "utf8"),
    fs.readFile(wordsPath, "utf8")
  ]);
  const result = recoverRate(expected, transcriptText(heard));
  return {
    percent: Number((result.fraction * 100).toFixed(1)),
    hits: result.hits,
    total: result.total,
    transcript: transcriptText(heard),
    transcriptPath: wordsPath,
    srtPath: path.join(dir, `${stem}.srt`)
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
 * Where the name of a song lies: beside its sheet, with the name of the name.
 */
export function songNamePath(radioDirectory, topic) {
  return path.join(radioDirectory, "lyrics", `name-${topic}.txt`);
}

/**
 * The name of a song, read from the file that holds it. A song that was never
 * named has no name, and keeps the lane it was made for.
 */
export async function readSongName({ namePath = "" } = {}) {
  if (!namePath) return "";
  try {
    const text = await fs.readFile(namePath, "utf8");
    return text.trim();
  } catch {
    return "";
  }
}

/**
 * The example that names a song. The house reads the sheet of a song and asks
 * the mind for the name of that song.
 */
export const SONG_NAME_EXAMPLE = "examples/pyash/yiniana-radio-song-name.pya";

/**
 * Name a song: ask the house for the name of the song in a sheet, and keep the
 * name beside the sheet. The name is asked once per song, and the name that is
 * kept is the name the house gives.
 */
export async function nameSong({ repoRoot, sheetPath, namePath, log = () => {} }) {
  await run(process.execPath, [
    path.join(repoRoot, "command", "run_pya_program.mjs"),
    SONG_NAME_EXAMPLE,
    "ob", "filename", sheetPath, "to", "name", "sheet", "ya",
    "ob", "filename", namePath, "to", "name", "target"
  ], { cwd: repoRoot, label: "song name" });
  log(`named the song of ${path.basename(sheetPath, ".txt")}`);
  return namePath;
}

/**
 * The name of a song, asked for when the song does not have one yet.
 *
 * A name that is already there is kept: the house names a song once, and the
 * name it gave is the name the song carries. A name that cannot be read is no
 * name, and the song keeps the lane it was made for.
 */
export async function ensureSongName({
  repoRoot,
  topic,
  radioDirectory,
  sheetPath,
  name = nameSong,
  log = () => {}
} = {}) {
  const namePath = songNamePath(radioDirectory, topic);
  let exists = true;
  try {
    await fs.access(namePath);
  } catch {
    exists = false;
  }
  if (!exists) {
    try {
      await name({ repoRoot, sheetPath, namePath, log });
    } catch (error) {
      log(`the song of ${topic} keeps the lane name: ${error?.message ?? error}`);
      return "";
    }
  }
  return readSongName({ namePath });
}

/**
 * Keep the transcript of a song: the words the house heard, with the time of
 * every line. The file is written to its place and renamed onto it, so a half
 * written transcript is never on the air.
 */
export async function keepTranscript({ srtPath = "", transcriptPath = "", log = () => {} }) {
  if (!srtPath || !transcriptPath) return "";
  const target = transcriptPath;
  try {
    await fs.access(srtPath);
  } catch {
    return "";
  }
  const staging = `${target}.part`;
  await fs.copyFile(srtPath, staging);
  await fs.rename(staging, target);
  log(`kept the transcript of ${path.basename(target)}`);
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
  bpm = 0,
  style = "",
  outputPath,
  comfyHost,
  housekeeperUrl
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const options = { seed, maxDuration: duration };
  if (Number(bpm) > 0) options.bpm = Number(bpm);
  await run(process.execPath, [
    path.join(repoRoot, "command", "music_comfyui_runner.mjs"),
    "--lyrics", lyrics,
    ...(style ? ["--style", style] : []),
    "--workflow-name", workflow,
    "--workflow-root", "./music/",
    "--host", comfyHost,
    "--options-json", JSON.stringify(options),
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
 *
 * The house sings in one voice for the lanes of the day programme, so those
 * songs carry the sheet of their lane. A channel that sings in a voice of its
 * own takes the words of the lane with it: the song it makes carries a sheet
 * of its own, so it is timed by its own hearing and not by the hearing of the
 * lane it was made for.
 */
async function ensureSheet({ repoRoot, topic, radioDirectory, engine = "", own = false, cardDepth = DEFAULT_CARD_DEPTH, log }) {
  const lyricsDirectory = path.join(radioDirectory, "lyrics");
  const words = wordPathsFor({ lyricsDirectory, engine, topic, own });
  try {
    await fs.access(words.sheetPath);
    return words.sheetPath;
  } catch {
    // no sheet yet
  }
  if (own) {
    // The words of the lane, taken into the voice of the channel.
    const lanePath = wordPathsFor({ lyricsDirectory, topic }).sheetPath;
    try {
      await fs.access(lanePath);
      await keepFile({ from: lanePath, to: words.sheetPath });
      log(`took the words of ${topic} into the voice of ${engine}`);
      return words.sheetPath;
    } catch {
      // the lane has no words yet
    }
  }
  const teachingPath = path.join(lyricsDirectory, `teaching-${topic}.txt`);
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
  await fs.access(words.sheetPath);
  return words.sheetPath;
}

/**
 * The producer: pick the next song the catalogue is missing, make it, keep
 * the seed that carries the words, publish it.
 */
export async function produce({
  repoRoot = process.cwd(),
  lanesFile = DEFAULT_LANES,
  channels = [],
  channel = "",
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
  comfyHost = DEFAULT_COMFYUI_HOST,
  housekeeperUrl = DEFAULT_HOUSEKEEPER_URL,
  render = renderSeed,
  score = scoreRender,
  publish = publishSong,
  name = nameSong,
  measure = measureTempo,
  loop = false,
  pauseSeconds = 0,
  log = () => {}
} = {}) {
  const lanes = parseLanes(await fs.readFile(path.resolve(repoRoot, lanesFile), "utf8"));
  const catalogue = path.resolve(repoRoot, catalogueDirectory);
  const radio = path.resolve(repoRoot, radioDirectory);
  await fs.mkdir(catalogue, { recursive: true });
  // The channel the producer fills. A producer that fills every channel
  // takes the house's own programme first, and the night programme after it.
  const wanted = String(channel ?? "").trim();
  const chosen = wanted ? channels.filter((entry) => entry.name === wanted) : channels;
  const listPublished = async () => (await fs.readdir(catalogue))
    .filter((name) => name.toLowerCase().endsWith(".mp3"));
  let published = await listPublished();
  const summary = {
    lanes: lanes.length,
    channels: chosen.length,
    engines: engines.length,
    published: published.length,
    queued: buildWorkList({ channels: chosen, topics: lanes, published }).length,
    songs: []
  };
  for (;;) {
    const work = buildWorkList({ channels: chosen, topics: lanes, published });
    summary.queued = work.length;
    summary.published = published.length;
    if (!work.length) {
      log("the catalogue holds every song of the rotation");
      break;
    }
    const queue = work.slice(0, Math.max(1, songsPerRun));
    for (const item of queue) {
      const record = { topic: item.topic, engine: item.engine, channel: item.channel, status: "skipped", seeds: [], published: "" };
      const workflow = workflows[item.engine];
      let sheetPath = "";
      try {
        sheetPath = await ensureSheet({
          repoRoot,
          topic: item.topic,
          radioDirectory: radio,
          engine: item.engine,
          own: item.own,
          cardDepth,
          log
        });
      } catch (error) {
        record.note = `the house has no words for ${item.topic}: ${String(error?.message ?? error)}`;
        log(record.note);
        summary.songs.push(record);
        continue;
      }
      const lyrics = await fs.readFile(sheetPath, "utf8");
      // The song is as long as its words take to sing at the pace of its
      // channel: the same sheet sung slow is a longer song than the same sheet
      // sung fast. The configured length of the engine is the longest a song of
      // that engine may be, so a slow channel can stretch and a fast one cannot
      // run away.
      const duration = songLength({
        words: countSheetWords(lyrics),
        bpm: item.bpm,
        maximumSeconds: Number(durations[item.engine] ?? DEFAULT_DURATION_SECONDS)
      });
      record.durationSeconds = duration;
      // The song is named before it is sung: a player shows the name a
      // listener would remember, not the lane the song was made for.
      const songName = await ensureSongName({
        repoRoot,
        topic: item.topic,
        radioDirectory: radio,
        sheetPath,
        name,
        log
      });
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
          bpm: item.bpm,
          style: item.style,
          outputPath: renderPath,
          comfyHost,
          housekeeperUrl
        });
        const measured = await score({
          audioPath: renderPath,
          sheetPath,
          auditionSeconds,
          repoRoot
        });
        // The pace of the render is measured, not hoped for: a song the
        // channel asked for slow is slow only if the song itself is slow.
        // The channel's pace is the one the measurement counts in, so a slow
        // song is not reported as the double of itself.
        let tempoBpm = 0;
        try {
          const pace = await measure(renderPath, { likelyBpm: item.bpm });
          tempoBpm = Number(pace?.bpm ?? pace ?? 0) || 0;
        } catch (error) {
          log(`the pace of ${item.topic} could not be measured: ${String(error?.message ?? error)}`);
        }
        record.seeds.push({
          seed,
          percent: measured.percent,
          hits: measured.hits,
          total: measured.total,
          srtPath: measured.srtPath,
          tempoBpm
        });
        log(`seed ${seed} carried ${measured.percent}% of the words at ${Math.round(tempoBpm)} bpm`);
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
      // read along with it. The words of a song are the words of that song:
      // a song sung at another tempo is timed by its own hearing, not by the
      // hearing of the lane it was made for.
      const words = wordPathsFor({
        lyricsDirectory: path.join(radio, "lyrics"),
        engine: item.engine,
        topic: item.topic,
        own: item.own
      });
      await keepTranscript({
        srtPath: winner.srtPath,
        transcriptPath: words.transcriptPath,
        log
      });
      // The words of the song, placed at the times the house heard them.
      await alignWords({
        srtPath: winner.srtPath,
        sheetPath,
        alignedPath: words.alignedPath,
        repoRoot,
        log
      });
      // The song is stamped before it is heard: a player shows who made it,
      // what it is called, and the day the render finished.
      const tags = songTags({ filename: item.filename, title: songName, date: await fileDay(sourcePath) });
      await stampSong({ targetPath: target, tags });
      record.status = "published";
      record.seed = winner.seed;
      record.percent = winner.percent;
      record.tempoBpm = Number(winner.tempoBpm ?? 0);
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
  const lanesFile = resolveConfigText("radio producer lanes") ?? DEFAULT_LANES;
  const lanes = parseLanes(await fs.readFile(path.resolve(cwd, lanesFile), "utf8"));
  // The channels are the programmes of the station: the producer fills the
  // lanes of each of them, in the voice and at the pace of that channel.
  const channelsFile = resolveConfigText("radio channels") ?? DEFAULT_CHANNELS;
  const fallback = engines.map((engine) => ({
    name: engine,
    engine,
    bpm: 0,
    style: "",
    lanes: [],
    everyLane: true
  }));
  const channels = channelProgrammes({
    channels: await readChannels(path.resolve(cwd, channelsFile), { fallback }),
    topics: lanes
  });
  const summary = await produce({
    repoRoot: cwd,
    lanesFile,
    channels,
    channel: resolveConfigText("radio producer channel") ?? "",
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
