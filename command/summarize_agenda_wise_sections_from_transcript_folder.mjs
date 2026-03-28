#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, '')
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, '')}/api/chat`
  : 'http://localhost:11434/api/chat';
const MODEL = process.env.OWEN_SUMMARY_MODEL || 'qwen3.5:9b';
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 0.8;
const MIN_SUMMARY_WORDS = (() => {
  const raw = Number(process.env.OWEN_SUMMARY_MIN_WORDS || 120);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
})();
const BASE_NEWS_HOOK = 'the newsworthy, juicy, and unusual bits';
const MAX_SECTIONS = (() => {
  const raw = Number(process.env.OWEN_SUMMARY_MAX_SECTIONS || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
})();

function usage() {
  return [
    'Usage: node command/summarize_agenda_wise_sections_from_transcript_folder.mjs <transcript_dir> [prefix] [focus]',
    'Example: node command/summarize_agenda_wise_sections_from_transcript_folder.mjs artifacts/.../transcript auto "newsworthy civic impacts"'
  ].join('\n');
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`transcript directory not found: ${dirPath}`);
}

function resolvePathFromRoot(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(ROOT, inputPath);
}

function unescapeQuoted(value) {
  try {
    return JSON.parse(`"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return String(value || '');
  }
}

function readNormalizeCheckpoint(transcriptDir, prefix) {
  const metaPath = path.join(transcriptDir, `${prefix}.normalize.metadata.json`);
  if (!fs.existsSync(metaPath)) return { exists: false, complete: false };
  try {
    const obj = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const total = Number(obj?.chunks_total);
    const done = Number(obj?.chunks_processed);
    const complete = Number.isFinite(total) && total > 0 && done === total;
    return { exists: true, complete };
  } catch {
    return { exists: true, complete: false };
  }
}

function pickAgendaWiseSeries(transcriptDir, prefix = 'auto') {
  const wantsAuto = !prefix || /^auto$/iu.test(String(prefix));
  if (!wantsAuto) {
    const preferred = path.join(transcriptDir, `${prefix}.agenda-wise.series.pya`);
    if (fs.existsSync(preferred)) return { seriesPath: preferred, resolvedPrefix: prefix };
  }

  const candidates = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.endsWith('.agenda-wise.series.pya'));
  if (!candidates.length) throw new Error(`no *.agenda-wise.series.pya found in ${transcriptDir}`);

  const ranked = candidates.map((name) => {
    const full = path.join(transcriptDir, name);
    const st = fs.statSync(full);
    const pfx = name.replace(/\.agenda-wise\.series\.pya$/u, '');
    const cp = readNormalizeCheckpoint(transcriptDir, pfx);
    let score = 0;
    if (cp.complete) score += 400;
    if (cp.exists && !cp.complete) score -= 300;
    if (/normalized/iu.test(pfx)) score += 150;
    if (/test|tmp|partial/iu.test(pfx)) score -= 250;
    if (pfx === 'meeting-qwen-auto') score += 10;
    return { name, full, pfx, score, mtimeMs: Number(st.mtimeMs || 0), size: Number(st.size || 0) };
  }).sort((a, b) =>
    b.score - a.score ||
    b.mtimeMs - a.mtimeMs ||
    b.size - a.size ||
    a.name.localeCompare(b.name)
  );

  const chosen = ranked[0];
  return { seriesPath: chosen.full, resolvedPrefix: chosen.pfx };
}

function pickCouncilRosterFile(transcriptDir) {
  const meetingDir = path.dirname(transcriptDir);
  const candidates = [
    path.join(path.dirname(meetingDir), '2022-2026-council.txt'),
    path.join(meetingDir, '2022-2026-council.txt'),
    path.join(path.dirname(meetingDir), 'roster.txt'),
    path.join(meetingDir, 'roster.txt')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return '';
}

function parseSeriesTexts(pyaText) {
  const source = String(pyaText || '');
  const out = [];

  const quotedRe = /ob text quoted\.text\.(.*?)\.text\.quoted(?: from num \d+)? be text ya/gs;
  for (const m of source.matchAll(quotedRe)) out.push(String(m[1] || ''));

  const plainRe = /ob text "((?:[^"\\]|\\.)*)"(?: from num \d+)? ya/g;
  for (const m of source.matchAll(plainRe)) out.push(unescapeQuoted(String(m[1] || '')));

  return out;
}

