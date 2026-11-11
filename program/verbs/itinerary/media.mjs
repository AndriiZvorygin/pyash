import path from "node:path";
import { allRemember, remember } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";
import { getExchangeRunId, lookupArtifactLocator } from "../../bridge/exchange.mjs";
import { renderSayValue } from "../say.mjs";

export function resolveFilenameFromCase(value, rememberFn) {
  const sanitizeFilenameText = (raw) => {
    if (typeof raw === "number") return String(raw);
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed === "[object Object]") return "";
    return trimmed;
  };

  const resolveGenitiveScalar = (genitive, { depth = 0, seen = new Set() } = {}) => {
    if (depth > 10) return null;
    const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
    if (chainArr.length === 0) return null;
    const [root, ...rest] = chainArr;
    let curr =
      root === "this"
        ? (state.currentEvokeRef || state.currentEvoke)
        : (typeof root === "string" && rememberFn ? rememberFn(root) : null);
    for (const part of rest) {
      if (curr && typeof curr === "object" && curr.genitive) {
        if (seen.has(curr.genitive)) return null;
        seen.add(curr.genitive);
        const resolved = resolveGenitiveScalar(curr.genitive, { depth: depth + 1, seen });
        if (resolved !== null && resolved !== undefined) curr = resolved;
      }
      if (curr && typeof curr === "object" && curr.name && rememberFn) {
        const fact = rememberFn(curr.name);
        if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
      }
      if (curr && typeof curr === "object") {
        if (curr.text !== undefined && (part === "filename" || part === "text")) {
          curr = curr.text;
          continue;
        }
        if (curr.filename !== undefined && part === "filename") {
          curr = curr.filename;
          continue;
        }
        if (curr.ob?.text !== undefined && (part === "filename" || part === "text")) {
          curr = curr.ob.text;
          continue;
        }
        if (curr.ob?.filename !== undefined && part === "filename") {
          curr = curr.ob.filename;
          continue;
        }
        if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
          curr = curr.ob.map[part];
        } else if (curr.ob && curr.ob[part] !== undefined) {
          curr = curr.ob[part];
        } else {
          curr = curr[part];
        }
      } else {
        curr = curr?.[part];
      }
    }
    if (typeof curr === "string" || typeof curr === "number" || typeof curr === "boolean") return curr;
    if (curr && typeof curr === "object") {
      if (curr.text !== undefined) return curr.text;
      if (curr.filename !== undefined) return curr.filename;
      if (curr.num !== undefined) return curr.num;
      if (curr.boolean !== undefined) return curr.boolean;
    }
    return curr ?? null;
  };

  const normalizeResolved = (resolved) => {
    const scalar = sanitizeFilenameText(resolved);
    if (scalar) return scalar;
    if (!resolved || typeof resolved !== "object") return "";

    if (resolved.genitive) {
      const byGenitive = normalizeResolved(resolveGenitiveScalar(resolved.genitive));
      if (byGenitive) return byGenitive;
    }

    const byFilename = normalizeResolved(resolved.filename);
    if (byFilename) return byFilename;

    const byText = normalizeResolved(resolved.text);
    if (byText) return byText;

    const byObFilename = normalizeResolved(resolved.ob?.filename);
    if (byObFilename) return byObFilename;

    const byObText = normalizeResolved(resolved.ob?.text);
    if (byObText) return byObText;

    const byName = sanitizeFilenameText(resolved.name);
    if (byName) return resolveByName(byName);

    const byObName = sanitizeFilenameText(resolved.ob?.name);
    if (byObName) return resolveByName(byObName);

    return "";
  };

  const resolveByName = (name) => {
    const normalizedName = sanitizeFilenameText(name);
    if (!normalizedName) return "";
    const fact = rememberFn?.(normalizedName);
    const byObFilename = normalizeResolved(fact?.ob?.filename);
    if (byObFilename) return byObFilename;
    const byToFilename = normalizeResolved(fact?.to?.filename);
    if (byToFilename) return byToFilename;
    if (fact?.ob?.genitive) {
      const resolved = resolveGenitiveScalar(fact.ob.genitive);
      const byResolved = normalizeResolved(resolved);
      if (byResolved) return byResolved;
    }
    const byObText = normalizeResolved(fact?.ob?.text);
    if (byObText) return byObText;
    const byArtifact = sanitizeFilenameText(lookupArtifactLocator(normalizedName));
    if (byArtifact) return byArtifact;
    return "";
  };

  const dependencyNamesFromVectorCase = (source) => {
    const values = Array.isArray(source?.ve?.values)
      ? source.ve.values.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    if (!values.length) return [];
    const out = [];
    let i = 0;
    while (i < values.length) {
      if (values[i] === "name") {
        i += 1;
        continue;
      }
      const words = [];
      while (i < values.length && values[i] !== "name") {
        words.push(values[i]);
        i += 1;
      }
      const token = words.join(" ").trim();
      if (token) out.push(token);
    }
    return out;
  };

  const directFilename = value?.filename;
  const directString = sanitizeFilenameText(directFilename);
  if (directString) return directString;
  if (directFilename && typeof directFilename === "object") {
    if (directFilename.genitive) {
      const byGenitive = normalizeResolved(resolveGenitiveScalar(directFilename.genitive));
      if (byGenitive) return byGenitive;
    }
    const nestedName = typeof directFilename.name === "string" ? directFilename.name.trim() : "";
    if (nestedName) {
      const byName = resolveByName(nestedName);
      if (byName) return byName;
    }
    const nestedResolved = normalizeResolved(directFilename);
    if (nestedResolved) return nestedResolved;
  }

  if (value?.genitive) {
    const byGenitive = normalizeResolved(resolveGenitiveScalar(value.genitive));
    if (byGenitive) return byGenitive;
  }

  const name = String(value?.name ?? "").trim();
  if (name) return resolveByName(name);

  const dependencies = dependencyNamesFromVectorCase(value);
  for (const dependency of dependencies) {
    const resolved = resolveByName(dependency);
    if (resolved) return resolved;
  }
  return "";
}

