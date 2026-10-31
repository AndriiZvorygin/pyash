import fs from "node:fs/promises";
import path from "node:path";
import { throwErrorSentence } from "../../error.mjs";
import { remember } from "../../remember/index.mjs";
import { resolveAgentPath } from "../../library/agent_cwd.mjs";
import { parseItineraryPya, renderItineraryPya } from "../../../command/itinerary_io.mjs";
import { emitExchangeSentence, getExchangeRunId, recordArtifact } from "../../bridge/exchange.mjs";
import { normalizePlatformHandleToPrefix, platformOutputHandleName } from "./media.mjs";
import { itineraryCutsFromSeriesFact } from "./window.mjs";

export function buildRunTag(now = new Date()) {
  const iso = now.toISOString();
  const stamp = iso.replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return `${stamp}-${rand}`;
}

export function itinerarySuffixFromSentence(sentence = {}) {
  const raw = Number(sentence?.by?.num);
  if (!Number.isFinite(raw) || raw < 0) return "";
  return `-${String(Math.trunc(raw)).padStart(3, "0")}`;
}

export async function persistItineraryManifest({
  sentence = {},
  itineraryName = "itinerary",
  series = [],
  rememberFn = remember,
  fallbackPrefix = "itinerary"
} = {}) {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const outputHandle = platformOutputHandleName(sentence, fallbackPrefix);
  const outputPrefix = `${normalizePlatformHandleToPrefix(outputHandle, fallbackPrefix)}${itinerarySuffixFromSentence(sentence)}`;
  const outputRoot = runId
    ? path.join("artifacts", runId)
    : path.join("artifacts", fallbackPrefix, buildRunTag());
  const outputFile = path.join(outputRoot, `${outputPrefix}.series.pya`);
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "itinerary" },
      raw: { sentence }
    });
  }
  await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
  const itineraryText = renderItineraryPya({
    itineraryName,
    cuts: series.map((entry, idx) => ({
      index: Number(entry?.by?.num ?? (idx + 1)),
      name: String(entry?.su?.name ?? `cut ${String(idx + 1).padStart(3, "0")}`),
      since: Number(entry?.since?.num ?? 0),
      until: Number(entry?.until?.num ?? entry?.since?.num ?? 0),
      obText: entry?.ob?.text !== undefined ? String(entry?.ob?.text ?? "") : undefined,
      obFilename: entry?.ob?.filename !== undefined ? String(entry?.ob?.filename ?? "") : undefined,
      sourceText: entry?.fromtext?.text !== undefined ? String(entry?.fromtext?.text ?? "") : undefined,
      workflowName: entry?.as?.text !== undefined ? String(entry?.as?.text ?? "") : undefined
    }))
  });
  // Retry/resume safety: if manifest already exists for this run path, reuse it
  // so non-deterministic stages (e.g. promptify) do not rewrite and trip hash checks.
  try {
    await fs.access(outputResolved.resolved);
    const existingText = await fs.readFile(outputResolved.resolved, "utf8");
    if (existingText !== itineraryText) {
      throw new Error("itinerary manifest content changed");
    }
    const existingBytes = Buffer.from(existingText, "utf8");
    const existingArtifact = recordArtifact({
      locator: outputResolved.resolved,
      producer: String(sentence?.su?.name ?? fallbackPrefix),
      bytes: existingBytes,
      kind: "series"
    });
    emitExchangeSentence({
      mood: "ya",
      su: { name: `${fallbackPrefix} itinerary manifest` },
      ob: { filename: outputResolved.resolved },
      be: "artifact",
      accordingto: existingArtifact?.su?.name ? { name: existingArtifact.su.name } : undefined
    });
    return outputResolved.resolved;
  } catch {
    // No existing manifest yet; continue and write fresh below.
  }
  await fs.writeFile(outputResolved.resolved, itineraryText, "utf8");
  const itineraryBytes = await fs.readFile(outputResolved.resolved);
  const itineraryArtifact = recordArtifact({
    locator: outputResolved.resolved,
    producer: String(sentence?.su?.name ?? fallbackPrefix),
    bytes: itineraryBytes,
    kind: "series"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: `${fallbackPrefix} itinerary manifest` },
    ob: { filename: outputResolved.resolved },
    be: "artifact",
    accordingto: itineraryArtifact?.su?.name ? { name: itineraryArtifact.su.name } : undefined
  });
  return outputResolved.resolved;
}