function parseHeadingAndBody(chipText, idx) {
  const raw = String(chipText || '')
    .replace(/\\r\\n/gu, '\n')
    .replace(/\\n/gu, '\n');
  const lines = raw.split(/\r?\n/u);
  const first = (lines[0] || '').trim();
  let heading = `Section ${idx + 1}`;
  if (first.startsWith('[Agenda Start]')) {
    heading = first.replace(/^\[Agenda Start\]\s*/u, '').replace(/\s*\|\s*method\s+[^|]+$/iu, '').trim() || heading;
  }

  let body = raw;
  if (first.startsWith('[Agenda Start]')) {
    const bodyLines = lines.slice(1);
    body = bodyLines.join('\n').trim();
    if (!body) body = raw;
  }

  return { heading, body };
}

function abridgeUtf8(text, maxBytes) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  if (buf.length <= maxBytes) return String(text ?? '');
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  if (end <= 0) end = maxBytes;
  return buf.slice(0, end).toString('utf8');
}

async function ask(messages, { numPredict = 280 } = {}) {
  const body = {
    model: MODEL,
    mode: 'chat',
    keep_alive: 300,
    think: false,
    stream: false,
    options: { num_predict: numPredict },
    messages
  };
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || '').trim();
}

function buildShortSummaryPrompt({ heading, source, focus, feedback, rosterText }) {
  const focusRaw = String(focus || '').trim();
  const focusLine = focusRaw
    ? `${BASE_NEWS_HOOK}; additionally prioritize ${focusRaw}`
    : BASE_NEWS_HOOK;
  const roster = String(rosterText || '').trim();
  return [
    `Summarize this municipal meeting section in exactly one sentence for agenda heading: ${heading}`,
    `Focus: prioritize ${focusLine}.`,
    roster ? '' : '',
    roster ? 'COUNCIL ROSTER REFERENCE:' : '',
    roster ? roster : '',
    '',
    'Rules:',
    '- One sentence only.',
    '- Keep only facts supported by SOURCE.',
    '- Use roster only to disambiguate speaker identity/role/gender; do not invent facts.',
    '- If transcript naming appears misspelled by ASR, normalize to the closest roster name silently.',
    '- If speaker identity is uncertain, use role phrasing (e.g., "a councillor").',
    '- No speculation.',
    '',
    'RETRY_FEEDBACK:',
    feedback || '',
    '',
    'SOURCE:',
    source
  ].join('\n');
}

function buildSummaryPrompt({ heading, source, focus, feedback, rosterText }) {
  const focusRaw = String(focus || '').trim();
  const focusLine = focusRaw
    ? `${BASE_NEWS_HOOK}; additionally prioritize ${focusRaw}`
    : BASE_NEWS_HOOK;
  const roster = String(rosterText || '').trim();
  return [
    `Summarize this municipal meeting section for agenda heading: ${heading}`,
    `Focus: prioritize ${focusLine}.`,
    roster ? '' : '',
    roster ? 'COUNCIL ROSTER REFERENCE:' : '',
    roster ? roster : '',
    '',
    'Rules:',
    '- Keep only facts supported by SOURCE.',
    '- Use roster only to disambiguate speaker identity/role/gender; do not invent facts.',
    '- Never assign a title (Mayor/Deputy Mayor/Councillor) to a person unless that title is explicitly supported by roster and source context.',
    '- If transcript naming appears misspelled by ASR, normalize to the closest roster name silently.',
    '- Prefer exact roster spellings in output names (example: "Koepke" not "Keppie"; "Greig" not "Greg" when identifying Deputy Mayor).',
    '- Never treat spelling/name mismatch itself as a news finding.',
    '- If speaker identity is uncertain, use role phrasing (e.g., "a councillor") instead of speculation.',
    '- Attribute statements to named speakers only when SOURCE makes that attribution explicit.',
    '- Do not infer attendance counts unless explicitly stated in SOURCE.',
    '- Surface unusual, high-impact, conflict-heavy, costly, surprising, or politically sensitive details when present.',
    '- Mention concrete decisions, motions, votes, actions, and notable debate if present.',
    '- Prefer specific numbers/thresholds/heights/dates/dollar amounts when SOURCE provides them.',
    '- Avoid vague wording like "significant", "many", or "several" when exact details are available.',
    '- No speculation.',
    '- No bullet lists.',
    '- Keep under 220 words.',
    '',
    'RETRY_FEEDBACK:',
    feedback || '',
    '',
    'SOURCE:',
    source
  ].join('\n');
}

