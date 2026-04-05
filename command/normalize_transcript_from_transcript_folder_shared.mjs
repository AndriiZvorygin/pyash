#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "./pya_lookup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROFILES = {
  grey: {
    key: "grey",
    envPrefix: "GREY",
    house: path.join(ROOT, "world/house/grey-county-reporter"),
    termsEnv: "GREY_NORMALIZE_TERMS_FILE",
    rosterEnv: "GREY_NORMALIZE_ROSTER_FILE",
    defaultModel: "qwen3.5:9b",
    canonicalCleanup(text) {
      let out = String(text || "");
      out = out.replace(/\bGrey\s+county\b/giu, "Grey County");
      out = out.replace(/\bcounty\s+council\b/giu, "County Council");
      out = out.replace(/\bRCA\b/gu, "our CAO");
      out = out.replace(/\bCAs\b/gu, "CAOs");
      out = out.replace(/\bcaos\b/giu, "CAOs");
      return out;
    },
    rosterCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/grey-county-reporter/artifacts/grey-county/roster.txt"),
        path.join(path.dirname(meetingDir), "roster.txt"),
        path.join(meetingDir, "roster.txt"),
        path.join(ROOT, "world/house/grey-county-reporter/artifacts/grey-county/2022-2026-council.txt"),
        path.join(path.dirname(meetingDir), "2022-2026-council.txt"),
        path.join(meetingDir, "2022-2026-council.txt"),
      ];
    },
    termsCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/grey-county-reporter/program/normalization-terms.txt"),
        path.join(path.dirname(meetingDir), "normalization-terms.txt"),
        path.join(meetingDir, "normalization-terms.txt"),
      ];
    },
  },
  owen: {
    key: "owen",
    envPrefix: "OWEN",
    house: path.join(ROOT, "world/house/owen-sound-reporter"),
    termsEnv: "OWEN_NORMALIZE_TERMS_FILE",
    rosterEnv: "OWEN_NORMALIZE_ROSTER_FILE",
    defaultModel: "qwen3.5:9b",
    canonicalCleanup(text) {
      let out = String(text || "");
      out = out.replace(/\bOceansound\b/giu, "Owen Sound");
      out = out.replace(/\bCity of Oceansound\b/giu, "City of Owen Sound");
      out = out.replace(/\bDeputy Mayor Greg\b/gu, "Deputy Mayor Greig");
      out = out.replace(/\bDeputy Mayor Gregg\b/gu, "Deputy Mayor Greig");
      out = out.replace(/\bCouncil(?:lor|or)\s+Kepi\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncil(?:lor|or)\s+Keppie\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncil(?:lor|or)\s+Kepky\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncillor Keppie\b/gu, "Councillor Koepke");
      out = out.replace(/\bCouncillor Kepky\b/gu, "Councillor Koepke");
      out = out.replace(/\bAndrei Zvorov\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrei Zvorygin\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrii Zvorov\b/gu, "Andrii Zvorygin");
      return out;
    },
    rosterCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/owen-sound-reporter/artifacts/owen-sound/2022-2026-council.txt"),
        path.join(path.dirname(meetingDir), "2022-2026-council.txt"),
        path.join(meetingDir, "2022-2026-council.txt"),
      ];
    },
    termsCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/owen-sound-reporter/program/normalization-terms.txt"),
        path.join(ROOT, "world/house/owen-sound-reporter/artifacts/owen-sound/normalization-terms.txt"),
        path.join(path.dirname(meetingDir), "normalization-terms.txt"),
        path.join(meetingDir, "normalization-terms.txt"),
      ];
    },
  },
  andrii: {
    key: "andrii",
    envPrefix: "ANDRII",
    house: path.join(ROOT, "world/house/andrii-youtube-reporter"),
    termsEnv: "ANDRII_NORMALIZE_TERMS_FILE",
    rosterEnv: "ANDRII_NORMALIZE_ROSTER_FILE",
    defaultModel: "qwen3.5:9b",
    canonicalCleanup(text) {
      let out = String(text || "");
      out = out.replace(/\bAndrei Zvorov\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrei Zvorygin\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrii Zvorov\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bQuo\b/giu, "Q'uo");
      out = out.replace(/\bQ U O\b/giu, "Q'uo");
      out = out.replace(/\bLatwee\b/giu, "Latwii");
      out = out.replace(/\bLatos\b/giu, "Laitos");
      return out;
    },
    rosterCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/andrii-youtube-reporter/program/normalization-roster.txt"),
        path.join(ROOT, "world/house/andrii-youtube-reporter/artifacts/andrii-youtube/2022-2026-council.txt"),
        path.join(path.dirname(meetingDir), "2022-2026-council.txt"),
        path.join(meetingDir, "2022-2026-council.txt"),
      ];
    },
    termsCandidates(transcriptDir) {
      const meetingDir = path.dirname(transcriptDir);
      return [
        path.join(ROOT, "world/house/andrii-youtube-reporter/program/normalization-terms.txt"),
        path.join(ROOT, "world/house/andrii-youtube-reporter/artifacts/andrii-youtube/normalization-terms.txt"),
        path.join(path.dirname(meetingDir), "normalization-terms.txt"),
        path.join(meetingDir, "normalization-terms.txt"),
      ];
    },
  },
};