export function resolveFromTextPrompt(value, rememberFn) {
  if (!value) return "";
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.name === "string" && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    // Support aliased text facts (e.g. ob name text other_name) and other renderable values.
    const rendered = renderSayValue({ name: value.name }, { rememberFn });
    if (rendered !== undefined && rendered !== null) return String(rendered);
    return "";
  }
  return "";
}

export function normalizePlatformHandleToPrefix(value, fallback = "draw") {
  const raw = String(value ?? "").trim();
  const base = raw || fallback;
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function platformOutputHandleName(sentence, fallback = "draw") {
  const target = String(sentence?.to?.name ?? "").trim();
  if (target) return target;
  const subject = String(sentence?.su?.name ?? "").trim();
  if (subject) return subject;
  return fallback;
}

export function resolveNumericFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const direct = Number(entry?.num);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const obNum = Number(entry?.ob?.num);
  if (Number.isFinite(obNum) && obNum > 0) return Math.floor(obNum);
  return null;
}

export function resolveTextFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry?.text === "string") return entry.text;
  if (typeof entry?.ob?.text === "string") return entry.ob.text;
  return "";
}

export function videoImagesDir(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts images directory")?.ob?.text ?? "").trim();
  if (configured) return configured;
  const history = allRemember();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sentence = history[i];
    if (sentence?.be !== "draw") continue;
    const filename = String(sentence?.ob?.filename ?? "").trim();
    if (!filename) continue;
    if (/\.(png|jpe?g|webp|gif)$/iu.test(filename)) continue;
    return filename;
  }
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) return path.join("artifacts", runId, "draw");
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}-cuts`);
}

export function videoAudioFilename(rememberFn, { outputFile = "" } = {}) {
  const byName = String(rememberFn("video cuts audio filename")?.ob?.text ?? "").trim();
  if (byName) return byName;
  const byFilename = String(rememberFn("video cuts audio filename")?.ob?.filename ?? "").trim();
  if (byFilename) return byFilename;
  const tellingFact = rememberFn("telling");
  const tellingHandle = String(tellingFact?.ob?.name ?? "").trim();
  if (tellingHandle) {
    const locator = String(lookupArtifactLocator(tellingHandle) ?? "").trim();
    if (locator) return locator;
  }
  const history = allRemember();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sentence = history[i];
    if (sentence?.be === "say") {
      const handle = String(sentence?.ob?.name ?? "").trim();
      if (handle) {
        const locator = String(lookupArtifactLocator(handle) ?? "").trim();
        if (locator) return locator;
      }
      const filename = String(sentence?.ob?.filename ?? "").trim();
      if (filename) return filename;
    }
    if (sentence?.be === "artifact" && sentence?.as?.name === "say") {
      const filename = String(sentence?.to?.filename ?? sentence?.ob?.filename ?? "").trim();
      if (filename) return filename;
    }
  }
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}.wav`);
}

