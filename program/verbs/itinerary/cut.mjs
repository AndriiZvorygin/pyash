import fs from "node:fs/promises";
import { throwErrorSentence } from "../../error.mjs";
import { remember } from "../../remember/index.mjs";
import { resolveAgentPath } from "../../library/agent_cwd.mjs";
import { parseSrtToCuts } from "../../../command/itinerary_io.mjs";
import { lookupArtifactLocator } from "../../bridge/exchange.mjs";
import { windowCuts, splitOversizedCut } from "./window.mjs";
import { persistItineraryManifest } from "./manifest.mjs";
import { hasSpeakableContent, splitProseParagraphs, splitProsePhrases, splitProseSentences } from "../../library/prose_segmentation.mjs";
import { sectionWordTokens, validateSectionCoverage } from "./cuts.mjs";

export async function cutFromFilenameToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const source = (() => {
    const direct = String(sentence?.from?.filename ?? "").trim();
    if (direct) return direct;
    const fromName = String(sentence?.from?.name ?? "").trim();
    if (!fromName) return "";
    const byArtifact = lookupArtifactLocator(fromName);
    if (typeof byArtifact === "string" && byArtifact.trim()) return byArtifact.trim();
    const fact = rememberFn?.(fromName);
    const byFact = String(fact?.ob?.filename ?? fact?.to?.filename ?? "").trim();
    return byFact;
  })();
  const targetName = String(sentence?.to?.name ?? "").trim();
  const hasDuration = Number.isFinite(Number(sentence?.during?.num));
  const duration = hasDuration ? Number(sentence?.during?.num) : null;
  if (!source || !targetName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from filename and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const { resolved, outside, agentCwd } = resolveAgentPath(source, { rememberFn });
  if (outside) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: outside agent cwd (${agentCwd})`,
      from: { name: "cut" },
      raw: { source }
    });
  }
  const srtText = await fs.readFile(resolved, "utf8");
  const rawCuts = parseSrtToCuts(srtText);
  const window = Number.isFinite(duration) && duration > 0 ? duration : null;
  const looksSectionTagged = rawCuts.length > 1 && rawCuts.every((cut) => /^\s*\[[^\]]+\]\s+/u.test(String(cut?.obText ?? "")));
  const windowedCuts = (!window)
    ? rawCuts
    : (looksSectionTagged && window >= 120)
    ? rawCuts
    : windowCuts(rawCuts, window);
  const cuts = (!window)
    ? windowedCuts
    : windowedCuts.flatMap((cut) => splitOversizedCut(cut, window));
  const series = [];
  let outIndex = 1;
  for (let i = 0; i < cuts.length; i += 1) {
    const base = cuts[i];
    const baseSince = Number(base.since ?? 0);
    const baseUntil = Number(base.until ?? baseSince + window);
    const text = String(base.obText ?? "");
    if (!(Number.isFinite(baseSince) && Number.isFinite(baseUntil))) continue;
    const since = baseSince;
    const fitsWindow = !window || (baseUntil - baseSince) <= window + 1e-6;
    const until = Math.max(since, fitsWindow && window ? Math.min(baseUntil, since + window) : baseUntil);
    series.push({
      mood: "ya",
      su: { name: `cut ${String(outIndex).padStart(3, "0")}` },
      since: { num: since },
      until: { num: until },
      ob: { text },
      be: "cut"
    });
    outIndex += 1;
  }
  const manifestFilename = await persistItineraryManifest({
    sentence,
    itineraryName: targetName,
    series,
    rememberFn,
    fallbackPrefix: "cut"
  });
  const ob = manifestFilename ? { series, filename: manifestFilename } : { series };
  return { ob, be: "itinerary" };
}

export async function cutFromNameFilenameToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const sourceName = String(sentence?.from?.name ?? "").trim();
  if (!sourceName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from name filename and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const sourceFact = rememberFn(sourceName);
  const sourceFilename = String(sourceFact?.ob?.filename ?? "").trim();
  if (!sourceFilename) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut source missing filename",
      from: { name: "cut" },
      raw: { sourceName, sourceFact }
    });
  }
  return cutFromFilenameToNameItinerary(
    {
      ...sentence,
      from: { filename: sourceFilename }
    },
    { remember: rememberFn }
  );
}

function resolveCutTextSource(fromCase = {}, { rememberFn = remember } = {}) {
  if (typeof fromCase?.text === "string") return fromCase.text;
  const fromName = String(fromCase?.name ?? "").trim();
  if (!fromName) return "";
  const fact = rememberFn(fromName);
  return String(fact?.ob?.text ?? "");
}

export async function cutFromTextToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const targetName = String(sentence?.to?.name ?? "").trim();
  const sourceText = resolveCutTextSource(sentence?.from, { rememberFn });
  if (!sourceText || !targetName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from text and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const mode = String(sentence?.as?.text ?? "").trim().toLowerCase();
  if (mode === "sentence" && !hasSpeakableContent(sourceText)) {
    throwErrorSentence({
      name: "cut defective",
      message: "cut defective: sentence source has no speakable content",
      from: { name: "cut" },
      raw: { sentence, sourceText }
    });
  }
  const sections = mode === "sentence"
    ? splitProseSentences(sourceText, { stripMarkdown: true })
    : mode === "phrase"
    ? splitProsePhrases(sourceText)
    : splitProseParagraphs(sourceText);
  if (mode === "sentence" || mode === "phrase") {
    const invalid = sections.find((entry) => !hasSpeakableContent(entry));
    if (invalid !== undefined) {
      throwErrorSentence({
        name: "cut defective",
        message: mode === "phrase"
          ? "cut defective: phrase splitting produced unspeakable phrase"
          : "cut defective: sentence splitting produced unspeakable sentence",
        from: { name: "cut" },
        raw: { sentence, section: invalid }
      });
    }
    if (!sections.length && hasSpeakableContent(sourceText)) {
      throwErrorSentence({
        name: "cut defective",
        message: mode === "phrase"
          ? "cut defective: phrase splitting produced no speakable phrases"
          : "cut defective: sentence splitting produced no speakable sentences",
        from: { name: "cut" },
        raw: { sentence, sourceText }
      });
    }
    const micro = sections.find((entry) => {
      const tokens = sectionWordTokens(entry);
      return tokens.length === 1 && tokens[0].length === 1;
    });
    if (micro !== undefined) {
      throwErrorSentence({
        name: "cut defective",
        message: mode === "phrase"
          ? "cut defective: phrase splitting produced micro phrase"
          : "cut defective: sentence splitting produced micro sentence",
        from: { name: "cut" },
        raw: { sentence, section: micro }
      });
    }
  }
  if (!sections.length) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut source text is empty",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  let resolvedSections = sections;
  try {
    validateSectionCoverage({ sourceText, sections: resolvedSections, mode, sentence });
  } catch (err) {
    // Sentence mode must stay resilient: if strict token coverage fails due to
    // noisy mixed-content inputs, fall back to one full speakable section
    // instead of aborting the whole refinery.
    if (mode === "sentence" || mode === "phrase") {
      const fallback = String(sourceText ?? "").replace(/\s+/gu, " ").trim();
      if (hasSpeakableContent(fallback)) {
        resolvedSections = [fallback];
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  const requestedDurationTotal = Number(sentence?.during?.num);
  const requestedSentenceDuration = Number(sentence?.during?.sentence);
  const hasRequestedTotalDuration = Number.isFinite(requestedDurationTotal) && requestedDurationTotal > 0;
  const hasRequestedSentenceDuration = Number.isFinite(requestedSentenceDuration) && requestedSentenceDuration > 0;
  const sectionDuration = hasRequestedTotalDuration
    ? (requestedDurationTotal / resolvedSections.length)
    : hasRequestedSentenceDuration
    ? requestedSentenceDuration
    : 1;
  const series = resolvedSections.map((sectionText, index) => ({
    mood: "ya",
    su: { name: `cut ${String(index + 1).padStart(3, "0")}` },
    since: {
      num: (hasRequestedTotalDuration || hasRequestedSentenceDuration)
        ? Number(index * sectionDuration)
        : Number(index)
    },
    until: {
      num: (hasRequestedTotalDuration || hasRequestedSentenceDuration)
        ? Number((index + 1) * sectionDuration)
        : Number(index + 1)
    },
    ob: { text: sectionText },
    be: "cut"
  }));
  const manifestFilename = await persistItineraryManifest({
    sentence,
    itineraryName: targetName,
    series,
    rememberFn,
    fallbackPrefix: "cut"
  });
  const ob = manifestFilename ? { series, filename: manifestFilename } : { series };
  return { ob, be: "itinerary" };
}

export const cut = cutFromFilenameToNameItinerary;

export const signatures = [
  { signatureWords: ["be", "cut", "by", "num", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "num", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "sentence", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "during", "num", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "during", "sentence", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "sentence", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "during", "num", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "during", "sentence", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "sentence", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "sentence", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "sentence", "from", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "as", "text", "during", "num", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "as", "text", "during", "sentence", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "name", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "during", "sentence", "from", "name", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "as", "text", "during", "num", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "as", "text", "during", "sentence", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "during", "num", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "during", "sentence", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "during", "num", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "during", "sentence", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "by", "num", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "by", "num", "during", "sentence", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "by", "num", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "as", "text", "by", "num", "during", "sentence", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "from", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "sentence", "from", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "from", "name", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "sentence", "from", "name", "text", "as", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
];

