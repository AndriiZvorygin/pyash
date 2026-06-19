#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const MAX_ATTEMPTS = 8;
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

function selectHookGenerationSource(sourceSummary = '') {
  const text = String(sourceSummary || '').replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [text];
  const kept = [];
  let total = 0;
  for (const sentence of sentences) {
    const cleaned = String(sentence || '').replace(/\s+/gu, ' ').trim();
    if (!cleaned) continue;
    if (kept.length >= 3 && total >= 500) break;
    if (total + cleaned.length > 1400 && kept.length) break;
    kept.push(cleaned);
    total += cleaned.length;
  }
  return (kept.join(' ') || text).slice(0, 1800).trim();
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

function sanitizeChapterStyleHook(text, { jurisdiction = '', body = '' } = {}) {
  const raw = sanitizeHook(text);
  const banned = new Set([
    ...String(jurisdiction || '').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
    ...String(body || '').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
    'meeting', 'regular', 'council', 'city', 'committee', 'transcript',
  ]);
  const kept = raw
    .split(/\s+/u)
    .filter(Boolean)
    .filter((w) => !banned.has(normalizeForMatch(w)))
    .slice(0, 6);
  const trailing = new Set([...HOOK_TRAILING_FRAGMENT_WORDS, 'a', 'an', 'the', 'in', 'on', 'at', 'for', 'to', 'of']);
  while (kept.length && trailing.has(normalizeForMatch(kept[kept.length - 1]))) kept.pop();
  if (kept.length >= 3) return toTitleWords(kept.join(' '));
  return raw;
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

function enforcePreviewTemporalStyle(hook) {
  const words = String(hook || '').trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return hook;
  const norm = words.map((w) => normalizeForMatch(w));
  const hasPresentVerb = norm.some((w) => PREVIEW_ALLOWED_VERBS.has(w));
  const hasFuture = norm.includes('will');
  if (hasPresentVerb || hasFuture) return sanitizeHook(words.join(' '));
  const subject = words.slice(0, 4).join(' ').trim();
  if (!subject) return 'Will Review Agenda Items';
  return sanitizeHook(`Will Review ${subject}`);
}

function isWeakPreviewHook(text = "") {
  const n = normalizeForMatch(text);
  if (!n) return true;
  if (/\b(declaration|discussion|direction|review|report|update|item|business|matter|development|concerns?)\s*$/u.test(n)
    && n.split(" ").filter(Boolean).length <= 4) return true;
  if (/^(committee|council|board)\s+(considers|reviews|discusses|hears|receives)\b/u.test(n)
    && !hasConcreteKeywordOverlap(text, n)) return true;
  if (n === "will review approval") return true;
  if (n === "will review report") return true;
  if (n === "will review item" || n === "will review items") return true;
  if (n === "will review update" || n === "will review updates") return true;
  if (n === "will review bylaw" || n === "will review bylaws") return true;
  const words = n.split(" ").filter(Boolean);
  if (words.length <= 3) return true;
  if (words.length === 4 && words[0] === "will" && words[1] === "review") return true;
  return false;
}

function derivePreviewHookFromTopNewsText(summaryText = "", jurisdiction = "", body = "") {
  const s = normalizeForMatch(summaryText);
  if (/\bwastewater\b/.test(s) && /\bdigestor\b/.test(s) && /\bclean/.test(s)) {
    return sanitizeChapterStyleHook("Wastewater Digestor Cleanout Review", { jurisdiction, body });
  }
  if (/\bby law enforcement officer\b/.test(s) || /\bbylaw enforcement officer\b/.test(s)) {
    return sanitizeChapterStyleHook("Bylaw Officer Appointment Review", { jurisdiction, body });
  }
  if (/\bfees and charges\b/.test(s) || (/\bfees\b/.test(s) && /\bcharges\b/.test(s))) {
    return sanitizeChapterStyleHook("Fees Charges Review Cycle", { jurisdiction, body });
  }
  if (/\b4th avenue west reconstruction\b/.test(s)) {
    return sanitizeChapterStyleHook("Fourth Avenue Reconstruction Review", { jurisdiction, body });
  }
  return "";
}

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
  if (!hasAllowedVerb) return sanitizeHook(words.join(' '));
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
    || n.includes('considers agenda items')
    || n.includes('meeting agenda')
    || n.includes('council business')
    || n.includes('several reports')
    || n.includes('city matters')
    || n.includes('committee considers declaration')
    || n.includes('considers declaration')
    || n.includes('updates')
    || n === 'council considers agenda items';
}

function isGenericRecapHook(text) {
  const n = normalizeForMatch(text);
  return n.includes('the session s most consequential')
    || n.includes('most consequential')
    || n.includes('the most significant development')
    || n.includes('most significant development')
    || n.includes('significant development concerns')
    || n.includes('most significant substantive')
    || n.includes('significant substantive')
    || n.includes('key council development')
    || n.includes('council decisions at')
    || n.includes('meeting highlights')
    || isProseSpeakerHook(text);
}

const GENERIC_HOOK_TERMS = new Set([
  'administration', 'administrative', 'agenda', 'alignment', 'business', 'committee', 'concern', 'concerns',
  'considers', 'council', 'declaration', 'development', 'discussion', 'direction',
  'hears', 'item', 'items', 'matter', 'matters', 'meeting', 'most', 'newsworthy',
  'open', 'procedural', 'receives', 'report', 'reports', 'review', 'reviews', 'routine',
  'significant', 'slate', 'standard', 'substantive', 'the', 'update', 'updates',
]);

function hasConcreteKeywordOverlap(hook = "", sourceSummary = "") {
  const hookTerms = normalizeForMatch(hook)
    .split(" ")
    .filter((term) => term.length >= 4)
    .filter((term) => !GENERIC_HOOK_TERMS.has(term));
  if (!hookTerms.length) return false;
  const source = normalizeForMatch(sourceSummary);
  return hookTerms.some((term) => source.includes(term));
}

function isKeywordHookReady(hook = "", sourceSummary = "", hookMode = "recap") {
  const words = String(hook || "").trim().split(/\s+/u).filter(Boolean);
  if (words.length < 3 || words.length > 6) return false;
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)$/iu.test(String(hook || "").trim())) return false;
  if (isGenericRecapHook(hook)) return false;
  if (hookMode === "preview" && (isGenericPreviewHook(hook) || isWeakPreviewHook(hook))) return false;
  return hasConcreteKeywordOverlap(hook, sourceSummary);
}