function usage() {
  return "Usage: node command/normalize_transcript_from_transcript_folder_shared.mjs <grey|owen|andrii> <transcript_dir> [source_prefix] [output_prefix]";
}

function resolveOllamaHost(profile) {
  const fromEnv = String(process.env.OLLAMA_HOST || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/u, "");
  const secretCandidates = [
    path.join(profile.house, "configure/secret.pya"),
    path.join(ROOT, "configure/secret.pya"),
  ];
  const secretPath = secretCandidates.find((p) => fs.existsSync(p));
  if (secretPath) {
    const vals = readPyaTextValues(secretPath, ["ollama host", "ai host", "relay local host", "host"]);
    const fromPya = String(vals["ollama host"] || vals["ai host"] || vals["relay local host"] || vals.host || "").trim();
    if (fromPya) return fromPya.replace(/\/+$/u, "");
  }
  return "http://localhost:11434";
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`transcript directory not found: ${dirPath}`);
}

function resolveReporterPath(profile, inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(profile.house, inputPath);
}

function pickPlainTranscript(transcriptDir, prefix = "meeting-qwen-auto") {
  const preferred = path.join(transcriptDir, `${prefix}.plain.txt`);
  if (fs.existsSync(preferred)) return { plainPath: preferred, resolvedPrefix: prefix };
  const candidates = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.endsWith(".plain.txt"))
    .sort();
  if (!candidates.length) throw new Error(`no *.plain.txt transcript found in ${transcriptDir}`);
  const chosen = candidates[candidates.length - 1];
  const resolvedPrefix = chosen.replace(/\.plain\.txt$/u, "");
  return { plainPath: path.join(transcriptDir, chosen), resolvedPrefix };
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return "";
}

function parseNormalizationTerms(text) {
  const lines = String(text || "").split(/\r?\n/u);
  const terms = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let canonical = "";
    let aliasesRaw = "";
    if (line.includes("\t")) {
      const idx = line.indexOf("\t");
      canonical = line.slice(0, idx).trim();
      aliasesRaw = line.slice(idx + 1).trim();
    } else if (line.includes("=>")) {
      const idx = line.indexOf("=>");
      canonical = line.slice(0, idx).trim();
      aliasesRaw = line.slice(idx + 2).trim();
    } else continue;
    if (!canonical || !aliasesRaw) continue;
    const aliases = aliasesRaw.split("|").map((x) => x.trim()).filter((x) => x && x !== canonical);
    if (!aliases.length) continue;
    terms.push({ canonical, aliases });
  }
  return terms;
}

