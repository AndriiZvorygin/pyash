#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPyaTextValues } from "./pya_lookup.mjs";

function usage() {
  return [
    "Usage: node command/corroborate_agenda_references_from_transcript_folder.mjs <transcript_dir> [prefix]",
    "Example: node command/corroborate_agenda_references_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto-normalized",
  ].join("\n");
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function inferPrefix(transcriptDir) {
  const names = fs.readdirSync(transcriptDir).filter((n) => n.endsWith(".agenda-summary.pya")).sort();
  if (!names.length) throw new Error("no .agenda-summary.pya found");
  return names[names.length - 1].replace(/\.agenda-summary\.pya$/u, "");
}

function parseWiseHeadingMap(wiseText) {
  const out = new Map();
  const re = /su name wise chip\s+\d+\s+since num \d+ until num \d+ ob text "([\s\S]*?)" ya/gu;
  let m;
  while ((m = re.exec(String(wiseText || ""))) !== null) {
    let chip = "";
    try {
      chip = JSON.parse(`"${m[1]}"`);
    } catch {
      continue;
    }
    const firstLine = String(chip.split(/\r?\n/u)[0] || "");
    const h = firstLine.match(/\[Agenda Start\]\s*(.*?)\s*\|\s*method/iu);
    if (!h) continue;
    const heading = String(h[1] || "").trim().toLowerCase();
    if (!heading) continue;
    out.set(heading, chip);
  }
  return out;
}

function extractRefs(text) {
  const refs = [];
  const src = String(text || "");
  const numWord = new Map([
    ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"],
    ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"], ["ten", "10"],
    ["eleven", "11"], ["twelve", "12"],
  ]);
  const explicit = /\b(option|scenario|alternative|proposal)\s+([0-9]{1,2}[a-z])\b/giu;
  let m;
  while ((m = explicit.exec(src)) !== null) {
    refs.push({
      type: String(m[1] || "").toLowerCase(),
      token: String(m[2] || "").toLowerCase(),
      phrase: String(m[0] || ""),
    });
  }
  const spoken = /\b(option|scenario|alternative|proposal)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z])\b/giu;
  let w;
  while ((w = spoken.exec(src)) !== null) {
    const n = numWord.get(String(w[2] || "").toLowerCase()) || "";
    const tok = `${n}${String(w[3] || "").toLowerCase()}`;
    if (!tok) continue;
    refs.push({
      type: String(w[1] || "").toLowerCase(),
      token: tok,
      phrase: String(w[0] || ""),
    });
  }
  const sentences = src.split(/(?<=[.!?])\s+/u).map((s) => String(s || "").trim()).filter(Boolean);
  for (const s of sentences) {
    if (!/\b(option|scenario|alternative|proposal|plan)\b/iu.test(s)) continue;
    const standalone = /\b([0-9]{1,2}[a-z])\b/giu;
    let sm;
    while ((sm = standalone.exec(s)) !== null) {
      const token = String(sm[1] || "").toLowerCase();
      if (!refs.some((r) => r.token === token && r.phrase === s)) {
        refs.push({
          type: "contextual",
          token,
          phrase: s,
        });
      }
    }
  }
  return refs;
}

function looksLikeOptionSection(summaryText, sourceText) {
  const s = String(summaryText || "").toLowerCase();
  const src = String(sourceText || "").toLowerCase();
  if (!/\b(option|scenario|alternative|proposal|plan)\b/iu.test(`${s} ${src}`)) return false;
  if (/\b[0-9]{1,2}[a-z]\b/iu.test(`${s} ${src}`)) return true;
  return false;
}

function needsCorroborationPass(summaryText, sourceText) {
  const s = String(summaryText || "").toLowerCase();
  const src = String(sourceText || "").toLowerCase();
  if (!s || !src) return false;
  if (looksLikeOptionSection(s, src)) return true;
  if (/\b(path|pathway|sidewalk|street|lane|narrow|roadway|traffic taper|collector road)\b/iu.test(`${s} ${src}`)) return true;
  return false;
}