function buildScorePrompt({ source, summary, rosterText }) {
  const roster = String(rosterText || '').trim();
  return [
    'Score SUMMARY for semantic faithfulness to SOURCE.',
    roster ? '' : '',
    roster ? 'COUNCIL ROSTER REFERENCE:' : '',
    roster ? roster : '',
    '',
    'Scoring:',
    '- 1.0 = fully faithful',
    '- 0.8 = mostly faithful with minor compression drift',
    '- 0.5 = mixed',
    '- 0.0 = unusable / unsupported',
    '',
    'Rules:',
    '- Penalize unsupported claims or invented outcomes.',
    '- Penalize non-canonical speaker naming when a clear canonical roster spelling is available.',
    '- Penalize speculative claims about identity mismatch, attendance counts, or roster discrepancies not explicit in SOURCE.',
    '- Do not penalize concise paraphrase if meaning is preserved.',
    '- Penalize omission when SOURCE contains clearly unusual/high-impact/newsworthy details and SUMMARY ignores them.',
    '- Penalize vague wording when SOURCE contains specific figures or thresholds that could be stated directly.',
    '',
    'Output:',
    '- First line: one short feedback sentence.',
    '- Final line: exactly PASS, FAIL, or a numeric score from 0 to 1.',
    '',
    'SOURCE:',
    source,
    '',
    'SUMMARY:',
    summary
  ].join('\n');
}

function buildAttributionScorePrompt({ source, summary, rosterText }) {
  const roster = String(rosterText || '').trim();
  return [
    'Score SUMMARY for speaker-attribution correctness against SOURCE.',
    roster ? '' : '',
    roster ? 'COUNCIL ROSTER REFERENCE:' : '',
    roster ? roster : '',
    '',
    'Scoring:',
    '- 1.0 = all speaker attributions are supported by SOURCE',
    '- 0.5 = uncertain / mixed',
    '- 0.0 = misattributed speaker(s)',
    '',
    'Rules:',
    '- If SUMMARY attributes a statement/opinion/motion to the wrong person, score must be 0.0.',
    '- If speaker identity is unclear in SOURCE and SUMMARY uses neutral phrasing, do not penalize.',
    '- Penalize use of non-canonical roster names when canonical match is clear.',
    '',
    'Output:',
    '- First line: one short feedback sentence.',
    '- Final line: exactly PASS, FAIL, or a numeric score from 0 to 1.',
    '',
    'SOURCE:',
    source,
    '',
    'SUMMARY:',
    summary
  ].join('\n');
}