function loadNormalizationTerms(filePath) {
  if (!filePath) return [];
  return parseNormalizationTerms(fs.readFileSync(filePath, "utf8"));
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function applyNormalizationTerms(text, terms) {
  let out = String(text || "");
  for (const term of terms) {
    const canonical = String(term?.canonical || "").trim();
    const aliases = Array.isArray(term?.aliases) ? term.aliases : [];
    if (!canonical || !aliases.length) continue;
    const dedup = [...new Set(aliases.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const alias of dedup) {
      const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "giu");
      out = out.replace(re, canonical);
    }
  }
  return out;
}

function splitIntoChunks(text, maxChars) {
  const paras = String(text || "").split(/\n\s*\n+/u).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return [];
  const chunks = [];
  let buf = [];
  let chars = 0;
  for (const p of paras) {
    const add = p.length + (buf.length ? 2 : 0);
    if (buf.length && chars + add > maxChars) {
      chunks.push(buf.join("\n\n"));
      buf = [p];
      chars = p.length;
      continue;
    }
    buf.push(p);
    chars += add;
  }
  if (buf.length) chunks.push(buf.join("\n\n"));
  return chunks;
}

function termsForPrompt(terms) {
  if (!Array.isArray(terms) || !terms.length) return "";
  const lines = [];
  for (const term of terms) {
    const canonical = String(term?.canonical || "").trim();
    const aliases = Array.isArray(term?.aliases) ? term.aliases : [];
    if (!canonical || !aliases.length) continue;
    lines.push(`- ${canonical} <= ${aliases.join(" | ")}`);
  }
  return lines.join("\n");
}

async function askNormalize({ chunk, rosterText, termMapText, index, total, ollamaUrl, model }) {
  const prompt = [
    "Clean this transcript chunk with minimal edits.",
    "",
    "Allowed edits only:",
    "- Fix obvious ASR spelling mistakes.",
    "- Normalize person/place names to canonical roster/place spellings when clear from context.",
    "- Split/merge accidental word boundaries caused by ASR.",
    "",
    "Forbidden edits:",
    "- Do not add facts.",
    "- Do not remove factual content.",
    "- Do not summarize.",
    "",
    "Output requirements:",
    "- Output only corrected transcript text.",
    "- Preserve paragraph breaks.",
    "",
    `Chunk ${index} of ${total}`,
    "",
    "ROSTER AND PLACE CONTEXT:",
    rosterText || "(none provided)",
    "",
    "CANONICAL TERM MAP (alias -> canonical):",
    termMapText || "(none provided)",
    "",
    "SOURCE CHUNK:",
    chunk,
  ].join("\n");

  const body = {
    model,
    mode: "chat",
    stream: false,
    think: false,
    keep_alive: 300,
    options: { temperature: 0.05, num_predict: 4096 },
    messages: [
      { role: "system", content: "You are a careful transcript text normalizer. Preserve meaning exactly; only correct obvious transcription errors." },
      { role: "user", content: prompt },
    ],
  };

  const res = await fetch(ollamaUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || "").trim();
}

export async function runNormalizeShared(writer, argv = []) {
  const profile = PROFILES[String(writer || "").trim().toLowerCase()];
  if (!profile) throw new Error(`unknown normalize profile: ${writer}`);
  const transcriptDirArg = argv[0];
  const sourcePrefixArg = argv[1] || "meeting-qwen-auto";
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }
  const transcriptDir = resolveReporterPath(profile, transcriptDirArg);
  ensureDir(transcriptDir);
  const { plainPath, resolvedPrefix } = pickPlainTranscript(transcriptDir, sourcePrefixArg);
  const outputPrefix = argv[2] || `${resolvedPrefix}-normalized`;
  const outputPath = path.join(transcriptDir, `${outputPrefix}.plain.txt`);
  const metadataPath = path.join(transcriptDir, `${outputPrefix}.normalize.metadata.json`);
  const rosterPath = firstExisting([
    String(process.env[profile.rosterEnv] || "").trim(),
    ...profile.rosterCandidates(transcriptDir),
  ]);
  const termsPath = firstExisting([
    String(process.env[profile.termsEnv] || "").trim(),
    ...profile.termsCandidates(transcriptDir),
  ]);
  const rosterText = rosterPath ? fs.readFileSync(rosterPath, "utf8") : "";
  const normalizationTerms = loadNormalizationTerms(termsPath);
  const termMapText = termsForPrompt(normalizationTerms);
  const sourceText = fs.readFileSync(plainPath, "utf8");
  const model = String(process.env[`${profile.envPrefix}_NORMALIZE_MODEL`] || profile.defaultModel);
  const maxCharsRaw = Number(process.env[`${profile.envPrefix}_NORMALIZE_MAX_CHARS`] || 9000);
  const maxChunksRaw = Number(process.env[`${profile.envPrefix}_NORMALIZE_MAX_CHUNKS`] || 0);
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 1500 ? Math.floor(maxCharsRaw) : 9000;
  const maxChunks = Number.isFinite(maxChunksRaw) && maxChunksRaw > 0 ? Math.floor(maxChunksRaw) : 0;
  const ollamaBase = resolveOllamaHost(profile);
  const ollamaUrl = `${ollamaBase}/api/chat`;

  const chunks = splitIntoChunks(sourceText, maxChars);
  if (!chunks.length) throw new Error("source transcript is empty");

  process.stdout.write(`[normalize-transcript] source: ${plainPath}\n`);
  process.stdout.write(`[normalize-transcript] roster: ${rosterPath || "(none)"}\n`);
  process.stdout.write(`[normalize-transcript] terms: ${termsPath || "(none)"} (${normalizationTerms.length})\n`);
  process.stdout.write(`[normalize-transcript] output: ${outputPath}\n`);
  process.stdout.write(`[normalize-transcript] chunks: ${chunks.length}\n`);

  const runChunks = maxChunks > 0 ? chunks.slice(0, maxChunks) : chunks;
  const out = [];
  for (let i = 0; i < runChunks.length; i += 1) {
    process.stdout.write(`[normalize-transcript] atindex num ${i + 1} toindex num ${runChunks.length}\n`);
    const cleaned = await askNormalize({
      chunk: runChunks[i],
      rosterText,
      termMapText,
      index: i + 1,
      total: runChunks.length,
      ollamaUrl,
      model,
    });
    const canon = profile.canonicalCleanup(cleaned || runChunks[i]);
    out.push(applyNormalizationTerms(canon, normalizationTerms));
  }

  const normalized = out.join("\n\n").replace(/\n{3,}/gu, "\n\n").trim();
  fs.writeFileSync(outputPath, `${normalized}\n`, "utf8");
  fs.writeFileSync(metadataPath, JSON.stringify({
    source: plainPath,
    output: outputPath,
    model,
    writer: profile.key,
    roster_file: rosterPath || "",
    terms_file: termsPath || "",
    terms_count: normalizationTerms.length,
    chunks_total: chunks.length,
    chunks_processed: runChunks.length,
    max_chars_per_chunk: maxChars,
  }, null, 2), "utf8");
  process.stdout.write(`[normalize-transcript] wrote: ${outputPath}\n`);
  process.stdout.write(`[normalize-transcript] wrote: ${metadataPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const writer = process.argv[2];
  runNormalizeShared(writer, process.argv.slice(3)).catch((err) => {
    process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
    process.exit(1);
  });
}
