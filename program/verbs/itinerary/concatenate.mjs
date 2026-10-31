import fs from "node:fs/promises";
import path from "node:path";
import { throwErrorSentence } from "../../error.mjs";
import { allRemember, remember } from "../../remember/index.mjs";
import { resolveAgentPath } from "../../library/agent_cwd.mjs";
import { state } from "../../bridge/state.mjs";
import { parseItineraryPya } from "../../../command/itinerary_io.mjs";
import { buildTimelineItems, createConcatListFile, createVideoConcatListFile, findImageForCut, getAudioDurationSeconds, runFfmpeg, runFfmpegConcatVideos, runFfmpegConcatAudio } from "../../../command/itinerary_to_video.mjs";
import { emitExchangeSentence, getExchangeRunId, lookupArtifactLocator, recordArtifact } from "../../bridge/exchange.mjs";
import { buildRunTag, resolveItineraryCuts } from "./manifest.mjs";
import { normalizePlatformHandleToPrefix, platformOutputHandleName, videoImagesDir, videoAudioFilename, videoPrefix, videoFps, videoThumbnailSeconds, resolveFilenameFromCase, metadataTextFromRemember, clipFilenameFromCut, collectAudioFilesFromSeriesFact } from "./media.mjs";

function indexFromSeriesEntry(entry = {}, fallback = 0) {
  const by = Number(entry?.by?.num);
  if (Number.isFinite(by) && by > 0) return Math.trunc(by);
  const name = String(entry?.su?.name ?? "");
  const match = name.match(/(\d{1,6})\s*$/);
  if (match) return Number.parseInt(match[1], 10);
  return fallback;
}

function imagesByPhotographsFact(fact = {}) {
  if (!Array.isArray(fact?.ob?.series)) return new Map();
  const looksLikePhotographs = fact?.be === "photographs"
    || fact.ob.series.some(row => String(row?.be ?? "").trim().toLowerCase() === "photograph");
  if (!looksLikePhotographs) return new Map();
  const map = new Map();
  for (let i = 0; i < fact.ob.series.length; i += 1) {
    const row = fact.ob.series[i];
    const index = indexFromSeriesEntry(row, i + 1);
    const filename = String(row?.ob?.filename ?? "").trim();
    if (!index || !filename) continue;
    if (!/\.(png|jpe?g|webp|gif|bmp)$/iu.test(filename)) continue;
    map.set(index, filename);
  }
  return map;
}

async function imagesByRunManifest(runId, rememberFn) {
  const id = String(runId ?? "").trim();
  if (!id) return new Map();
  const manifestDir = resolveAgentPath(path.join("artifacts", id), { rememberFn });
  if (manifestDir.outside) return new Map();
  let names = [];
  try {
    names = await fs.readdir(manifestDir.resolved);
  } catch {
    return new Map();
  }
  const manifests = names.filter(name => name.endsWith(".series.pya")).sort();
  for (const name of manifests) {
    let text = "";
    try {
      text = await fs.readFile(path.join(manifestDir.resolved, name), "utf8");
    } catch {
      continue;
    }
    const map = new Map();
    for (const line of String(text).split(/\r?\n/u)) {
      const indexMatch = line.match(/su\s+name\s+cut\s+(\d{1,6})/u);
      const fileMatch = line.match(/ob\s+filename\s+"([^"]+)"/u);
      if (!indexMatch || !fileMatch) continue;
      const idx = Number.parseInt(indexMatch[1], 10);
      const file = String(fileMatch[1] ?? "").trim();
      if (!Number.isFinite(idx) || idx <= 0 || !file) continue;
      if (!/\.(png|jpe?g|webp|gif|bmp)$/iu.test(file)) continue;
      map.set(idx, file);
    }
    if (map.size) return map;
  }
  return new Map();
}

function imageFromPhotographFact(fact = {}) {
  if (fact?.be !== "photograph" && fact?.be !== "filename") return "";
  const byFilename = String(fact?.ob?.filename ?? "").trim();
  if (byFilename && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(byFilename)) return byFilename;
  const byName = String(fact?.ob?.name ?? "").trim();
  if (byName) {
    const locator = String(lookupArtifactLocator(byName) ?? "").trim();
    if (locator && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(locator)) return locator;
  }
  return "";
}