function parseScore(review) {
  const lines = String(review || '').split(/\r?\n/u).map((x) => x.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  if (/^PASS$/i.test(last)) return 1;
  if (/^FAIL$/i.test(last)) return 0;
  const n = Number(last);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0;
}

function normalizeNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseRosterRoles(rosterText) {
  const byFull = new Map();
  const byLast = new Map();
  const re = /^\s*-\s*([^|\n]+?)\s*\|\s*role:\s*([^|\n]+)\s*(?:\||$)/gimu;
  for (const m of String(rosterText || '').matchAll(re)) {
    const name = String(m[1] || '').trim();
    const role = String(m[2] || '').trim().toLowerCase();
    if (!name || !role) continue;
    const fullKey = normalizeNameKey(name);
    if (!fullKey) continue;
    byFull.set(fullKey, role);
    const last = fullKey.split(' ').filter(Boolean).at(-1) || '';
    if (!last) continue;
    const arr = byLast.get(last) || [];
    arr.push({ fullKey, role });
    byLast.set(last, arr);
  }
  return { byFull, byLast };
}

function expectedRoleFromTitle(title) {
  const t = String(title || '').toLowerCase().trim();
  if (t === 'mayor') return 'mayor';
  if (t === 'deputy mayor') return 'deputy mayor';
  if (t === 'councillor' || t === 'councilor') return 'councillor';
  return '';
}

function sourceMentionsName(source, rawName) {
  const sourceNorm = normalizeNameKey(source);
  const full = normalizeNameKey(rawName);
  if (!full) return false;
  if (sourceNorm.includes(full)) return true;
  const last = full.split(' ').filter(Boolean).at(-1) || '';
  return last ? sourceNorm.includes(last) : false;
}

function findTitledIdentityViolations(summary, source, rosterRoles) {
  const out = [];
  const re = /\b(Mayor|Deputy Mayor|Councillor|Councilor)\s+([A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,2})\b/gu;
  for (const m of String(summary || '').matchAll(re)) {
    const title = String(m[1] || '');
    const rawName = String(m[2] || '').trim();
    const expected = expectedRoleFromTitle(title);
    if (!expected) continue;
    const fullKey = normalizeNameKey(rawName);
    const directRole = rosterRoles.byFull.get(fullKey);
    if (directRole) {
      if (!directRole.includes(expected)) {
        out.push(`${title} ${rawName} (role mismatch: roster=${directRole})`);
      }
      if (!sourceMentionsName(source, rawName)) {
        out.push(`${title} ${rawName} (not explicit in source)`);
      }
      continue;
    }
    const last = fullKey.split(' ').filter(Boolean).at(-1) || '';
    const candidates = rosterRoles.byLast.get(last) || [];
    const roleMatches = candidates.filter((c) => c.role.includes(expected));
    if (roleMatches.length !== 1) {
      out.push(`${title} ${rawName} (unknown titled person)`);
      continue;
    }
    if (!sourceMentionsName(source, rawName)) {
      out.push(`${title} ${rawName} (not explicit in source)`);
    }
  }
  return out;
}

function countWords(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/u).length;
}

async function summarizeSection({ heading, body, focus, rosterText, shortMode = false }) {
  const source = abridgeUtf8(body, 14000);
  const rosterRoles = parseRosterRoles(rosterText);
  let feedback = '';
  let bestSummary = '';
  let bestScore = -1;

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const summary = await ask([
      { role: 'system', content: 'You are a concise factual civic meeting summarizer.' },
      {
        role: 'user',
        content: shortMode
          ? buildShortSummaryPrompt({ heading, source, focus, feedback, rosterText })
          : buildSummaryPrompt({ heading, source, focus, feedback, rosterText })
      }
    ], { numPredict: shortMode ? 120 : 340 });

    const reviewSemantic = await ask([
      { role: 'system', content: 'You are a strict semantic summary scorer.' },
      { role: 'user', content: buildScorePrompt({ source, summary, rosterText }) }
    ], { numPredict: 220 });
    const reviewAttribution = await ask([
      { role: 'system', content: 'You are a strict speaker attribution verifier.' },
      { role: 'user', content: buildAttributionScorePrompt({ source, summary, rosterText }) }
    ], { numPredict: 180 });

    const scoreSemantic = parseScore(reviewSemantic);
    const scoreAttribution = parseScore(reviewAttribution);
    const titledViolations = findTitledIdentityViolations(summary, source, rosterRoles);
    const score = titledViolations.length
      ? 0
      : Math.min(scoreSemantic, scoreAttribution);
    if (bestSummary === '' || score > bestScore) {
      bestSummary = summary;
      bestScore = score;
    }
    const violationFeedback = titledViolations.length
      ? `\n\nTITLE_IDENTITY_GUARD:\nInvalid titled attributions: ${titledViolations.join('; ')}\nFinal line: 0.0`
      : '';
    feedback = `${reviewSemantic}\n\nATTRIBUTION_REVIEW:\n${reviewAttribution}${violationFeedback}`;
    if (score >= PASS_THRESHOLD) break;
  }

  return { summary: bestSummary, score: Number(bestScore.toFixed(3)) };
}