function excerptAroundToken(sourceText, token) {
  const src = String(sourceText || "");
  const t = String(token || "").toLowerCase();
  const low = src.toLowerCase();
  const i = low.indexOf(t);
  if (i < 0) return src.slice(0, 2800);
  const start = Math.max(0, i - 1200);
  const end = Math.min(src.length, i + 1600);
  return src.slice(start, end);
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function hasEmbeddedArtifactJson(text = "") {
  const s = String(text || "");
  return /\[\s*\{\s*\\?"index\\?"\s*:\s*\d+\s*,\s*\\?"unit id\\?"/u.test(s)
    || /\\?"schema version\\?"\s*:\s*\\?"agenda_summary_v1\\?"/u.test(s)
    || /\\?"grounding status\\?"\s*:\s*\\?"grounded\\?"/u.test(s);
}

function assertCleanRepairText(text = "", where = "stage4 repair") {
  const s = normalizeText(text);
  if (!s) throw new Error(`${where} defective: empty repaired summary`);
  if (hasEmbeddedArtifactJson(s)) throw new Error(`${where} defective: embedded artifact json`);
  if (/^\s*[\[{]/u.test(s)) throw new Error(`${where} defective: summary is serialized data`);
}

async function callOllamaJson({ prompt, model }) {
  const host = String(process.env.OLLAMA_HOST || "http://mriczo:11434").replace(/\/+$/u, "");
  const url = `${host}/api/chat`;
  const attempts = Math.max(1, Number.parseInt(String(process.env.PYA_STAGE4_OLLAMA_ATTEMPTS || "3"), 10) || 3);
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const retryLine = attempt > 1
      ? "\nRetry instruction: return one valid JSON object only, exactly {\"summary\":\"...\"}. Do not include markdown or serialized artifacts."
      : "";
    const body = {
      model: model || process.env.OLLAMA_MODEL || "qwen3.5:9b",
      stream: false,
      format: "json",
      options: { temperature: attempt > 1 ? 0 : 0.1, top_p: 0.9 },
      messages: [
        { role: "system", content: "You are a strict civic transcript corroboration editor. Output one JSON object only." },
        { role: "user", content: `${String(prompt || "")}${retryLine}` },
      ],
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(process.env.PYA_STAGE4_TIMEOUT_MS || 120000));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama http ${res.status}`);
      const j = await res.json();
      const content = String(j?.message?.content || "").trim();
      try {
        return JSON.parse(content);
      } catch {
        const brace = content.match(/\{[\s\S]*\}/u);
        if (brace) return JSON.parse(brace[0]);
        throw new Error("unparseable-json");
      }
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("ollama json failed");
}

function hasPathVsStreetConflict(summaryText, sourceText) {
  const s = String(summaryText || "").toLowerCase();
  const src = String(sourceText || "").toLowerCase();
  const summaryPath = /\b(path|pathway|multi-use path)\b/iu.test(s);
  const sourceNarrow = /\b(narrow|narrower|lane reduction|standard sidewalk|collector road|street width)\b/iu.test(src);
  return summaryPath && sourceNarrow;
}

function escapePyaText(str) {
  return JSON.stringify(String(str || "")).slice(1, -1);
}

function writeSectionsBackToPya(agendaSummaryPya, sections) {
  const old = safeRead(agendaSummaryPya);
  const serialized = escapePyaText(JSON.stringify(sections));
  const roundTrip = JSON.parse(JSON.stringify(sections));
  if (!Array.isArray(roundTrip) || roundTrip.length !== sections.length) {
    throw new Error("stage4 defective: sections failed pre-write validation");
  }
  for (const sec of roundTrip) {
    assertCleanRepairText(sec?.summary || "", `stage4 writeback ${sec?.heading || ""}`);
  }
  const updated = old.replace(
    /^exists su name sections ob text ".*" ya$/mu,
    () => `exists su name sections ob text "${serialized}" ya`,
  );
  if (updated === old) throw new Error("stage4 defective: unable to update sections field in agenda-summary.pya");
  fs.writeFileSync(agendaSummaryPya, updated, "utf8");
}

async function main() {
  const transcriptDirArg = process.argv[2];
  if (!transcriptDirArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }
  const transcriptDir = path.resolve(transcriptDirArg);
  const prefix = String(process.argv[3] || "").trim() || inferPrefix(transcriptDir);
  const agendaSummaryPya = path.join(transcriptDir, `${prefix}.agenda-summary.pya`);
  const agendaWiseSeries = path.join(transcriptDir, `${prefix}.agenda-wise.series.pya`);
  const outPya = path.join(transcriptDir, `${prefix}.agenda-reference-corroboration.pya`);
  const outJson = path.join(transcriptDir, `${prefix}.agenda-reference-corroboration.json`);

  const summaryVals = readPyaTextValues(agendaSummaryPya, ["sections"]);
  const sections = JSON.parse(String(summaryVals.sections || "[]"));
  if (!Array.isArray(sections) || !sections.length) throw new Error("stage4 defective: missing agenda summary sections");

  const wiseText = safeRead(agendaWiseSeries);
  if (!wiseText.trim()) throw new Error("stage4 defective: missing agenda-wise series source");
  const wiseMap = parseWiseHeadingMap(wiseText);

  const findings = [];
  let unresolved = 0;
  let repairsApplied = 0;
  let repairErrors = 0;
  const tasks = [];
  for (let idx = 0; idx < sections.length; idx += 1) {
    const sec = sections[idx];
    const heading = String(sec?.heading || "").trim();
    if (!heading) continue;
    const chapterText = Array.isArray(sec?.chapters)
      ? sec.chapters.map((c) => String(c?.text || "")).join("\n")
      : "";
    const full = `${String(sec?.summary || "")}\n${chapterText}`;
    const refs = extractRefs(full);
    const source = wiseMap.get(heading.toLowerCase()) || "";
    const sourceRefs = extractRefs(source);
    const allRefs = [...refs];
    for (const sr of sourceRefs) {
      if (!allRefs.some((r) => r.token === sr.token)) allRefs.push(sr);
    }
    if (!allRefs.length && !needsCorroborationPass(full, source)) continue;
    let needsRepair = false;
    for (const ref of refs) {
      const token = String(ref.token || "").toLowerCase();
      const corroborated =
        new RegExp(`\\b${token}\\b`, "iu").test(source)
        || new RegExp(`\\b${ref.type}\\s+${token}\\b`, "iu").test(source);
      findings.push({
        heading,
        unit_id: String(sec?.["unit id"] || sec?.unitId || ""),
        token,
        type: ref.type,
        phrase: ref.phrase,
        corroborated,
      });
      if (!corroborated) {
        unresolved += 1;
        needsRepair = true;
      }
    }
    if (!needsRepair && (allRefs.length || hasPathVsStreetConflict(full, source))) needsRepair = true;
    if (!needsRepair) continue;
    tasks.push({ idx, heading, sec, source, refs: allRefs });
  }

  for (const task of tasks) {
    const tokens = Array.from(new Set(task.refs.map((r) => String(r.token || "").toUpperCase()))).filter(Boolean);
    const primaryToken = String(tokens[0] || "").toLowerCase();
    const sourceExcerpt = excerptAroundToken(task.source, primaryToken);
    const prompt = [
      "Repair the section summary so any option/scenario references are accurate to source.",
      "Rules:",
      "- Keep to 2-5 sentences, <=160 words.",
      "- Use only SOURCE facts. No invention.",
      "- If source says Option/Scenario token means road narrowing (or similar), keep that meaning; do not convert to pathway unless source says so.",
      "- Keep municipal meeting reporting tone.",
      "Return JSON: {\"summary\":\"...\"}",
      "",
      `HEADING: ${task.heading}`,
      `TOKENS: ${tokens.join(", ") || "(none)"}`,
      `CURRENT_SUMMARY: ${String(task.sec?.summary || "")}`,
      "SOURCE:",
      sourceExcerpt,
    ].join("\n");
    try {
      const out = await callOllamaJson({ prompt });
      const repaired = normalizeText(out?.summary || "");
      assertCleanRepairText(repaired, `stage4 repair ${task.heading}`);
      if (repaired && repaired !== String(task.sec?.summary || "").trim()) {
        sections[task.idx] = { ...task.sec, summary: repaired };
        repairsApplied += 1;
      }
    } catch {
      repairErrors += 1;
    }
  }

  if (repairsApplied > 0) {
    writeSectionsBackToPya(agendaSummaryPya, sections);
  }

  const report = {
    schema_version: "agenda_reference_corroboration_v1",
    transcript_dir: transcriptDir,
    prefix,
    sections_total: sections.length,
    findings_total: findings.length,
    unresolved_total: unresolved,
    repairs_applied: repairsApplied,
    repair_errors: repairErrors,
    findings,
  };
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [];
  lines.push(`exists su name schema version ob text "${JSON.stringify(report.schema_version).slice(1, -1)}" ya`);
  lines.push(`exists su name prefix ob text "${JSON.stringify(prefix).slice(1, -1)}" ya`);
  lines.push(`exists su name sections total ob number ${Number(report.sections_total)} ya`);
  lines.push(`exists su name findings total ob number ${Number(report.findings_total)} ya`);
  lines.push(`exists su name unresolved total ob number ${Number(report.unresolved_total)} ya`);
  lines.push(`exists su name repairs applied ob number ${Number(report.repairs_applied)} ya`);
  lines.push(`exists su name repair errors ob number ${Number(report.repair_errors)} ya`);
  lines.push(`exists su name findings ob text "${JSON.stringify(JSON.stringify(findings)).slice(1, -1)}" ya`);
  lines.push("prah");
  fs.writeFileSync(outPya, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`[agenda-stage4] wrote: ${outPya}\n`);
  process.stdout.write(`[agenda-stage4] wrote: ${outJson}\n`);
  process.stdout.write(`[agenda-stage4] findings=${findings.length} unresolved=${unresolved} repairs=${repairsApplied} repair_errors=${repairErrors}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