export async function concatenateFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const requestedOutputFile = resolveFilenameFromCase(sentence?.to, rememberFn);
  const outputHandle = platformOutputHandleName(sentence, "video");
  const outputPrefix = normalizePlatformHandleToPrefix(outputHandle, "video");
  const defaultOutputFilename = `${outputPrefix}.mp4`;
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const outputFile = requestedOutputFile
    || (runId ? path.join("artifacts", runId, defaultOutputFilename) : path.join("artifacts", "video", buildRunTag(), defaultOutputFilename));
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  const metadataFile = path.join(
    path.dirname(outputResolved.resolved),
    `${path.basename(outputResolved.resolved, path.extname(outputResolved.resolved) || ".mp4")}.metadata.pya`
  );
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const outputDir = path.dirname(outputResolved.resolved);
  const sectionOutput = outputDir.includes(`${path.sep}sections${path.sep}paragraph-`);

  const emitResultArtifacts = async () => {
    const bytes = await fs.readFile(outputResolved.resolved);
    const artifact = recordArtifact({ locator: outputResolved.resolved, producer: String(sentence?.su?.name ?? "concatenate"), bytes, kind: "video" });
    emitExchangeSentence({
      mood: "ya",
      su: { name: "concatenate result" },
      ob: { filename: outputResolved.resolved },
      be: "concatenate",
      by: { num: bytes.length },
      accordingto: artifact?.su?.name ? { name: artifact.su.name } : undefined
    });

    const thumbnailFilename = resolveFilenameFromCase({ name: "thumbnail" }, rememberFn);
    const extraRows = [];
    if (sectionOutput) {
      const phraseCutsPath = path.join(outputDir, "section-phrase-cuts.series.pya");
      const promptItineraryPath = path.join(outputDir, "section-draw-prompts.series.pya");
      const drawDirPath = path.join(outputDir, "draw");
      try {
        const stat = await fs.stat(phraseCutsPath);
        if (stat.isFile()) {
          extraRows.push('su name image prompt units ob text "phrase" ya');
          extraRows.push("su name image cuts itinerary ob filename " + JSON.stringify(phraseCutsPath) + " ya");
          const phraseParsed = parseItineraryPya(await fs.readFile(phraseCutsPath, "utf8"));
          const phraseCuts = Array.isArray(phraseParsed?.cuts) ? phraseParsed.cuts : [];
          const totalPhrases = phraseCuts.length;
          const totalDuration = phraseCuts.reduce(
            (sum, row) => sum + Math.max(0, Number(row?.until ?? 0) - Number(row?.since ?? 0)),
            0
          );
          const avgPhraseDuration = totalPhrases > 0 ? Number((totalDuration / totalPhrases).toFixed(3)) : 0;
          extraRows.push("su name total_phrases ob num " + String(totalPhrases) + " ya");
          extraRows.push("su name avg_phrase_duration ob num " + String(avgPhraseDuration) + " ya");
        }
      } catch {}
      try {
        const stat = await fs.stat(promptItineraryPath);
        if (stat.isFile()) {
          extraRows.push(`su name image prompt itinerary ob filename ${JSON.stringify(promptItineraryPath)} ya`);
        }
      } catch {}
      try {
        const stat = await fs.stat(drawDirPath);
        if (stat.isDirectory()) {
          extraRows.push(`su name image artifacts directory ob filename ${JSON.stringify(drawDirPath)} ya`);
        }
      } catch {}
    }
    const metadataText = metadataTextFromRemember(rememberFn, {
      videoFile: outputResolved.resolved,
      thumbnailFile: thumbnailFilename,
      extraRows
    });
    await fs.writeFile(metadataFile, metadataText, "utf8");
    const metadataBytes = await fs.readFile(metadataFile);
    const metadataArtifact = recordArtifact({
      locator: metadataFile,
      producer: String(sentence?.su?.name ?? "concatenate"),
      bytes: metadataBytes,
      kind: "metadata"
    });
    emitExchangeSentence({
      mood: "ya",
      su: { name: "concatenate metadata" },
      ob: { filename: metadataFile },
      be: "artifact",
      by: { num: metadataBytes.length },
      accordingto: metadataArtifact?.su?.name ? { name: metadataArtifact.su.name } : undefined
    });
  };

  const clipCandidates = cuts.map((cut) => clipFilenameFromCut(cut));
  const allClipRows = cuts.length > 0 && clipCandidates.length === cuts.length && clipCandidates.every(Boolean);
  if (allClipRows) {
    const clipFiles = [];
    for (let i = 0; i < clipCandidates.length; i += 1) {
      const resolved = resolveAgentPath(clipCandidates[i], { rememberFn });
      if (resolved.outside) {
        throwErrorSentence({
          name: "concatenate defective",
          message: `concatenate defective: outside agent cwd (${resolved.agentCwd})`,
          from: { name: "concatenate" },
          raw: { sentence }
        });
      }
      clipFiles.push(resolved.resolved);
    }
    const { dir, file } = await createVideoConcatListFile(clipFiles);
    try {
      await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
      await runFfmpegConcatVideos({
        listFile: file,
        outputFile: outputResolved.resolved
      });
      await emitResultArtifacts();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
  }

  const outputFileForDefaults = requestedOutputFile || defaultOutputFilename;
  const configuredImagesDir = String(rememberFn("video cuts images directory")?.ob?.text ?? "").trim();
  const imagesDir = configuredImagesDir
    ? videoImagesDir(rememberFn, { outputFile: outputFileForDefaults })
    : (sectionOutput ? path.join(outputDir, "draw") : videoImagesDir(rememberFn, { outputFile: outputFileForDefaults }));
  const audioFile = videoAudioFilename(rememberFn, { outputFile: outputFileForDefaults });
  const imageDirResolved = resolveAgentPath(imagesDir, { rememberFn });
  const audioResolved = resolveAgentPath(audioFile, { rememberFn });
  if (imageDirResolved.outside || audioResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${imageDirResolved.agentCwd || audioResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const configuredPrefix = String(rememberFn("video cuts prefix")?.ob?.text ?? "").trim();
  const prefix = configuredPrefix || (sectionOutput ? "section-draw-stage" : videoPrefix(rememberFn, { outputFile: outputFileForDefaults }));
  const fps = videoFps(rememberFn);
  const audioDurationSeconds = await getAudioDurationSeconds(audioResolved.resolved);
  const timeline = buildTimelineItems(cuts, audioDurationSeconds);
  let imageByIndex = (() => {
    const fromEvoke = imagesByPhotographsFact(state.currentEvokeRef ?? {});
    if (fromEvoke.size) return fromEvoke;
    const history = allRemember();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const mapped = imagesByPhotographsFact(history[i]);
      if (mapped.size) return mapped;
    }
    return new Map();
  })();
  if (!imageByIndex.size) {
    const runManifestMap = await imagesByRunManifest(runId, rememberFn);
    if (runManifestMap.size) imageByIndex = runManifestMap;
  }
  const items = [];
  for (const cut of timeline) {
    const mapped = String(imageByIndex.get(cut.index) ?? "").trim();
    let image = "";
    if (mapped && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(mapped)) {
      const mappedResolved = resolveAgentPath(mapped, { rememberFn });
      if (!mappedResolved.outside) {
        try {
          const stat = await fs.stat(mappedResolved.resolved);
          if (stat.isFile()) image = mappedResolved.resolved;
        } catch {
          image = "";
        }
      }
    }
    if (!image) {
      const fallbackDirs = [imageDirResolved.resolved];
      const sectionDrawDir = path.join(outputDir, "draw");
      if (!fallbackDirs.includes(sectionDrawDir)) fallbackDirs.push(sectionDrawDir);
      for (const candidateDir of fallbackDirs) {
        try {
          image = await findImageForCut(candidateDir, prefix, cut.index);
          if (image) break;
        } catch {
          try {
            image = await findImageForCut(candidateDir, "", cut.index);
            if (image) break;
          } catch {
            image = "";
          }
        }
      }
      if (!image) {
        image = await findImageForCut(imageDirResolved.resolved, prefix, cut.index);
      }
    }
    items.push({ ...cut, image });
  }

  const thumbnailImage = (() => {
    const fromEvoke = imageFromPhotographFact(state.currentEvokeRef ?? {});
    if (fromEvoke) return fromEvoke;
    const history = allRemember();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const fromFact = imageFromPhotographFact(history[i]);
      if (fromFact) return fromFact;
    }
    return "";
  })();
  if (thumbnailImage && items.length) {
    const first = items[0];
    const firstDuration = Number(first?.duration ?? 0);
    const thumbDuration = videoThumbnailSeconds(rememberFn, firstDuration);
    if (Number.isFinite(firstDuration) && firstDuration > 0.1 && thumbDuration > 0.05 && thumbDuration < firstDuration) {
      const remainder = Math.max(0.05, firstDuration - thumbDuration);
      const thumbItem = { ...first, image: thumbnailImage, duration: thumbDuration };
      const firstRemainder = { ...first, duration: remainder };
      items.splice(0, 1, thumbItem, firstRemainder);
    } else {
      items[0] = { ...first, image: thumbnailImage };
    }
  }
  const { dir, file } = await createConcatListFile(items);
  try {
    await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
    await runFfmpeg({
      listFile: file,
      audioFile: audioResolved.resolved,
      outputFile: outputResolved.resolved,
      fps
    });
    await emitResultArtifacts();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
}

export async function concatenateAudioFromNameSeries(
  sentence,
  { remember: rememberFn = remember, runConcatAudioFn = runFfmpegConcatAudio } = {}
) {
  const sourceName = String(sentence?.from?.name ?? "").trim();
  if (!sourceName) {
    throwErrorSentence({
      name: "concatenate defective",
      message: "concatenate defective: missing from name series",
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const sourceFact = rememberFn(sourceName);
  if (!sourceFact || sourceFact.be !== "series" || !Array.isArray(sourceFact?.ob?.series)) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: ${sourceName} not series`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const audioFilesRaw = collectAudioFilesFromSeriesFact(sourceFact, { rememberFn });
  if (!audioFilesRaw.length) {
    throwErrorSentence({
      name: "concatenate defective",
      message: "concatenate defective: no audio rows in series",
      from: { name: "concatenate" },
      raw: { sourceName }
    });
  }

  const outputHandle = platformOutputHandleName(sentence, "audio");
  const outputPrefix = normalizePlatformHandleToPrefix(outputHandle, "audio");
  const requestedOutputFile = resolveFilenameFromCase(sentence?.to, rememberFn);
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const defaultOutputFilename = `${outputPrefix}.opus`;
  const outputFile = requestedOutputFile
    || (runId ? path.join("artifacts", runId, defaultOutputFilename) : path.join("artifacts", "audio", buildRunTag(), defaultOutputFilename));
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const audioFiles = [];
  for (const candidate of audioFilesRaw) {
    const resolved = resolveAgentPath(candidate, { rememberFn });
    if (resolved.outside) {
      throwErrorSentence({
        name: "concatenate defective",
        message: `concatenate defective: outside agent cwd (${resolved.agentCwd})`,
        from: { name: "concatenate" },
        raw: { sentence }
      });
    }
    audioFiles.push(resolved.resolved);
  }

  const { dir, file } = await createVideoConcatListFile(audioFiles);
  try {
    await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
    await runConcatAudioFn({ listFile: file, outputFile: outputResolved.resolved });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const bytes = await fs.readFile(outputResolved.resolved);
  const artifact = recordArtifact({
    locator: outputResolved.resolved,
    producer: String(sentence?.su?.name ?? "concatenate"),
    bytes,
    kind: "audio"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: "concatenate result" },
    ob: { filename: outputResolved.resolved },
    be: "concatenate",
    by: { num: bytes.length },
    accordingto: artifact?.su?.name ? { name: artifact.su.name } : undefined
  });
  return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
}

export const concatenate = concatenateFromNameItinerary;

export const signatures = [
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "series", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "series", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "audio", "from", "name", "series", "fromstate", "wo", "series", "to", "filename"], handler: concatenateAudioFromNameSeries },
  { signatureWords: ["be", "concatenate", "become", "wo", "audio", "from", "name", "series", "fromstate", "wo", "series"], handler: concatenateAudioFromNameSeries },
];