export async function resolveItineraryCuts(fromCase, { rememberFn = remember } = {}) {
  const parseCutsFromFilename = async (filename) => {
    const { resolved, outside, agentCwd } = resolveAgentPath(filename, { rememberFn });
    if (outside) {
      throwErrorSentence({
        name: "itinerary defective",
        message: `itinerary defective: outside agent cwd (${agentCwd})`,
        from: { name: "itinerary" },
        raw: { filename }
      });
    }
    const text = await fs.readFile(resolved, "utf8");
    const parsed = parseItineraryPya(text);
    return parsed.cuts;
  };

  const directFilename = typeof fromCase?.filename === "string" ? fromCase.filename : "";
  if (directFilename.trim()) return parseCutsFromFilename(directFilename);

  const directText = typeof fromCase?.text === "string" ? fromCase.text : "";
  if (directText.trim()) {
    const parsed = parseItineraryPya(directText);
    return parsed.cuts;
  }

  const dependencyNamesFromVectorCase = (source) => {
    const values = Array.isArray(source?.ve?.values)
      ? source.ve.values.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (!values.length) return [];
    const dependencies = [];
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
      if (token) dependencies.push(token);
    }
    return dependencies;
  };

  const resolveItineraryName = (source) => {
    const fromName = String(source?.name ?? "").trim();
    if (fromName) return fromName;

    const dependencies = dependencyNamesFromVectorCase(source);
    if (!dependencies.length) return "";

    const typedItinerary = dependencies.find((token) => {
      const parts = token.split(/\s+/).filter(Boolean);
      return parts.length >= 2 && parts[0].toLowerCase() === "itinerary";
    });
    if (typedItinerary) {
      return typedItinerary.split(/\s+/).slice(1).join(" ").trim();
    }

    const exactItinerary = dependencies.find((token) => token.toLowerCase() === "itinerary");
    if (exactItinerary) return exactItinerary;

    return String(dependencies[0] ?? "").trim();
  };

  const name = resolveItineraryName(fromCase);
  if (!name) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: missing from name itinerary or from ve name itinerary",
      from: { name: "itinerary" },
      raw: { from: fromCase }
    });
  }
  const rootFact = rememberFn(name);
  if (!rootFact) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: missing ${name}`,
      from: { name: "itinerary" },
      raw: { from: fromCase }
    });
  }
  const dereferenceFact = (fact) => {
    const seen = new Set();
    let current = fact;
    let depth = 0;
    while (current && depth < 16) {
      const aliasName = typeof current?.ob?.name === "string" ? current.ob.name.trim() : "";
      if (!aliasName) break;
      if (seen.has(aliasName)) break;
      seen.add(aliasName);
      const nextFact = rememberFn(aliasName);
      if (!nextFact) break;
      current = nextFact;
      depth += 1;
    }
    return current;
  };
  const fact = dereferenceFact(rootFact);

  const filename = typeof fact?.ob?.filename === "string" ? fact.ob.filename : "";
  if (filename.trim()) {
    try {
      return await parseCutsFromFilename(filename);
    } catch {
      // fall through to inline or series payload when persisted locator is unavailable
    }
  }

  const seriesCuts = itineraryCutsFromSeriesFact(fact);
  if (seriesCuts.length) return seriesCuts;

  const inlineText = typeof fact?.ob?.text === "string" ? fact.ob.text : "";
  if (inlineText.trim()) {
    const parsed = parseItineraryPya(inlineText);
    return parsed.cuts;
  }

  throwErrorSentence({
    name: "itinerary defective",
    message: "itinerary defective: requires ob series, ob text, or ob filename",
    from: { name: "itinerary" },
    raw: { fact }
  });
}

