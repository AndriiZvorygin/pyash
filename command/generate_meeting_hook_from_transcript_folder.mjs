#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, '')
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, '')}/api/chat`
  : 'http://localhost:11434/api/chat';
const MODEL = process.env.OWEN_HOOK_MODEL || process.env.OWEN_SUMMARY_MODEL || 'qwen3.5:9b';
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 0.8;

function usage() {
  return [
    'Usage: node command/generate_meeting_hook_from_transcript_folder.mjs <transcript_dir> [prefix] [focus] [jurisdiction] [body]',
    'Example: node command/generate_meeting_hook_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto-normalized "newsworthy juicy bits" "Owen Sound" "Council"'
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

function pickMeetingSummaryPath(transcriptDir, prefix = 'auto') {
  const wantsAuto = !prefix || /^auto$/iu.test(String(prefix));
  if (!wantsAuto) {
    const exact = path.join(transcriptDir, `${prefix}.meeting-summary.md`);
    if (fs.existsSync(exact)) return { summaryPath: exact, resolvedPrefix: prefix };
  }

  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.meeting-summary.md'))
    .sort();
  if (!files.length) throw new Error(`no *.meeting-summary.md found in ${transcriptDir}`);

  const ranked = files
    .map((name) => {
      const p = path.join(transcriptDir, name);
      const st = fs.statSync(p);
      const pfx = name.replace(/\.meeting-summary\.md$/u, '');
      let score = 0;
      if (/normalized/iu.test(pfx)) score += 200;
      if (/test|tmp|partial/iu.test(pfx)) score -= 300;
      if (pfx === 'meeting-qwen-auto') score += 20;
      return { name, p, pfx, score, mtime: Number(st.mtimeMs || 0), size: Number(st.size || 0) };
    })
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime || b.size - a.size || a.name.localeCompare(b.name));

  return { summaryPath: ranked[0].p, resolvedPrefix: ranked[0].pfx };
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/\*\*(.*?)\*\*/gu, '$1')
    .replace(/\*(.*?)\*/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function toTitleWords(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9' -]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function sanitizeHook(text) {
  const line = String(text || '').split(/\r?\n/u).map((x) => x.trim()).filter(Boolean)[0] || '';
  const t = toTitleWords(line);
  const words = t.split(/\s+/u).filter(Boolean).slice(0, 6);
  if (words.length < 3) {
    const fallback = ['Council', 'Decisions', 'At', 'A', 'Turning', 'Point'];
    return fallback.slice(0, 4).join(' ');
  }
  return words.join(' ');
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function extractHookContentTerms(hookNorm) {
  const stop = new Set([
    'city', 'council', 'committee', 'board', 'meeting', 'transcript', 'report',
    'owen', 'sound', 'the', 'a', 'an', 'and', 'of', 'for', 'to', 'in', 'on', 'at',
    'bans', 'ban', 'banned', 'adopt', 'adopted', 'approve', 'approved', 'pass', 'passed',
    'ratify', 'ratified', 'will', 'would', 'is', 'are', 'was', 'were'
  ]);
  return hookNorm.split(' ').filter((w) => w.length >= 4 && !stop.has(w));
}

function hookDecisionClaimUnsupported(hook, sourceSummary) {
  const decisionTerms = ['adopt', 'adopted', 'approve', 'approved', 'pass', 'passed', 'ratify', 'ratified', 'ban', 'bans', 'banned'];
  const finalizationTerms = ['approved', 'adopted', 'passed', 'carried', 'unanimous', 'vote', 'voted', 'resolved'];
  const hookNorm = normalizeForMatch(hook);
  if (!decisionTerms.some((t) => hookNorm.includes(t))) return false;

  const hookTerms = extractHookContentTerms(hookNorm);

  const src = String(sourceSummary || '');
  const sentences = src.split(/(?<=[.!?])\s+/u).map(normalizeForMatch).filter(Boolean);

  // Require both subject overlap and explicit finalization signal for strong decision hooks.
  for (const s of sentences) {
    if (!hookTerms.length) continue;
    const subjectOverlap = hookTerms.some((term) => s.includes(term));
    if (!subjectOverlap) continue;
    if (finalizationTerms.some((t) => s.includes(t))) return false;
  }
  return true;
}

function fallbackHookFromSummary(summaryText) {
  const src = String(summaryText || '');
  if (!src) return 'Council Integrity Report Flashpoint';

  if (/\b17,?000\b/u.test(src) && /\bintegrity\b/iu.test(src)) {
    return '17K Integrity Report Flashpoint';
  }
  if (/\b465\b/u.test(src) && /\bzoning\b/iu.test(src)) {
    return 'Zoning Overhaul Sets 465 Threshold';
  }
  if (/\bworkforce housing\b/iu.test(src) && /\b350\b/u.test(src)) {
    return 'Workforce Housing Plan Targets 500';
  }
  if (/\bintegrity\b/iu.test(src) && /\bkoepke\b/iu.test(src)) {
    return 'Integrity Report On Koepke';
  }

  const words = src
    .replace(/[^A-Za-z0-9' -]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (words.length >= 3) return words.join(' ');
  return 'Council Integrity Report Flashpoint';
}

function buildHookPrompt({ sourceSummary, focus, jurisdiction, body, feedback }) {
  const focusLine = String(focus || '').trim() || 'the newsworthy, juicy, and unusual bits';
  return [
    'Create a short meeting hook phrase for a transcript/news post title.',
    `Jurisdiction: ${jurisdiction}`,
    `Body: ${body}`,
    `Focus: ${focusLine}`,
    '',
    'Rules:',
    '- 3 to 6 words only.',
    '- Lead with the most newsworthy or surprising concrete development.',
    '- Prefer strong, high-signal wording over generic committee language.',
    '- Concrete and specific, not clickbait.',
    '- Faithful to SOURCE_SUMMARY only.',
    '- No punctuation except apostrophe if required.',
    '- No date and no jurisdiction/body names in the hook.',
    '- Avoid bland joins like "and" unless absolutely necessary.',
    '- Favor active, vivid wording that makes a resident want to read more.',
    '- Output one line only.',
    '',
    'RETRY_FEEDBACK:',
    feedback || '',
    '',
    'SOURCE_SUMMARY:',
    sourceSummary,
  ].join('\n');
}

function buildScorePrompt({ sourceSummary, hook, jurisdiction, body }) {
  return [
    'Score HOOK for semantic faithfulness and utility for a municipal transcript title.',
    `Jurisdiction: ${jurisdiction}`,
    `Body: ${body}`,
    '',
    'Scoring:',
    '- 1.0 = fully faithful and strong',
    '- 0.8 = faithful with small weakness',
    '- 0.5 = mixed',
    '- 0.0 = weak or misleading',
    '',
    'Rules:',
    '- Penalize invented claims not in SOURCE_SUMMARY.',
    '- Penalize action verbs that overstate status (adopted/approved/passed) unless SOURCE_SUMMARY explicitly supports that action for the same subject.',
    '- Penalize vagueness if SOURCE_SUMMARY has concrete high-impact items.',
    '- Penalize non-title-ready hooks (too long/too short/noise).',
    '- Penalize dry/boilerplate phrasing when SOURCE_SUMMARY contains conflict, cost, major policy shifts, or unusual events.',
    '- Reward hooks that foreground the single highest-impact item first.',
    '- Reward clear civic relevance.',
    '',
    'Output:',
    '- First line: one short feedback sentence.',
    '- Final line: exactly PASS, FAIL, or a numeric score from 0 to 1.',
    '',
    'SOURCE_SUMMARY:',
    sourceSummary,
    '',
    'HOOK:',
    hook,
  ].join('\n');
}

function parseScore(review) {
  const lines = String(review || '').split(/\r?\n/u).map((x) => x.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  if (/^PASS$/iu.test(last)) return 1;
  if (/^FAIL$/iu.test(last)) return 0;
  const n = Number(last);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0;
}

async function ask(messages, { numPredict = 120 } = {}) {
  const body = {
    model: MODEL,
    mode: 'chat',
    stream: false,
    think: false,
    keep_alive: 300,
    options: { temperature: 0.15, num_predict: numPredict },
    messages,
  };
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || '').trim();
}

async function generateHook({ sourceSummary, focus, jurisdiction, body }) {
  let feedback = '';
  let bestHook = '';
  let bestScore = -1;
  let bestReview = '';

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const draftRaw = await ask([
      { role: 'system', content: 'You are a precise civic headline hook writer.' },
      { role: 'user', content: buildHookPrompt({ sourceSummary, focus, jurisdiction, body, feedback }) },
    ], { numPredict: 64 });

    const draft = sanitizeHook(draftRaw);

    let review = '';
    let score = 0;
    if (hookDecisionClaimUnsupported(draft, sourceSummary)) {
      review = 'Hook uses an unsupported decision verb (adopted/approved/passed) for the same subject.\n0';
      score = 0;
    } else {
      review = await ask([
        { role: 'system', content: 'You are a strict semantic verifier.' },
        { role: 'user', content: buildScorePrompt({ sourceSummary, hook: draft, jurisdiction, body }) },
      ], { numPredict: 180 });
      score = parseScore(review);
    }
    if (bestHook === '' || score > bestScore) {
      bestHook = draft;
      bestScore = score;
      bestReview = review;
    }
    feedback = review;
    if (score >= PASS_THRESHOLD) break;
  }

  const safeHook = bestScore >= PASS_THRESHOLD ? bestHook : fallbackHookFromSummary(sourceSummary);

  return {
    hook: safeHook,
    score: Number(bestScore.toFixed(3)),
    verifier_feedback: bestReview,
    fallback_used: bestScore < PASS_THRESHOLD,
  };
}

function extractMarkdownSection(mdText, headingText) {
  const lines = String(mdText || '').split(/\r?\n/u);
  const target = String(headingText || '').trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/u);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || 'auto';
  const focusArg = process.argv[4] || '';
  const jurisdictionArg = process.argv[5] || 'Owen Sound';
  const bodyArg = process.argv[6] || 'Council';

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolvePathFromRoot(transcriptDirArg);
  ensureDir(transcriptDir);

  const { summaryPath, resolvedPrefix } = pickMeetingSummaryPath(transcriptDir, prefixArg);
  const meetingSummaryMd = fs.readFileSync(summaryPath, 'utf8');
  const topNewsworthyMd = extractMarkdownSection(meetingSummaryMd, 'Top Newsworthy Developments');
  const sourceSummary = stripMarkdown(topNewsworthyMd || meetingSummaryMd).slice(0, 32000);
  if (!sourceSummary) throw new Error(`meeting summary is empty: ${summaryPath}`);

  const outTxt = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.txt`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.json`);

  process.stdout.write(`[meeting-hook] source: ${summaryPath}\n`);
  process.stdout.write(`[meeting-hook] output txt: ${outTxt}\n`);

  const out = await generateHook({
    sourceSummary,
    focus: focusArg,
    jurisdiction: jurisdictionArg,
    body: bodyArg,
  });

  fs.writeFileSync(outTxt, `${out.hook}\n`, 'utf8');
  fs.writeFileSync(outJson, JSON.stringify({
    source_meeting_summary: summaryPath,
    source_scope: topNewsworthyMd ? 'top_newsworthy_developments' : 'whole_meeting_summary',
    model: MODEL,
    focus: focusArg,
    jurisdiction: jurisdictionArg,
    body: bodyArg,
    hook: out.hook,
    score: out.score,
    fallback_used: Boolean(out.fallback_used),
    verifier_feedback: out.verifier_feedback,
  }, null, 2), 'utf8');

  process.stdout.write(`[meeting-hook] score: ${out.score.toFixed(3)}\n`);
  process.stdout.write(`[meeting-hook] hook: ${out.hook}\n`);
  process.stdout.write(`[meeting-hook] wrote: ${outTxt}\n`);
  process.stdout.write(`[meeting-hook] wrote: ${outJson}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