export function videoPrefix(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts prefix")?.ob?.text ?? "").trim();
  if (configured) return configured;
  void outputFile;
  return "";
}

export function videoFps(rememberFn) {
  const raw = Number(rememberFn("video cuts fps")?.ob?.num ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

export function videoThumbnailSeconds(rememberFn, firstDuration = 1) {
  const configured = Number(rememberFn("video thumbnail seconds")?.ob?.num ?? 0.8);
  const desired = Number.isFinite(configured) && configured > 0 ? configured : 0.8;
  const maxByFirst = Math.max(0.2, Number(firstDuration) * 0.8);
  return Math.min(desired, maxByFirst);
}

export function metadataTextFromRemember(rememberFn, { videoFile = "", thumbnailFile = "", extraRows = [] } = {}) {
  const lines = ["su name video metadata be map def"];
  const title = String(rememberFn("video title")?.ob?.text ?? "").trim();
  const heading = String(rememberFn("video heading")?.ob?.text ?? "").trim();
  const description = String(rememberFn("video description")?.ob?.text ?? "").trim();
  const summary = String(rememberFn("video summary")?.ob?.text ?? description).trim();
  const tags = String(rememberFn("video tags")?.ob?.text ?? "").trim();
  const video = String(videoFile ?? "").trim();
  const thumbnail = String(thumbnailFile ?? "").trim();
  if (title) lines.push(`su name title ob text ${JSON.stringify(title)} ya`);
  if (heading) lines.push(`su name heading ob text ${JSON.stringify(heading)} ya`);
  if (summary) lines.push(`su name summary ob text ${JSON.stringify(summary)} ya`);
  if (tags) lines.push(`su name tags ob text ${JSON.stringify(tags)} ya`);
  if (description) lines.push(`su name description ob text ${JSON.stringify(description)} ya`);
  if (video) lines.push(`su name video ob filename ${JSON.stringify(video)} ya`);
  if (thumbnail) lines.push(`su name thumbnail ob filename ${JSON.stringify(thumbnail)} ya`);
  for (const row of Array.isArray(extraRows) ? extraRows : []) {
    const line = String(row ?? "").trim();
    if (line) lines.push(line);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function audioFilenameLike(value = {}) {
  const direct = String(value?.ob?.filename ?? value?.filename ?? "").trim();
  if (direct && /\.(wav|mp3|ogg|opus|m4a|flac|aac)$/iu.test(direct)) return direct;
  return "";
}

export function collectAudioFilesFromSeriesFact(fact = {}, { rememberFn = remember, seenSeries = new Set() } = {}) {
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  if (!entries.length) return [];
  const seriesName = String(fact?.su?.name ?? "").trim();
  if (seriesName) {
    if (seenSeries.has(seriesName)) return [];
    seenSeries.add(seriesName);
  }
  const out = [];
  const pushIfAudio = (candidate) => {
    const filename = audioFilenameLike(candidate);
    if (filename) out.push(filename);
  };

  for (const entry of entries) {
    pushIfAudio(entry);
    pushIfAudio(entry?.ob);
    const map = entry?.ob?.map;
    if (map && typeof map === "object") {
      const audioEntry = map.audio;
      if (audioEntry) pushIfAudio(audioEntry);
      for (const value of Object.values(map)) {
        const nestedSeriesName = String(value?.ob?.name ?? "").trim();
        const nestedSeriesType = String(value?.be ?? "").trim().toLowerCase();
        if (nestedSeriesName && nestedSeriesType === "series") {
          const nestedFact = rememberFn(nestedSeriesName);
          if (nestedFact) {
            out.push(...collectAudioFilesFromSeriesFact(nestedFact, { rememberFn, seenSeries }));
          }
        }
      }
    }
  }
  return out;
}

export function clipFilenameFromCut(cut = {}) {
  const explicit = String(cut?.obFilename ?? "").trim();
  if (explicit && /\.(mp4|mov|mkv|webm)$/iu.test(explicit)) return explicit;
  const fallback = String(cut?.obText ?? "").trim();
  if (fallback && /\.(mp4|mov|mkv|webm)$/iu.test(fallback)) return fallback;
  return "";
}