function isRedundantDurationHook(text = '') {
  const n = normalizeForMatch(text);
  const hasDecade = /\btwo decade\b/u.test(n) || /\b2 decade\b/u.test(n) || /\b20 year\b/u.test(n);
  const hasTwentyYears = /\btwenty years?\b/u.test(n) || /\b20 years?\b/u.test(n);
  return hasDecade && hasTwentyYears;
}

function isProseSpeakerHook(text = "") {
  const n = normalizeForMatch(text);
  if (!n) return false;
  const hasSpeakerSubject = /\b(representative|resident|residents|speaker|speakers|participant|participants|public|neighbourhood|neighborhood)\b/u.test(n);
  const hasProseVerb = /\b(voice|voices|voiced|raise|raises|raised|hear|hears|heard|discuss|discusses|discussed|consider|considers|considered|express|expresses|expressed)\b/u.test(n);
  const hasConcreteTopic = /\b(subdivision|frontage|lots|housing|parking|snow|pedestrian|school|hazard|eighth|twenty|third|street|avenue|consent|wetlands|ravines|servicing|density|tax|fees|transit|hospital|zoning|bylaw|food|access)\b/u.test(n);
  return hasSpeakerSubject && hasProseVerb && !hasConcreteTopic;
}

function isClippedContrastHook(text = "") {
  const n = normalizeForMatch(text);
  if (!n) return false;
  return /\b(despite|amid|over)\s+(safety|concerns|issues|questions|debate|pushback)\b/u.test(n);
}

function isPartialStreetHook(text = "") {
  const n = normalizeForMatch(text);
  if (!n) return false;
  return /\b(twenty third|eighth|fourth|ninth|tenth|eleventh|second|third)\s*$/u.test(n);
}

function hookInventsUtilitySpecificity(hook = "", sourceSummary = "") {
  const h = normalizeForMatch(hook);
  const s = normalizeForMatch(sourceSummary);
  if (!h || !s) return false;
  const utilityTerms = ["water", "sewer", "sewerless", "wastewater", "hydro"];
  return utilityTerms.some((term) => h.includes(term) && !s.includes(term));
}

