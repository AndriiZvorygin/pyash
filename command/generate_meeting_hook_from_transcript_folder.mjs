#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readPyaTextValues } from './pya_lookup.mjs';

const ROOT = '/home/htaf/pyac/pyash';
function resolveOllamaHost() {
  const fromEnv = String(process.env.OLLAMA_HOST || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/u, '');
  const secretPath = '/home/htaf/pyash/configure/secret.pya';
  const vals = readPyaTextValues(secretPath, ['ollama host', 'ai host', 'relay local host']);
  const fromPya = String(vals['ollama host'] || vals['ai host'] || vals['relay local host'] || '').trim();
  if (fromPya) return fromPya.replace(/\/$/u, '');
  return 'http://mriczo:11434';
}
const OLLAMA_URL = `${resolveOllamaHost()}/api/chat`;
const RESOLVED_OLLAMA_HOST = OLLAMA_URL.replace(/\/api\/chat$/u, "");
const MODEL = process.env.OWEN_HOOK_MODEL || process.env.OWEN_SUMMARY_MODEL || 'qwen3.5:9b';
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 0.8;

function usage() {
  return [
    'Usage: node command/generate_meeting_hook_from_transcript_folder.mjs <transcript_dir> [prefix] [focus] [jurisdiction] [body] [hook_mode]',
    'Example: node command/generate_meeting_hook_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto-normalized "newsworthy juicy bits" "Owen Sound" "Council" preview'
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

function sanitizePreviewNounHook(text) {
  const line = String(text || '').split(/\r?\n/u).map((x) => x.trim()).filter(Boolean)[0] || '';
  const cleaned = line
    .replace(/\bCouncil\b/giu, ' ')
    .replace(/[^A-Za-z0-9'& -]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const words = cleaned.split(/\s+/u).filter(Boolean).slice(0, 8);
  if (words.length < 3) return '';
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

const HOOK_MALFORMED_TOKEN_REPAIRS = new Map([
  ['anail', 'nail'],
]);

const HOOK_COMMON_WORDS = new Set([
  'patio', 'permit', 'permits', 'bylaw', 'by-law', 'bill', 'planning', 'changes',
  'city', 'by-laws', 'business', 'licence', 'licences', 'license', 'licenses',
  'rules', 'new', 'and', 'nail', 'eyelash', 'studio', 'beauty', 'review', 'reviews',
  'consider', 'considers', 'discuss', 'discusses', 'hears', 'receives', 'tax', 'fees',
]);

const HOOK_TRAILING_FRAGMENT_WORDS = new Set(['and', 'or', 'with', 'including', 'despite']);
const HOOK_WEAK_END_WORDS = new Set(['eye']);

function normalizeHookPhrases(text) {
  return String(text || '')
    .replace(/\beye\s+lash(es)?\b/giu, 'eyelash$1')
    .replace(/\banail\b/giu, 'nail')
    .replace(/\ba\s+(?=(nail|eyelash|studio|shop|store|permit|by-?law|bill|licen[cs]e?s?|rules?|changes?)\b)/giu, '');
}

function vowelRatio(word) {
  const letters = String(word || '').toLowerCase().replace(/[^a-z]/gu, '');
  if (!letters) return 1;
  const vowels = (letters.match(/[aeiouy]/gu) || []).length;
  return vowels / letters.length;
}

function cleanupHookToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const base = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '');
  if (!base) return '';
  const lower = base.toLowerCase();

  if (HOOK_MALFORMED_TOKEN_REPAIRS.has(lower)) {
    const fixed = HOOK_MALFORMED_TOKEN_REPAIRS.get(lower);
    return fixed.charAt(0).toUpperCase() + fixed.slice(1).toLowerCase();
  }
  if (/^[A-Z]{2,}$/u.test(base)) return base;
  if (/\d/u.test(base)) return base;

  if (!HOOK_COMMON_WORDS.has(lower)) {
    const letters = lower.replace(/[^a-z]/gu, '');
    if (letters.length >= 5) {
      const ratio = vowelRatio(letters);
      if (ratio < 0.22 || !/[aeiouy]/u.test(letters)) return '';
      if (/^a[a-z]{4,}$/u.test(letters)) {
        const trimmed = letters.slice(1);
        if (HOOK_COMMON_WORDS.has(trimmed)) {
          return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
        }
      }
    }
  }

  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

function sanitizeFinalPreviewHook(hookText) {
  const normalized = normalizeHookPhrases(hookText);
  const tokens = normalized.split(/\s+/u).map(cleanupHookToken).filter(Boolean);
  const collapsed = [];
  for (const t of tokens) {
    if (!collapsed.length || normalizeForMatch(collapsed[collapsed.length - 1]) !== normalizeForMatch(t)) {
      collapsed.push(t);
    }
  }
  while (collapsed.length >= 2) {
    const last = normalizeForMatch(collapsed[collapsed.length - 1]);
    const prev = normalizeForMatch(collapsed[collapsed.length - 2]);
    if (HOOK_WEAK_END_WORDS.has(last) && prev === 'and') {
      collapsed.pop();
      collapsed.pop();
      continue;
    }
    break;
  }
  while (collapsed.length) {
    const last = normalizeForMatch(collapsed[collapsed.length - 1]);
    if (!HOOK_TRAILING_FRAGMENT_WORDS.has(last)) break;
    collapsed.pop();
  }
  const trimmed = collapsed.slice(0, 8).join(' ').trim();
  return sanitizePreviewNounHook(trimmed);
}

const PREVIEW_BANNED_VERBS = new Set([
  'adopt', 'adopts', 'adopted',
  'approve', 'approves', 'approved',
  'pass', 'passes', 'passed',
  'defeat', 'defeats', 'defeated',
  'confirm', 'confirms', 'confirmed',
  'carry', 'carries', 'carried',
]);

const PREVIEW_REPLACEMENT_VERBS = new Map([
  ['adopt', 'considers'],
  ['adopts', 'considers'],
  ['adopted', 'considers'],
  ['approve', 'considers'],
  ['approves', 'considers'],
  ['approved', 'considers'],
  ['pass', 'debates'],
  ['passes', 'debates'],
  ['passed', 'debates'],
  ['defeat', 'debates'],
  ['defeats', 'debates'],
  ['defeated', 'debates'],
  ['confirm', 'reviews'],
  ['confirms', 'reviews'],
  ['confirmed', 'reviews'],
  ['carry', 'considers'],
  ['carries', 'considers'],
  ['carried', 'considers'],
]);

const PREVIEW_ALLOWED_VERBS = new Set([
  'considers', 'reviews', 'discusses', 'hears', 'receives', 'debates',
]);

function inferHookMode({ explicitMode, resolvedPrefix, summaryPath, focus }) {
  const mode = String(explicitMode || '').trim().toLowerCase();
  if (mode === 'preview' || mode === 'recap') return mode;
  const prefixText = String(resolvedPrefix || '').toLowerCase();
  const summaryText = String(summaryPath || '').toLowerCase();
  const focusText = String(focus || '').toLowerCase();
  if (prefixText.includes('.agenda') || summaryText.includes('.agenda.') || focusText.includes('upcoming agenda')) {
    return 'preview';
  }
  return 'recap';
}

function containsPreviewBannedVerb(text) {
  const norm = normalizeForMatch(text);
  const words = norm.split(' ').filter(Boolean);
  return words.some((w) => PREVIEW_BANNED_VERBS.has(w));
}

function enforcePreviewVerbTense(hook) {
  const rawWords = String(hook || '').trim().split(/\s+/u).filter(Boolean);
  if (!rawWords.length) return hook;
  const words = [...rawWords];
  for (let i = 0; i < words.length; i += 1) {
    const plain = normalizeForMatch(words[i]);
    if (PREVIEW_REPLACEMENT_VERBS.has(plain)) {
      const next = PREVIEW_REPLACEMENT_VERBS.get(plain);
      words[i] = next.charAt(0).toUpperCase() + next.slice(1);
      break;
    }
  }
  const normalizedWords = words.map((w) => normalizeForMatch(w));
  const hasAllowedVerb = normalizedWords.some((w) => PREVIEW_ALLOWED_VERBS.has(w));
  if (!hasAllowedVerb) return sanitizeHook('Council Considers Agenda Items');
  if (normalizedWords[0] === 'council' && words.length >= 2) {
    const second = normalizeForMatch(words[1]);
    if (!PREVIEW_ALLOWED_VERBS.has(second)) {
      words.splice(1, 0, 'Considers');
    }
  }
  return sanitizeHook(words.join(' '));
}

function isGenericPreviewHook(text) {
  const n = normalizeForMatch(text);
  return n.includes('council considers agenda items')
    || n.includes('meeting agenda')
    || n.includes('council business')
    || n.includes('several reports')
    || n.includes('city matters')
    || n.includes('updates')
    || n === 'council considers agenda items';
}

function extractTopNewsHeadings(mdText) {
  const lines = String(mdText || '').split(/\r?\n/u);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s+\*\*(.+?)\*\*/u);
    if (!m) continue;
    const heading = String(m[1] || '').trim();
    if (heading) out.push(heading);
  }
  return out;
}

function deriveSubjectFromHeading(heading) {
  const raw = String(heading || '').trim();
  if (!raw) return '';

  const reField = raw.match(/\bRe:\s*([^,.;\n]{6,80})/iu);
  if (reField && reField[1]) return toTitleWords(reField[1]);

  const bylaw = raw.match(/\b(By-?laws?)\b/iu);
  if (bylaw) return 'City By-laws';

  let s = raw
    .replace(/^\s*\d+(?:\.[a-z])?\s*/iu, '')
    .replace(/^\s*Report\s+[A-Z]{1,4}-\d{2}-\d{2,3}\s+from\s+.+?\bRe:\s*/iu, '')
    .replace(/^\s*Verbal Report from\s+.+?\bRe:\s*/iu, '')
    .replace(/^\s*Final approvals issued for the following\s+/iu, '')
    .replace(/^\s*•\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!s) return '';
  const words = s.split(/\s+/u).slice(0, 5).join(' ');
  return toTitleWords(words);
}

function buildPreviewHookFromRankedItems(headings = []) {
  const candidates = (Array.isArray(headings) ? headings : [])
    .map((h) => sanitizeFinalPreviewHook(deriveSubjectFromHeading(h)))
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex((x) => normalizeForMatch(x) === normalizeForMatch(s)) === i);
  if (!candidates.length) return '';

  const subjectA = candidates[0];
  const subjectB = candidates[1] || '';
  const genericSubjects = new Set([
    'agenda items',
    'meeting agenda',
    'council business',
    'several reports',
    'city matters',
    'updates',
    'information',
    'reports',
    'business',
    'matters',
  ]);
  if (genericSubjects.has(normalizeForMatch(subjectA))) return '';

  const picked = [subjectA];
  if (subjectB && !genericSubjects.has(normalizeForMatch(subjectB))) picked.push(subjectB);
  const subjectC = candidates[2] || '';
  if (subjectC && !genericSubjects.has(normalizeForMatch(subjectC))) picked.push(subjectC);

  if (picked.length >= 3) {
    const combined = sanitizeFinalPreviewHook(`${picked[0]} ${picked[1]} ${picked[2]}`);
    if (combined) return combined;
  }
  if (picked.length === 2) {
    const combined = sanitizeFinalPreviewHook(`${picked[0]} And ${picked[1]}`);
    if (combined) return combined;
  }
  return sanitizeFinalPreviewHook(subjectA);
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

function buildHookPrompt({ sourceSummary, focus, jurisdiction, body, feedback, hookMode }) {
  const focusLine = String(focus || '').trim() || 'the newsworthy, juicy, and unusual bits';
  const isPreview = hookMode === 'preview';
  return [
    'Create a short meeting hook phrase for a transcript/news post title.',
    `Mode: ${isPreview ? 'upcoming agenda preview' : 'post-meeting recap'}`,
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
    ...(isPreview
      ? ['- Prospective language only; this is an upcoming agenda.', '- Do not use completed outcome verbs (adopts/approves/passes/defeats/confirms/carries).', '- Prefer considers/reviews/discusses/hears/receives/debates.']
      : []),
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

function buildScorePrompt({ sourceSummary, hook, jurisdiction, body, hookMode }) {
  const isPreview = hookMode === 'preview';
  return [
    'Score HOOK for semantic faithfulness and utility for a municipal transcript title.',
    `Mode: ${isPreview ? 'upcoming agenda preview' : 'post-meeting recap'}`,
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
    ...(isPreview
      ? ['- For preview mode, fail completed outcome verbs (adopts/approves/passes/defeats/confirms/carries).', '- Reward prospective framing (considers/reviews/discusses/hears/receives/debates).']
      : []),
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
  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama fetch failed for meeting-hook using OLLAMA_HOST=${RESOLVED_OLLAMA_HOST} endpoint=${OLLAMA_URL}; check reachability to mriczo:11434 (${String(err?.message || err)})`);
  }
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || '').trim();
}

async function generateHook({ sourceSummary, topNewsHeadings, focus, jurisdiction, body, hookMode }) {
  let feedback = '';
  let bestHook = '';
  let bestScore = -1;
  let bestReview = '';

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const draftRaw = await ask([
      { role: 'system', content: 'You are a precise civic headline hook writer.' },
      { role: 'user', content: buildHookPrompt({ sourceSummary, focus, jurisdiction, body, feedback, hookMode }) },
    ], { numPredict: 64 });

    const draft = hookMode === 'preview'
      ? enforcePreviewVerbTense(sanitizeHook(draftRaw))
      : sanitizeHook(draftRaw);

    let review = '';
    let score = 0;
    if (hookMode === 'preview' && containsPreviewBannedVerb(draft)) {
      review = 'Hook uses completed-outcome verbs disallowed for upcoming agenda previews.\n0';
      score = 0;
    } else if (hookDecisionClaimUnsupported(draft, sourceSummary)) {
      review = 'Hook uses an unsupported decision verb (adopted/approved/passed) for the same subject.\n0';
      score = 0;
    } else {
      review = await ask([
        { role: 'system', content: 'You are a strict semantic verifier.' },
        { role: 'user', content: buildScorePrompt({ sourceSummary, hook: draft, jurisdiction, body, hookMode }) },
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

  let safeHook = bestScore >= PASS_THRESHOLD ? bestHook : fallbackHookFromSummary(sourceSummary);
  if (hookMode === 'preview') {
    const rankedHook = buildPreviewHookFromRankedItems(topNewsHeadings);
    if (rankedHook) {
      safeHook = sanitizeFinalPreviewHook(rankedHook) || rankedHook;
    } else {
      safeHook = enforcePreviewVerbTense(safeHook);
      if (isGenericPreviewHook(safeHook)) {
        safeHook = sanitizeFinalPreviewHook(deriveSubjectFromHeading(topNewsHeadings[0] || '')) || safeHook;
      }
      safeHook = safeHook.replace(/\bCouncil\b/giu, '').replace(/\s+/gu, ' ').trim();
      safeHook = sanitizeFinalPreviewHook(safeHook) || safeHook;
    }
  }

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
  const hookModeArg = process.argv[7] || '';

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolvePathFromRoot(transcriptDirArg);
  ensureDir(transcriptDir);

  const { summaryPath, resolvedPrefix } = pickMeetingSummaryPath(transcriptDir, prefixArg);
  const hookMode = inferHookMode({
    explicitMode: hookModeArg,
    resolvedPrefix,
    summaryPath,
    focus: focusArg,
  });
  const meetingSummaryMd = fs.readFileSync(summaryPath, 'utf8');
  const topNewsworthyMd = extractMarkdownSection(meetingSummaryMd, 'Top Newsworthy Developments');
  const topNewsHeadings = extractTopNewsHeadings(topNewsworthyMd);
  const sourceSummary = stripMarkdown(topNewsworthyMd || meetingSummaryMd).slice(0, 32000);
  if (!sourceSummary) throw new Error(`meeting summary is empty: ${summaryPath}`);

  const outTxt = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.txt`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.json`);

  process.stdout.write(`[meeting-hook] source: ${summaryPath}\n`);
  process.stdout.write(`[llm] ollama host: ${RESOLVED_OLLAMA_HOST}\n`);
  process.stdout.write(`[meeting-hook] output txt: ${outTxt}\n`);

  const out = await generateHook({
    sourceSummary,
    topNewsHeadings,
    focus: focusArg,
    jurisdiction: jurisdictionArg,
    body: bodyArg,
    hookMode,
  });

  fs.writeFileSync(outTxt, `${out.hook}\n`, 'utf8');
  fs.writeFileSync(outJson, JSON.stringify({
    source_meeting_summary: summaryPath,
    source_scope: topNewsworthyMd ? 'top_newsworthy_developments' : 'whole_meeting_summary',
    model: MODEL,
    hook_mode: hookMode,
    focus: focusArg,
    jurisdiction: jurisdictionArg,
    body: bodyArg,
    hook: out.hook,
    score: out.score,
    fallback_used: Boolean(out.fallback_used),
    verifier_feedback: out.verifier_feedback,
  }, null, 2), 'utf8');

  process.stdout.write(`[meeting-hook] score: ${out.score.toFixed(3)}\n`);
  process.stdout.write(`[meeting-hook] hook_mode: ${hookMode}\n`);
  process.stdout.write(`[meeting-hook] hook: ${out.hook}\n`);
  process.stdout.write(`[meeting-hook] wrote: ${outTxt}\n`);
  process.stdout.write(`[meeting-hook] wrote: ${outJson}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