function toMarkdown(items, focus) {
  const lines = ['# Agenda Section Summaries', ''];
  if (String(focus || '').trim()) {
    lines.push(`Focus: ${String(focus).trim()}`, '');
  }
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    lines.push(`## ${i + 1}. ${it.heading}`);
    lines.push(`(faithfulness score: ${it.score.toFixed(3)})`);
    lines.push('');
    lines.push(it.summary || 'No summary produced.');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || 'auto';
  const focusArg = process.argv.slice(4).join(' ').trim();

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolvePathFromRoot(transcriptDirArg);
  ensureDir(transcriptDir);

  const { seriesPath, resolvedPrefix } = pickAgendaWiseSeries(transcriptDir, prefixArg);
  const rosterPath = pickCouncilRosterFile(transcriptDir);
  const rosterText = rosterPath ? abridgeUtf8(fs.readFileSync(rosterPath, 'utf8'), 5000) : '';
  const outMd = path.join(transcriptDir, `${resolvedPrefix}.agenda-summary.md`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.agenda-summary.json`);

  process.stdout.write(`[agenda-summary] source series: ${seriesPath}\n`);
  process.stdout.write(`[agenda-summary] roster: ${rosterPath || '(none)'}\n`);
  process.stdout.write(`[agenda-summary] output md: ${outMd}\n`);

  const source = fs.readFileSync(seriesPath, 'utf8');
  let chips = parseSeriesTexts(source);
  if (!chips.length) throw new Error('agenda summary defective: no wise chips parsed from series');
  if (MAX_SECTIONS > 0) chips = chips.slice(0, MAX_SECTIONS);

  const out = [];
  for (let i = 0; i < chips.length; i += 1) {
    const { heading, body } = parseHeadingAndBody(chips[i], i);
    process.stdout.write(`[agenda-summary] atindex num ${i + 1} toindex num ${chips.length} heading ${heading}\n`);
    const wordCount = countWords(body);
    let summary = '';
    let score = 1;
    let mode = 'llm';
    if (wordCount < MIN_SUMMARY_WORDS) {
      const shortOut = await summarizeSection({ heading, body, focus: focusArg, rosterText, shortMode: true });
      summary = shortOut.summary;
      score = shortOut.score;
      mode = 'llm-short';
    } else {
      const summarized = await summarizeSection({ heading, body, focus: focusArg, rosterText });
      if (summarized.score < PASS_THRESHOLD && wordCount < 220) {
        const shortFallback = await summarizeSection({ heading, body, focus: focusArg, rosterText, shortMode: true });
        summary = shortFallback.summary;
        score = shortFallback.score;
        mode = 'llm-short-fallback';
      } else {
        summary = summarized.summary;
        score = summarized.score;
      }
    }
    out.push({
      index: i + 1,
      heading,
      summary,
      score,
      mode,
      source_words: wordCount
    });
  }

  fs.writeFileSync(outMd, toMarkdown(out, focusArg), 'utf8');
  fs.writeFileSync(outJson, JSON.stringify({
    source_series: seriesPath,
    roster_file: rosterPath || '',
    focus: focusArg,
    sections: out
  }, null, 2), 'utf8');

  process.stdout.write(`[agenda-summary] sections: ${out.length}\n`);
  process.stdout.write(`[agenda-summary] wrote: ${outMd}\n`);
  process.stdout.write(`[agenda-summary] wrote: ${outJson}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