function hookMissesConcernTopic(hook = "", sourceSummary = "") {
  const h = normalizeForMatch(hook);
  const s = normalizeForMatch(sourceSummary);
  if (!h || !s) return false;
  const sourceHasConcern = /\b(concern|concerns|pushback|opposition|inconsistent|parking|snow|pedestrian|density)\b/u.test(s);
  const sourceHasSubdivision = /\b(subdivision|frontage|small lots|four lots|twenty third)\b/u.test(s);
  if (!sourceHasConcern || !sourceHasSubdivision) return false;
  return !/\b(subdivision|frontage|lots|parking|pedestrian|density|twenty|third|concerns)\b/u.test(h);
}

function sourceHasConcreteIssueTerms(sourceSummary = "") {
  const n = normalizeForMatch(sourceSummary);
  return /\b(subdivision|frontage|lots|housing|parking|snow|pedestrian|school|hazard|eighth|twenty|third|street|avenue|consent|wetlands|ravines|servicing|density|tax|fees|transit|hospital|zoning|bylaw|food|access)\b/u.test(n);
}

function extractTopNewsHeadings(mdText) {
  const lines = String(mdText || '').split(/\r?\n/u);
  const out = [];
  for (const line of lines) {
    const bullet = line.match(/^\s*-\s+\*\*(.+?)\*\*/u);
    const bold = line.match(/^\s*\*\*(.+?):\*\*/u);
    const heading = String((bullet?.[1] || bold?.[1] || '')).trim();
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

function buildRecapHookFromRankedItems(headings = [], sourceSummary = '', jurisdiction = '', body = '') {
  const candidates = (Array.isArray(headings) ? headings : [])
    .map((h) => deriveSubjectFromHeading(h) || h)
    .map((h) => sanitizeChapterStyleHook(h, { jurisdiction, body }))
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex((x) => normalizeForMatch(x) === normalizeForMatch(s)) === i);
  for (const candidate of candidates) {
    if (isKeywordHookReady(candidate, sourceSummary, 'recap') && !isGenericRecapHook(candidate)) return candidate;
  }
  return '';
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


function hookSourcePolarityUnsupported(hook, sourceSummary) {
  const hookNorm = normalizeForMatch(hook);
  const sourceNorm = normalizeForMatch(sourceSummary);
  if (!hookNorm || !sourceNorm) return false;

  const negativeServiceSignals = [
    'lack access', 'lacks access', 'no access', 'without access',
    'barrier', 'barriers', 'inaccessible', 'not accessible',
    'denied', 'denial', 'cannot', 'can not', 'unable', 'excluded', 'exclusion',
    'waited for taxi', 'could not get', 'couldnt get', "couldn't get",
  ];
  const positiveServiceVerbs = [
    'serve', 'serves', 'served', 'serving',
    'expand', 'expands', 'expanded', 'expanding',
    'enable', 'enables', 'enabled', 'enabling',
    'improve', 'improves', 'improved', 'improving',
    'increase', 'increases', 'increased', 'increasing',
    'boost', 'boosts', 'boosted', 'boosting',
  ];
  const explicitPositiveEvidence = [
    'approved expanded service', 'approve expanded service', 'approves expanded service',
    'service expansion approved', 'service expanded', 'service expansion',
    'new service approved', 'launches service', 'service launched',
    'added service', 'adds service', 'restored service',
  ];

  const hasNegativeContext = negativeServiceSignals.some((t) => sourceNorm.includes(t));
  if (!hasNegativeContext) return false;

  const hookUsesPositiveVerb = positiveServiceVerbs.some((t) => hookNorm.includes(t));
  if (!hookUsesPositiveVerb) return false;

  const sourceHasExplicitPositiveEvidence = explicitPositiveEvidence.some((t) => sourceNorm.includes(t));
  return !sourceHasExplicitPositiveEvidence;
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

function deriveRecapHookFromTopNewsText(summaryText = "", jurisdiction = "", body = "") {
  const s = normalizeForMatch(summaryText);
  if (/\bfive projects\b/.test(s) && /\blegislative verbal updates?\b/.test(s)) {
    return sanitizeChapterStyleHook("Projects Legislative Updates Roundtable", { jurisdiction, body });
  }
  if (/\bcorrespondence\b/.test(s) && /\bsix\b/.test(s) && /\bpublic letters?\b/.test(s)) {
    return sanitizeChapterStyleHook("Six Public Letters Reviewed", { jurisdiction, body });
  }
  if (/\bwheelchair\b/.test(s) && /\btaxi\b/.test(s) && /\bhospital\b/.test(s)) {
    return sanitizeChapterStyleHook("Wheelchair Taxi Access Gap", { jurisdiction, body });
  }
  if (/\bremove\b/.test(s) && /\bcounty\b/.test(s) && /\btransit\b/.test(s) && /\bfunder|funding\b/.test(s)) {
    return sanitizeChapterStyleHook("County Transit Funding Removed", { jurisdiction, body });
  }
  if (/\bhousing\b/.test(s) && /\bfood\b/.test(s) && /\bland trust\b/.test(s)) {
    return sanitizeChapterStyleHook("Housing Food Land Trust", { jurisdiction, body });
  }
  return "";
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
	    '- 4 to 6 words only.',
	    '- Title case.',
	    '- Lead with the most newsworthy or surprising concrete development.',
	    '- Use keyword-style noun phrases, like YouTube chapter headings, not sentence/prose wording.',
	    '- Include concrete source keywords: project type, street/location, dollar amount, policy, service, or affected thing.',
	    '- If using dollar amounts, write them as words or digits without punctuation.',
	    '- Never use a bare amount by itself; pair it with the exact source noun, such as Film Series Revenue or Studio Class Earnings.',
	    '- Prefer strong, high-signal wording over generic committee language.',
	    '- Concrete and specific, not clickbait.',
	    '- Faithful to SOURCE_SUMMARY only.',
    ...(isPreview
      ? ['- Prospective language only; this is an upcoming agenda.', '- Do not use completed outcome verbs (adopts/approves/passes/defeats/confirms/carries).', '- Prefer considers/reviews/discusses/hears/receives/debates.']
      : []),
    '- No punctuation except apostrophe if required.',
	    '- No date and no jurisdiction/body names in the hook.',
	    '- No speaker names, no filler, no sentence fragments.',
	    '- Do not write hooks like "A Representative Voices Concerns" or "Residents Raise Concerns"; name what the concern is about.',
	    '- Avoid bland joins like "and" unless absolutely necessary.',
	    '- Do not use contrast/preposition fragments like "despite safety", "amid concerns", or "over issues".',
	    '- Reuse concrete wording from SOURCE_SUMMARY instead of inventing labels.',
	    '- If SOURCE_SUMMARY says "servicing", use "servicing"; do not change it to water, sewer, hydro, or wastewater unless that exact utility appears.',
	    '- If SOURCE_SUMMARY contains subdivision/frontage/parking/pedestrian concerns, include one of those concrete issue terms in the hook.',
	    '- For subdivision concern stories, acceptable keyword shapes include "Reduced Frontage Subdivision Concerns" or "Twenty Third Parking Concerns".',
	    '- Do not end with a partial street phrase like "Twenty Third"; use the full street phrase or omit the street name.',
	    '- Do not repeat the same time span twice, such as Two-decade and Twenty Years in the same hook.',
	    '- Favor dense civic keywords over verbs like voices, discusses, considers, hears, or raises.',
	    '- Good shape: "<Specific Topic> <Specific Issue>", for example "Twenty Third Subdivision Concerns".',
	    '- Good revenue shape: "<Revenue Type> <Revenue Result>", for example "Film Series Revenue Surges".',
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
    '- Treat equivalent number words and digits as the same amount (for example "Five Hundred Thousand" equals "$500,000"); do not claim digits are missing when the amount is written in words.',
    '- Do not require currency symbols or comma-formatted numbers; hooks are punctuation-free keyword titles.',
    '- Penalize action verbs that overstate status (adopted/approved/passed) unless SOURCE_SUMMARY explicitly supports that action for the same subject.',
	    '- Penalize polarity flips: if SOURCE_SUMMARY says access barriers/denials/lack of access, do not reward positive-service wording (serves/expands/enables) unless explicit approved expansion evidence exists.',
    ...(isPreview
      ? ['- For preview mode, fail completed outcome verbs (adopts/approves/passes/defeats/confirms/carries).', '- Reward prospective framing (considers/reviews/discusses/hears/receives/debates).']
      : []),
	    '- Penalize vagueness if SOURCE_SUMMARY has concrete high-impact items.',
	    '- Fail prose hooks that say a representative/resident/public voices, raises, hears, discusses, considers, or expresses concerns without naming the concrete issue.',
	    '- Fail contrast/preposition fragments like "despite safety", "amid concerns", or "over issues"; hooks must read as a compact title, not a clipped sentence.',
	    '- Fail utility-specific hooks using water, sewer, hydro, or wastewater unless SOURCE_SUMMARY uses that same utility word.',
	    '- If SOURCE_SUMMARY has subdivision/frontage/parking/pedestrian concerns, fail hooks that omit those concrete issue terms.',
	    '- Do not require every issue from SOURCE_SUMMARY; one concrete issue or one concrete location plus issue is enough for a 4-6 word hook.',
	    '- Do not require exact dollar amounts when the hook names the same concrete revenue, budget, cost, project, service, or policy issue accurately.',
	    '- Treat a named revenue stream, budget item, cost, project, service, or program as concrete context; do not require a separate location or policy term.',
	    '- Do not penalize omission of secondary details when the hook names a concrete source issue accurately.',
	    '- Fail hooks that end with a partial street phrase such as "Twenty Third" without Street, Avenue, Road, or West.',
	    '- Fail hooks that repeat the same time span twice, such as Two-decade and Twenty Years in the same hook.',
	    '- Reward keyword hooks that include source terms such as street names, project types, costs, policy names, services, land uses, or affected infrastructure.',
	    '- Penalize hooks that are not YouTube chapter style: 4-6 words, title case, and no jurisdiction/body names.',
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

function buildYouTubeChapterHookPrompt({ currentSection = "" }) {
  const section = String(currentSection || "").replace(/\s+/gu, " ").trim();
  return [
    "Create one concise YouTube chapter heading for this transcript section.",
    "Return only the heading text.",
    "Requirements: 3 to 4 words, title case, specific topic, no quotes, no speaker names, no filler, no sentence fragments.",
    "Use only the CURRENT_SECTION to choose the heading topic.",
    "Do not describe previous or next sections.",
    `CURRENT_SECTION: ${section || "EMPTY"}`,
  ].join("\n");
}

async function generateYouTubeStyleHookFromSource({ sourceSummary = "" }) {
  const systemPrompt = "You create compact YouTube chapter headings from transcript excerpts. Respond with one heading only. Do not explain. think false.";
  let feedback = "";
  let best = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = feedback
      ? `${buildYouTubeChapterHookPrompt({ currentSection: sourceSummary })}\n\nREVISION_FEEDBACK:\n${feedback}`
      : buildYouTubeChapterHookPrompt({ currentSection: sourceSummary });
    const raw = await ask([
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ], { numPredict: 48 });
    const hook = sanitizeHook(raw);
    if (hook) best = hook;
    if (best && !isGenericPreviewHook(best) && !isWeakPreviewHook(best)) return best;
    feedback = "Make it more specific and topic-grounded; avoid generic wording.";
  }
  return best;
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

async function generateHook({ sourceSummary, verifierSourceText, topNewsHeadings, focus, jurisdiction, body, hookMode }) {
  if (hookMode === "preview") {
    const ytStyle = await generateYouTubeStyleHookFromSource({ sourceSummary });
    if (ytStyle && isKeywordHookReady(ytStyle, sourceSummary, hookMode)) {
      const cleaned = sanitizeChapterStyleHook(ytStyle, { jurisdiction, body });
      return {
        hook: cleaned,
        score: 1,
        verifier_feedback: "Hook sourced from YouTube chapter-style prompt on current section.",
        fallback_used: false,
      };
    }
  }
  if (hookMode !== 'preview') {
    const leadFromText = deriveRecapHookFromTopNewsText(sourceSummary, jurisdiction, body);
    if (leadFromText && isKeywordHookReady(leadFromText, sourceSummary, hookMode) && !isRedundantDurationHook(leadFromText)) {
      return {
        hook: leadFromText,
        score: 1,
        verifier_feedback: 'Hook sourced directly from Top Newsworthy Developments text.',
        fallback_used: false,
      };
    }
  }
  const verifierSource = String(verifierSourceText || sourceSummary || '');
  const generationSource = hookMode === 'preview'
    ? sourceSummary
    : selectHookGenerationSource(sourceSummary);
  let feedback = '';
  let bestHook = '';
  let bestScore = -1;
  let bestReview = '';

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const draftRaw = await ask([
      { role: 'system', content: 'You are a precise civic headline hook writer.' },
      { role: 'user', content: buildHookPrompt({ sourceSummary: generationSource, focus, jurisdiction, body, feedback, hookMode }) },
    ], { numPredict: 64 });

    const draftBase = hookMode === 'preview'
      ? enforcePreviewVerbTense(sanitizeHook(draftRaw))
      : sanitizeHook(draftRaw);
    const draft = sanitizeChapterStyleHook(draftBase, { jurisdiction, body });

	    let review = '';
	    let score = 0;
	    if (hookMode === 'preview' && containsPreviewBannedVerb(draft)) {
	      review = 'Hook uses completed-outcome verbs disallowed for upcoming agenda previews.\n0';
	      score = 0;
	    } else if (hookMode !== 'preview' && isProseSpeakerHook(draft) && sourceHasConcreteIssueTerms(sourceSummary)) {
	      review = 'Hook is prose about who spoke instead of keyword-style topic terms; name the concrete issue from the source.\n0';
	      score = 0;
	    } else if (isClippedContrastHook(draft)) {
	      review = 'Hook uses a clipped contrast fragment; rewrite as a compact keyword title with concrete source nouns.\n0';
	      score = 0;
	    } else if (isPartialStreetHook(draft)) {
	      review = 'Hook ends with a partial street phrase; use the full street phrase or replace it with issue keywords.\n0';
	      score = 0;
	    } else if (isRedundantDurationHook(draft)) {
	      review = 'Hook repeats the same time span twice; keep either Two-decade or Twenty Years, not both.\n0';
	      score = 0;
	    } else if (hookInventsUtilitySpecificity(draft, verifierSource)) {
	      review = 'Hook invents a specific utility word not present in source; reuse source wording such as servicing instead.\n0';
	      score = 0;
	    } else if (hookMissesConcernTopic(draft, sourceSummary)) {
	      review = 'Hook misses the concrete subdivision/frontage concern topic in the source; revise with exact issue keywords such as Subdivision, Frontage, Parking, Pedestrian, Density, Lots, or Twenty Third.\n0';
	      score = 0;
	    } else if (hookDecisionClaimUnsupported(draft, verifierSource)) {
	      review = 'Hook uses an unsupported decision verb (adopted/approved/passed) for the same subject.\n0';
	      score = 0;
    } else if (hookSourcePolarityUnsupported(draft, verifierSource)) {
      review = 'Hook flips source polarity (barrier/denial context recast as positive service expansion).\n0';
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
    if (score >= PASS_THRESHOLD && isKeywordHookReady(draft, sourceSummary, hookMode)) break;
  }

	  let safeHook = bestHook || '';
	  let fallbackReason = '';
	  if (hookMode !== 'preview' && bestScore < PASS_THRESHOLD) {
	    const rankedLead = buildRecapHookFromRankedItems(topNewsHeadings, sourceSummary, jurisdiction, body);
	    const textLead = deriveRecapHookFromTopNewsText(sourceSummary, jurisdiction, body);
	    safeHook = rankedLead || textLead || fallbackHookFromSummary(sourceSummary);
	    fallbackReason = `quality threshold fallback from source heading; rejected hook=${JSON.stringify(bestHook || '')} score=${Number(bestScore || 0).toFixed(3)} feedback=${String(bestReview || '').replace(/\s+/gu, ' ').trim()}`;
	  }
	  if (!safeHook) {
	    safeHook = buildRecapHookFromRankedItems(topNewsHeadings, sourceSummary, jurisdiction, body)
	      || fallbackHookFromSummary(sourceSummary);
	    fallbackReason = fallbackReason || 'empty hook fallback from source heading';
	  }
  safeHook = sanitizeChapterStyleHook(safeHook, { jurisdiction, body });
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
    safeHook = enforcePreviewTemporalStyle(safeHook);
    if (isWeakPreviewHook(safeHook)) {
      const fromTop = buildPreviewHookFromRankedItems(topNewsHeadings);
      if (fromTop) safeHook = sanitizeFinalPreviewHook(fromTop) || fromTop;
    }
    if (isWeakPreviewHook(safeHook)) {
      const fromSummary = derivePreviewHookFromTopNewsText(sourceSummary, jurisdiction, body);
      if (fromSummary) safeHook = fromSummary;
    }
    safeHook = sanitizeChapterStyleHook(safeHook, { jurisdiction, body });
  }
  if (hookMode !== 'preview' && isGenericRecapHook(safeHook)) {
    const recapLead = deriveRecapHookFromTopNewsText(sourceSummary, jurisdiction, body);
    if (recapLead && !isGenericRecapHook(recapLead)) safeHook = recapLead;
    else {
      const rankedLead = sanitizeChapterStyleHook(String(topNewsHeadings?.[0] || ""), { jurisdiction, body });
      if (rankedLead && !isGenericRecapHook(rankedLead)) safeHook = rankedLead;
    }
  }
  if (!isKeywordHookReady(safeHook, sourceSummary, hookMode)) {
    const rankedLead = hookMode === 'preview'
      ? buildPreviewHookFromRankedItems(topNewsHeadings)
      : buildRecapHookFromRankedItems(topNewsHeadings, sourceSummary, jurisdiction, body);
    if (rankedLead && isKeywordHookReady(rankedLead, sourceSummary, hookMode)) {
      safeHook = sanitizeChapterStyleHook(rankedLead, { jurisdiction, body });
      fallbackReason = fallbackReason || `keyword quality gate fallback from source heading; rejected hook=${JSON.stringify(bestHook || '')}`;
    } else {
      throw new Error(`meeting-hook failed keyword quality gate hook=${JSON.stringify(safeHook)} mode=${hookMode}`);
    }
  }

  return {
    hook: safeHook,
    score: Number(Math.max(0, bestScore).toFixed(3)),
    verifier_feedback: fallbackReason || bestReview,
    fallback_used: Boolean(fallbackReason) || bestScore < PASS_THRESHOLD,
  };
}

function extractMarkdownSection(mdText, headingText) {
  const lines = String(mdText || '').split(/\r?\n/u);
  const target = String(headingText || '').trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^#{1,2}\s+(.+?)\s*$/u);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/u.test(lines[i])) {
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
  const wholeMeetingMd = extractMarkdownSection(meetingSummaryMd, 'Whole Meeting Summary');
  const topNewsHeadings = extractTopNewsHeadings(topNewsworthyMd);
  const sourceSummary = stripMarkdown(String(topNewsworthyMd || '')).slice(0, 32000);
  if (!sourceSummary) throw new Error(`Top Newsworthy Developments is empty: ${summaryPath}`);
  const plainPath = path.join(transcriptDir, `${resolvedPrefix}.plain.txt`);
  const transcriptEvidence = fs.existsSync(plainPath) ? fs.readFileSync(plainPath, 'utf8').slice(0, 80000) : '';
  const verifierSourceText = [sourceSummary, transcriptEvidence].filter(Boolean).join('\n\n');

  const outTxt = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.txt`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.meeting-hook.json`);

  process.stdout.write(`[meeting-hook] source: ${summaryPath}\n`);
  process.stdout.write(`[llm] ollama host: ${RESOLVED_OLLAMA_HOST}\n`);
  process.stdout.write(`[meeting-hook] output txt: ${outTxt}\n`);

  const out = await generateHook({
    sourceSummary,
    verifierSourceText,
    topNewsHeadings,
    focus: focusArg,
    jurisdiction: jurisdictionArg,
    body: bodyArg,
    hookMode,
  });

  fs.writeFileSync(outTxt, `${out.hook}\n`, 'utf8');
  fs.writeFileSync(outJson, JSON.stringify({
    source_meeting_summary: summaryPath,
    source_scope: topNewsworthyMd && wholeMeetingMd
      ? 'top_newsworthy_plus_whole_meeting_summary'
      : (topNewsworthyMd ? 'top_newsworthy_developments' : 'whole_meeting_summary'),
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

export {
  hasConcreteKeywordOverlap,
  hookDecisionClaimUnsupported,
  hookSourcePolarityUnsupported,
  isKeywordHookReady,
};

function isCliEntry() {
  const argvPath = String(process.argv[1] || '').trim();
  if (!argvPath) return false;
  try {
    const a = fs.realpathSync(argvPath);
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return a === b;
  } catch {
    return path.resolve(argvPath) === path.resolve(fileURLToPath(import.meta.url));
  }
}
const IS_CLI_ENTRY = isCliEntry();
if (IS_CLI_ENTRY) {
  main().catch((err) => {
    process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
    process.exit(1);
  });
}
