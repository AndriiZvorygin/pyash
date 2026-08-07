#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "./pya_lookup.mjs";
import {
  CANADIAN_ENGLISH_SPELLING_PAIRS,
  normalizeCanadianEnglish,
} from "../program/library/reporter_shared/canadian-english.mjs";

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
    literalReplacements: [],
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
      out = out.replace(/\bOnsound\b/giu, "Owen Sound");
      out = out.replace(/\bOnondaga\b/giu, "Owen Sound");
      out = out.replace(/\bCity of Oceansound\b/giu, "City of Owen Sound");
      out = out.replace(/\bDeputy Mayor Greg\b/gu, "Deputy Mayor Greig");
      out = out.replace(/\bDeputy Mayor Gregg\b/gu, "Deputy Mayor Greig");
      out = out.replace(/\bMayor Body\b/giu, "Mayor Boddy");
      out = out.replace(/\bMayor Batty\b/giu, "Mayor Boddy");
      out = out.replace(/\bMayor Baty\b/giu, "Mayor Boddy");
      out = out.replace(/\bCouncil(?:lor|or)\s+Kepi\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncil(?:lor|or)\s+Keppie\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncil(?:lor|or)\s+Kepky\b/giu, "Councillor Koepke");
      out = out.replace(/\bCouncillor Keppie\b/gu, "Councillor Koepke");
      out = out.replace(/\bCouncillor Kepky\b/gu, "Councillor Koepke");
      out = out.replace(/\bAndrei Zvorov\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrei Zvorygin\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndrii Zvorov\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bAndre Zvorogin\b/gu, "Andrii Zvorygin");
      out = out.replace(/\bGrey Sable\b/giu, "Grey Sauble");
      out = out.replace(/\b(?:Moquehadong|Malwiquadong)\b/giu, "M'Wikwedong");
      return out;
    },
    literalReplacements: [
      ["Oceansound", "Owen Sound"],
      ["Onsound", "Owen Sound"],
      ["Onondaga", "Owen Sound"],
      ["City of Oceansound", "City of Owen Sound"],
      ["Deputy Mayor Greg", "Deputy Mayor Greig"],
      ["Deputy Mayor Gregg", "Deputy Mayor Greig"],
      ["Mayor Body", "Mayor Boddy"],
      ["Mayor Batty", "Mayor Boddy"],
      ["Mayor Baty", "Mayor Boddy"],
      ["Councillor Keppie", "Councillor Koepke"],
      ["Councillor Kepky", "Councillor Koepke"],
      ["Andrei Zvorov", "Andrii Zvorygin"],
      ["Andrei Zvorygin", "Andrii Zvorygin"],
      ["Andrii Zvorov", "Andrii Zvorygin"],
      ["Andre Zvorogin", "Andrii Zvorygin"],
      ["Grey Sable", "Grey Sauble"],
      ["Moquehadong", "M'Wikwedong"],
      ["Malwiquadong", "M'Wikwedong"],
    ],
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
    literalReplacements: [],
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

function readMeetingNormalizationContext(transcriptDir) {
  const meetingPath = path.join(path.dirname(transcriptDir), "meeting.json");
  try {
    const payload = JSON.parse(fs.readFileSync(meetingPath, "utf8"))?.payload || {};
    const rows = [
      ["Meeting/video name", payload?.meeting_name],
      ["Jurisdiction", payload?.jurisdiction],
      ["Body/topic", payload?.body],
      ["Uploader", payload?.uploader],
      ["Source", payload?.source],
    ]
      .filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `${label}: ${String(value).trim()}`);
    return rows.join("\n");
  } catch {
    return "";
  }
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

function titleCaseWords(text) {
  return String(text || "")
    .split(/\s+/u)
    .map((w) => {
      if (!w) return w;
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function addReplacement(map, from, to) {
  const src = String(from || "").trim();
  const dst = String(to || "").trim();
  if (!src || !dst || src === dst) return;
  if (!(src in map)) map[src] = dst;
}

function buildStringReplacementMap(profile, normalizationTerms) {
  const map = {};
  const literals = Array.isArray(profile?.literalReplacements) ? profile.literalReplacements : [];
  for (const pair of literals) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const from = String(pair[0] || "").trim();
    const to = String(pair[1] || "").trim();
    if (!from || !to || from === to) continue;
    addReplacement(map, from, to);
    addReplacement(map, from.toLowerCase(), to.toLowerCase());
    addReplacement(map, titleCaseWords(from), titleCaseWords(to));
  }
  for (const term of Array.isArray(normalizationTerms) ? normalizationTerms : []) {
    const canonical = String(term?.canonical || "").trim();
    const aliases = Array.isArray(term?.aliases) ? term.aliases : [];
    if (!canonical || !aliases.length) continue;
    for (const aliasRaw of aliases) {
      const alias = String(aliasRaw || "").trim();
      if (!alias || alias === canonical) continue;
      addReplacement(map, alias, canonical);
      addReplacement(map, alias.toLowerCase(), canonical.toLowerCase());
      addReplacement(map, titleCaseWords(alias), titleCaseWords(canonical));
    }
  }
  for (const [american, canadian] of CANADIAN_ENGLISH_SPELLING_PAIRS) {
    addReplacement(map, american, canadian);
    addReplacement(map, american.toUpperCase(), canadian.toUpperCase());
    addReplacement(map, titleCaseWords(american), titleCaseWords(canadian));
  }
  return map;
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

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

async function askNormalize({ chunk, rosterText, termMapText, index, total, ollamaUrl, model }) {
  const prompt = [
    "Clean this transcript chunk with minimal edits.",
    "",
    "Allowed edits only:",
    "- Fix obvious ASR spelling mistakes.",
    "- Normalize person/place names to canonical roster/place spellings when clear from context.",
    "- Use Canadian English spelling without changing meaning.",
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

  const timeoutMsRaw = Number(process.env.PYA_NORMALIZE_FETCH_TIMEOUT_MS || 120000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 5000 ? Math.floor(timeoutMsRaw) : 120000;
  const attemptsRaw = Number(process.env.PYA_NORMALIZE_FETCH_ATTEMPTS || 3);
  const attempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? Math.floor(attemptsRaw) : 3;

  let lastErr = "";
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsUsed = attempt;
    let timer = null;
    try {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`ollama status ${res.status}`);
      const json = await res.json();
      const out = String(json?.message?.content || "").trim();
      if (!out) throw new Error("empty normalize response");
      return out;
    } catch (err) {
      lastErr = String(err?.message || err || "unknown normalize error");
      process.stderr.write(`[normalize-transcript] warn chunk ${index}/${total} attempt ${attempt}/${attempts} failed: ${lastErr}\n`);
      if (String(err?.name || "").toLowerCase() === "aborterror" || /aborted|abort/iu.test(lastErr)) break;
      if (attempt >= attempts) break;
      const delay = 1200 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(`normalize fetch failed after ${attemptsUsed} attempt${attemptsUsed === 1 ? "" : "s"}: ${lastErr}`);
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
  const rosterText = [
    rosterPath ? fs.readFileSync(rosterPath, "utf8") : "",
    readMeetingNormalizationContext(transcriptDir),
  ].filter(Boolean).join("\n\n");
  const normalizationTerms = loadNormalizationTerms(termsPath);
  const termMapText = termsForPrompt(normalizationTerms);
  const stringReplacementMap = buildStringReplacementMap(profile, normalizationTerms);
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
  const requireLlmNormalize = envFlag("PYA_NORMALIZE_REQUIRE_LLM", false);
  const maxFailedChunksRaw = Number(process.env.PYA_NORMALIZE_MAX_FAILED_CHUNKS || 2);
  const maxFailedChunks = Number.isFinite(maxFailedChunksRaw) && maxFailedChunksRaw >= 0 ? Math.floor(maxFailedChunksRaw) : 2;

  process.stdout.write(`[normalize-transcript] source: ${plainPath}\n`);
  process.stdout.write(`[normalize-transcript] roster: ${rosterPath || "(none)"}\n`);
  process.stdout.write(`[normalize-transcript] terms: ${termsPath || "(none)"} (${normalizationTerms.length})\n`);
  process.stdout.write(`[normalize-transcript] output: ${outputPath}\n`);
  process.stdout.write(`[normalize-transcript] chunks: ${chunks.length}\n`);

  const runChunks = maxChunks > 0 ? chunks.slice(0, maxChunks) : chunks;
  const out = [];
  const fallbackChunks = [];
  for (let i = 0; i < runChunks.length; i += 1) {
    process.stdout.write(`[normalize-transcript] atindex num ${i + 1} toindex num ${runChunks.length}\n`);
    let cleaned = "";
    if (!requireLlmNormalize && maxFailedChunks >= 0 && fallbackChunks.length >= maxFailedChunks) {
      const message = `normalize circuit open after ${fallbackChunks.length} failed chunk(s)`;
      fallbackChunks.push({ index: i + 1, error: message, skipped_llm: true });
      process.stderr.write(`[normalize-transcript] warn chunk ${i + 1}/${runChunks.length} using source fallback: ${message}\n`);
      cleaned = runChunks[i];
    } else {
      try {
        cleaned = await askNormalize({
          chunk: runChunks[i],
          rosterText,
          termMapText,
          index: i + 1,
          total: runChunks.length,
          ollamaUrl,
          model,
        });
      } catch (err) {
        if (requireLlmNormalize) throw err;
        const message = String(err?.message || err || "unknown normalize error");
        fallbackChunks.push({ index: i + 1, error: message });
        process.stderr.write(`[normalize-transcript] warn chunk ${i + 1}/${runChunks.length} using source fallback after normalize failure: ${message}\n`);
        cleaned = runChunks[i];
      }
    }
    const canon = profile.canonicalCleanup(cleaned || runChunks[i]);
    const termsNormalized = applyNormalizationTerms(canon, normalizationTerms);
    out.push(normalizeCanadianEnglish(termsNormalized));
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
    string_replacement_map: stringReplacementMap,
    chunks_total: chunks.length,
    chunks_processed: runChunks.length,
    max_chars_per_chunk: maxChars,
    llm_required: requireLlmNormalize,
    max_failed_chunks_before_circuit: maxFailedChunks,
    fallback_chunk_count: fallbackChunks.length,
    fallback_chunks: fallbackChunks,
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
