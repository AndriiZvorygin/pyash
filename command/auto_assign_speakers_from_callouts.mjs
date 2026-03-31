#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';
const DEFAULT_VOICES = path.join(ROOT, 'world/voices');
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, '')
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, '')}/api/chat`
  : 'http://localhost:11434/api/chat';
const VERIFY_MODEL = process.env.AUTOASSIGN_VERIFY_MODEL
  || process.env.SPEAKER_VERIFY_MODEL
  || process.env.MEETING_SUMMARY_MODEL
  || process.env.SUMMARY_MODEL
  || process.env.OWEN_SUMMARY_MODEL
  || 'qwen3.5:9b';
const VERIFY_ENABLED = !/^(0|false|no)$/iu.test(String(process.env.PYA_AUTOASSIGN_VERIFY || '1'));
const VERIFY_CONTEXT_RADIUS = (() => {
  const raw = Number(process.env.PYA_AUTOASSIGN_VERIFY_CONTEXT_RADIUS || 4);
  return Number.isFinite(raw) && raw >= 1 && raw <= 12 ? Math.floor(raw) : 4;
})();
const VERIFY_MIN_CONFIDENCE = (() => {
  const raw = Number(process.env.PYA_AUTOASSIGN_VERIFY_MIN_CONFIDENCE || 0.67);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.67;
})();

function usage() {
  return [
    'Usage: node command/auto_assign_speakers_from_callouts.mjs <transcript_dir> [prefix] <roster_file> [voices_dir]',
    'Example: node command/auto_assign_speakers_from_callouts.mjs artifacts/.../transcript meeting-qwen-auto-normalized.sentences artifacts/<jurisdiction>/roster.txt world/voices',
  ].join('\n');
}

function ensureDir(dirPath, label) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

function resolvePathFromRoot(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(ROOT, inputPath);
}

function normalizeToken(text) {
  return String(text || '').toLowerCase().replace(/[^a-z]/gu, '');
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containsDisallowedNameWord(words) {
  const bannedWords = new Set([
    'through', 'chair', 'mr', 'mrs', 'ms', 'miss', 'councillor', 'councilor', 'mayor', 'deputy',
    'committee', 'council', 'city', 'project', 'item', 'report',
    'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'avenue', 'street', 'road', 'west', 'east', 'north', 'south',
    'yes', 'yeah', 'yep', 'no', 'okay', 'ok', 'thanks', 'thank', 'hello', 'hi', 'good', 'great', 'perfect', 'welcome',
    'understood', 'sorry', 'about', 'that', 'question', 'questions', 'staff', 'only', 'just', 'background',
  ]);
  return words.some((w) => bannedWords.has(String(w || '').replace(/\./gu, '').toLowerCase()));
}

function isUnknownSpeakerRow(row) {
  const key = String(row?.speaker_key || '');
  if (!/^speaker_\d+$/iu.test(key)) return false;
  const display = String(row?.display || '').trim();
  if (!display) return true;
  if (/^SPEAKER_\d+$/iu.test(display)) return true;
  if (/^speaker_\d+$/iu.test(display)) return true;
  return false;
}

function personFromFullName(fullName) {
  const full = String(fullName || '').trim().replace(/\s+/gu, ' ');
  const words = full.split(/\s+/u).filter(Boolean);
  if (words.length < 2 || words.length > 3) return null;
  if (!words.every((w) => /^[A-Z][A-Za-z'\-.]+$/u.test(w))) return null;
  if (containsDisallowedNameWord(words)) return null;
  return {
    full,
    slug: slugName(full),
    first: normalizeToken(words[0]),
    last: normalizeToken(words.at(-1)),
  };
}

function personFromSingleName(rawName) {
  let name = titleCaseName(rawName);
  if (!name) return null;
  // Common ASR adverb bleed in handoffs, e.g. "Frankly" for "Frank".
  if (/^[A-Z][A-Za-z]{5,}ly$/u.test(name)) {
    name = name.slice(0, -2);
  }
  if (!/^[A-Z][A-Za-z'\-.]+$/u.test(name)) return null;
  if (containsDisallowedNameWord([name])) return null;
  const token = normalizeToken(name);
  if (!token) return null;
  return {
    full: name,
    slug: slugName(name),
    first: token,
    last: token,
  };
}

function slugName(fullName) {
  return String(fullName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

function parseRoster(rosterText) {
  const people = [];
  const lines = String(rosterText || '').split(/\r?\n/u);
  for (const line of lines) {
    const m = line.match(/^\s*-\s+([^|\n]+?)\s*\|/u);
    if (!m) continue;
    const full = String(m[1] || '').trim();
    if (!full) continue;
    const person = personFromFullName(full);
    if (!person) continue;
    people.push(person);
  }
  return people;
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const n = s.length;
  const m = t.length;
  if (!n) return m;
  if (!m) return n;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[n][m];
}

function bestRosterByLastName(rawLast, roster) {
  const q = normalizeToken(rawLast);
  if (!q) return null;
  let best = null;
  for (const p of roster) {
    const d = levenshtein(q, p.last);
    const max = Math.max(1, p.last.length);
    const rel = d / max;
    if (!best || d < best.d || (d === best.d && rel < best.rel)) {
      best = { person: p, d, rel };
    }
  }
  if (!best) return null;
  if (best.d === 0) return best.person;
  if (q.length >= 6 && best.d <= 2) return best.person;
  if (q.length >= 4 && best.d <= 1) return best.person;
  return null;
}

function bestRosterByFirstName(rawFirst, roster) {
  const q = normalizeToken(rawFirst);
  if (!q) return null;
  const exact = roster.filter((p) => p.first === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // ambiguous

  let best = null;
  for (const p of roster) {
    const d = levenshtein(q, p.first);
    const max = Math.max(1, p.first.length);
    const rel = d / max;
    if (!best || d < best.d || (d === best.d && rel < best.rel)) {
      best = { person: p, d, rel };
    }
  }
  if (!best) return null;
  if (q.length >= 6 && best.d <= 1) return best.person;
  return null;
}

function bestRosterByFullName(rawFull, roster) {
  const text = String(rawFull || '').trim().replace(/\s+/gu, ' ');
  const parts = text.split(/\s+/u).filter(Boolean);
  if (parts.length < 2) return null;
  const qFirst = normalizeToken(parts[0]);
  const qLast = normalizeToken(parts.at(-1));
  if (!qFirst || !qLast) return null;

  let best = null;
  let second = null;
  for (const p of roster) {
    const dFirst = levenshtein(qFirst, p.first);
    const dLast = levenshtein(qLast, p.last);
    const firstOk = dFirst <= (qFirst.length >= 6 ? 1 : 0);
    const lastOk = dLast <= (qLast.length >= 6 ? 2 : 1);
    if (!firstOk || !lastOk) continue;
    const score = (dLast * 2) + dFirst;
    const cand = { person: p, score };
    if (!best || score < best.score) {
      second = best;
      best = cand;
    } else if (!second || score < second.score) {
      second = cand;
    }
  }
  if (!best) return null;
  if (second && second.score === best.score) return null;
  return best.person;
}

function titleCaseName(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((w) => String(w).replace(/^[^A-Za-z]+|[^A-Za-z]+$/gu, ''))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function findNextUnknownSpeakerKey(rows, curIndex, maxLookahead = 6) {
  const curKey = String(rows[curIndex]?.speaker_key || '');
  const end = Math.min(rows.length - 1, curIndex + Math.max(1, maxLookahead));
  for (let j = curIndex + 1; j <= end; j += 1) {
    const k = String(rows[j]?.speaker_key || '');
    if (!isUnknownSpeakerRow(rows[j])) continue;
    if (k === curKey) continue;
    return k;
  }
  return '';
}

function pickDiarizationJson(transcriptDir, prefix = 'auto') {
  if (prefix && prefix !== 'auto') {
    const exact = path.join(transcriptDir, `${prefix}.speaker.sentences.json`);
    if (fs.existsSync(exact)) return { file: exact, resolvedPrefix: prefix };
  }
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.speaker.sentences.json'));
  if (!files.length) throw new Error(`no *.speaker.sentences.json found in ${transcriptDir}`);
  const ranked = files.map((name) => {
    const p = path.join(transcriptDir, name);
    const st = fs.statSync(p);
    let score = 0;
    if (name.toLowerCase().includes('.normalized.')) score += 40;
    if (name.startsWith('meeting-qwen-auto')) score += 10;
    return { name, p, score, mtime: Number(st.mtimeMs || 0) };
  }).sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.name.localeCompare(b.name));
  const chosen = ranked[0];
  return { file: chosen.p, resolvedPrefix: chosen.name.replace(/\.speaker\.sentences\.json$/u, '') };
}

function pickAgendaMatchesJson(transcriptDir, prefix = 'auto') {
  if (prefix && prefix !== 'auto') {
    const exact = path.join(transcriptDir, `${prefix.replace(/\.sentences$/u, '')}.agenda.matches.json`);
    if (fs.existsSync(exact)) return exact;
  }
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.agenda.matches.json'));
  if (!files.length) return '';
  const ranked = files.map((name) => {
    const p = path.join(transcriptDir, name);
    const st = fs.statSync(p);
    let score = 0;
    if (name.toLowerCase().includes('.normalized.')) score += 30;
    if (name.startsWith('meeting-qwen-auto')) score += 10;
    return { p, score, mtime: Number(st.mtimeMs || 0), name };
  }).sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.name.localeCompare(b.name));
  return ranked[0].p;
}

function findRowIndexBySnippet(rows, snippet) {
  const needle = normalizeText(String(snippet || '').slice(0, 180));
  if (!needle) return -1;
  const shortNeedle = needle.slice(0, Math.min(80, needle.length));
  if (!shortNeedle) return -1;
  for (let i = 0; i < rows.length; i += 1) {
    const line = normalizeText(rows[i]?.text || '');
    if (line && line.includes(shortNeedle)) return i;
  }
  return -1;
}

function buildSectionRangesFromAgendaMatches(rows, agendaMatchesObj) {
  const matches = Array.isArray(agendaMatchesObj?.matches) ? agendaMatchesObj.matches : [];
  if (!rows.length || !matches.length) return [];
  const starts = [];
  for (const m of matches) {
    const idx = findRowIndexBySnippet(rows, m?.snippet || '');
    if (idx < 0) continue;
    starts.push({
      item: String(m?.item || '').trim(),
      title: String(m?.title || '').trim(),
      rowIndex: idx,
    });
  }
  if (!starts.length) return [];
  starts.sort((a, b) => a.rowIndex - b.rowIndex);

  const out = [];
  for (let i = 0; i < starts.length; i += 1) {
    const s = starts[i];
    const e = i + 1 < starts.length ? Math.max(s.rowIndex, starts[i + 1].rowIndex - 1) : rows.length - 1;
    out.push({
      item: s.item,
      title: s.title,
      startRow: s.rowIndex,
      endRow: e,
    });
  }
  return out;
}

function extractNamesFromSectionTitle(title, roster) {
  const out = [];
  const titleRaw = String(title || '').trim();
  const titleNorm = normalizeText(titleRaw);
  if (!titleNorm) return out;

  // 1) Match known roster names using normalized full-name containment.
  for (const p of roster) {
    const fullNorm = normalizeText(p.full);
    if (fullNorm && titleNorm.includes(fullNorm)) out.push(p);
  }

  // 2) Parse presenter segment from agenda title text and resolve to roster.
  const presenterSegRe = /\b(?:deputation|presentation)\s+from\s+(.+?)(?:\s+re:|$)/iu;
  const seg = titleRaw.match(presenterSegRe)?.[1] || '';
  if (seg) {
    const parts = seg
      .split(/\s+(?:and|&)\s+/iu)
      .map((x) => x.split(',')[0]?.trim() || '')
      .filter(Boolean);
    for (const part of parts) {
      const full = part.match(/([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,3})/u)?.[1] || '';
      if (!full) continue;
      const rosterHit = bestRosterByFullName(full, roster)
        || bestRosterByLastName(full.split(/\s+/u).at(-1), roster)
        || bestRosterByFirstName(full.split(/\s+/u)[0], roster);
      out.push(rosterHit || personFromFullName(full));
    }
  }

  // Dedup by slug
  const by = new Map();
  for (const p of out) {
    if (!p?.slug) continue;
    by.set(p.slug, p);
  }
  return [...by.values()];
}

function ensureSpeakerMetaFile(voicesDir, speakerKey) {
  const filePath = path.join(voicesDir, `${speakerKey}.pya`);
  if (fs.existsSync(filePath)) return filePath;
  fs.mkdirSync(voicesDir, { recursive: true });
  const content = [
    `su name key ob text "${speakerKey}" ya`,
    `su name name ob text "${speakerKey}" ya`,
  ].join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function setSpeakerMetaName(metaPath, newSlug) {
  const src = fs.readFileSync(metaPath, 'utf8');
  const line = `su name name ob text "${newSlug}" ya`;
  if (/^\s*su name name ob text ".*" ya\s*$/mu.test(src)) {
    const out = src.replace(/^\s*su name name ob text ".*" ya\s*$/mu, line);
    fs.writeFileSync(metaPath, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
    return;
  }
  const out = `${src.trimEnd()}\n${line}\n`;
  fs.writeFileSync(metaPath, out, 'utf8');
}

function readSpeakerMetaName(metaPath) {
  if (!fs.existsSync(metaPath)) return '';
  const src = fs.readFileSync(metaPath, 'utf8');
  const m = src.match(/^\s*su name name ob text "(.*)" ya\s*$/mu);
  return String(m?.[1] || '').trim();
}

function isStableSpeakerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (/^speaker_\d+$/iu.test(raw)) return false;
  return true;
}

function gatherEvidence(rows, roster) {
  const byTarget = new Map();
  const titleNameRe = /\b(?:councillor|mayor|deputy\s+mayor|mr\.?|ms\.?|miss)\s+([A-Za-z'\-\.]+)/giu;
  const calloutCueRe = /\b(go to|you'?re on|next|over to|go ahead|i'?ll ask|can you|call on|the floor is|thank you|welcome)\b/iu;
  const bareNameCalloutRe = /^\s*(?:go ahead,\s*)?([A-Z][A-Za-z'\-.]+)\s*[?.!,:;]?\s*$/u;
  const nameBeforeGoAheadRe = /^\s*([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){0,2})\s*,\s*go ahead\b/iu;

  function add(target, person, why, atindex, text, weight = 1) {
    if (!byTarget.has(target)) byTarget.set(target, new Map());
    const inner = byTarget.get(target);
    const prev = inner.get(person.slug) || { person, count: 0, examples: [], byKind: { callout: 0, selfIntro: 0, section: 0 } };
    const w = Math.max(1, Number(weight) || 1);
    prev.count += w;
    prev.byKind.callout = Number(prev.byKind.callout || 0) + w;
    if (prev.examples.length < 3) prev.examples.push({ why, atindex, text: String(text || '').slice(0, 180) });
    inner.set(person.slug, prev);
  }

  // High-confidence direct handoff: "Go ahead, Franklin." then unknown speaker starts.
  const directHandoffRe = /\bgo ahead,\s*([A-Z][A-Za-z'\-.]+)\b/iu;
  const openingRe = /^(?:through you|thank you|good (?:morning|afternoon|evening)|mr\.? chair|madam chair)\b/iu;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const nxt = rows[i + 1];
    if (isUnknownSpeakerRow(cur)) continue;
    if (!isUnknownSpeakerRow(nxt)) continue;
    if (String(cur?.speaker_key || '') === String(nxt?.speaker_key || '')) continue;
    const text = String(cur?.text || '').trim();
    const m = text.match(directHandoffRe);
    if (!m?.[1]) continue;
    const nextText = String(nxt?.text || '').trim();
    if (!openingRe.test(nextText)) continue;
    const person = bestRosterByFirstName(m[1], roster)
      || bestRosterByLastName(m[1], roster);
    if (!person) continue;
    add(String(nxt?.speaker_key || ''), person, 'direct-go-ahead-handoff', i + 1, text, 3);
  }

  // Bare one-name handoff/question, e.g. "Phil?" or "Monica.", followed immediately by unknown speaker.
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const nxt = rows[i + 1];
    if (!isUnknownSpeakerRow(nxt)) continue;
    if (String(cur?.speaker_key || '') === String(nxt?.speaker_key || '')) continue;
    const text = String(cur?.text || '').trim();
    if (!text || text.length > 32) continue;
    const m = text.match(bareNameCalloutRe);
    if (!m?.[1]) continue;
    let person = null;
    const prevText = i > 0 ? String(rows[i - 1]?.text || '').trim() : '';
    const prevSpeaker = i > 0 ? String(rows[i - 1]?.speaker_key || '') : '';
    if (prevText && prevSpeaker && prevSpeaker === String(cur?.speaker_key || '')) {
      const fullNear = prevText.match(/([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,2})/u)?.[1] || '';
      if (fullNear) {
        const nearLast = normalizeToken(fullNear.split(/\s+/u).at(-1));
        const callLast = normalizeToken(m[1]);
        if (nearLast && callLast && nearLast === callLast) {
          person = bestRosterByFullName(fullNear, roster) || personFromFullName(fullNear);
        }
      }
    }
    if (!person) {
      person = bestRosterByFirstName(m[1], roster)
        || bestRosterByLastName(m[1], roster)
        || personFromSingleName(m[1]);
    }
    if (!person) continue;
    add(String(nxt?.speaker_key || ''), person, 'bare-name-handoff', i + 1, text, 3);
  }

  // Name before go-ahead handoff, e.g. "Morgan, go ahead." or "Travis Morgan, go ahead."
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const nxt = rows[i + 1];
    if (!isUnknownSpeakerRow(nxt)) continue;
    if (String(cur?.speaker_key || '') === String(nxt?.speaker_key || '')) continue;
    const text = String(cur?.text || '').trim();
    if (!text) continue;
    const m = text.match(nameBeforeGoAheadRe);
    if (!m?.[1]) continue;
    const name = String(m[1] || '').trim();
    const person = bestRosterByFullName(name, roster)
      || bestRosterByLastName(name.split(/\s+/u).at(-1), roster)
      || bestRosterByFirstName(name.split(/\s+/u)[0], roster)
      || personFromFullName(name)
      || personFromSingleName(name);
    if (!person) continue;
    add(String(nxt?.speaker_key || ''), person, 'name-before-go-ahead', i + 1, text, 4);
  }

  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const nxt = rows[i + 1];
    const target = String(nxt?.speaker_key || '');
    if (!isUnknownSpeakerRow(nxt)) continue;
    if (String(cur?.speaker_key || '') === target) continue;

    const text = String(cur?.text || '').trim();
    if (!text) continue;

    let anyTitleName = false;
    const titleHits = [];
    let m;
    while ((m = titleNameRe.exec(text))) {
      anyTitleName = true;
      titleHits.push(String(m[1] || '').trim());
    }
    if (!anyTitleName) continue;

    // Require clear handoff cue unless this is a short direct call line.
    const shortDirect = text.length <= 48;
    if (!shortDirect && !calloutCueRe.test(text)) continue;

    for (const rawLast of titleHits) {
      const person = bestRosterByLastName(rawLast, roster);
      if (!person) continue;
      add(target, person, 'title-callout', i + 1, text);
    }
  }

  // First-name handoff callouts with short lookahead, e.g. "over to Mason", "hand it over to Chris".
  const firstNameHandoffRe = /\b(?:go to|over to|hand (?:it )?over to|go ahead(?:,\s*)?|next(?: up)?(?:,\s*)?|i(?:'| a)m going to)\s+([A-Z][A-Za-z'\-.]+)\b|\b(?:we\s+)?welcome\s+([A-Z][A-Za-z'\-.]+)(?:\s+to\b|[?.!,:;]|$)/giu;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const text = String(cur?.text || '').trim();
    if (!text) continue;
    if (!calloutCueRe.test(text)) continue;

    const hits = [];
    let m;
    while ((m = firstNameHandoffRe.exec(text))) {
      const hit = String(m[1] || m[2] || '').trim();
      if (hit) hits.push(hit);
    }
    if (!hits.length) continue;

    const target = findNextUnknownSpeakerKey(rows, i, 7);
    if (!target) continue;

    for (const rawFirst of hits) {
      const person = bestRosterByFirstName(rawFirst, roster)
        || bestRosterByLastName(rawFirst, roster);
      if (!person) continue;
      add(target, person, 'first-name-handoff', i + 1, text);
    }
  }

  // Explicit full-name handoff with lookahead, e.g. "we have Chris Wilson ...", then later "hand it over to Chris".
  const explicitNameRe = /\b(?:we have|hand (?:it )?over to|presentation from|go to)\s+([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,2})\b/iu;
  const explicitAgendaIntroRe = /\b(?:at\s+number\s+[a-z0-9.]+\s*,\s*)?(?:next(?:\s+at\s+[a-z0-9.]+)?\s*,\s*)?we\s+have\s+(?:a\s+)?(?:deputation|presentation)\s+from\s+([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,3})\b/iu;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const text = String(cur?.text || '').trim();
    if (!text) continue;
    const ex = text.match(explicitAgendaIntroRe) || text.match(explicitNameRe);
    if (!ex?.[1]) continue;
    const person = bestRosterByFullName(ex[1], roster)
      || personFromFullName(ex[1]);
    if (!person) continue;
    const target = findNextUnknownSpeakerKey(rows, i, 10);
    if (!target) continue;
    if (String(cur?.speaker_key || '') === target) continue;
    add(target, person, 'explicit-full-name-handoff', i + 1, text);
  }

  // Direct full-name callouts, e.g. "There we are, Christopher Stevens."
  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    const nxt = rows[i + 1];
    const target = String(nxt?.speaker_key || '');
    if (!isUnknownSpeakerRow(nxt)) continue;
    if (String(cur?.speaker_key || '') === target) continue;
    const text = String(cur?.text || '').trim();
    if (!text) continue;

    const shortDirect = text.length <= 96;
    if (!shortDirect && !calloutCueRe.test(text)) continue;
    const textNorm = normalizeText(text);
    if (!textNorm) continue;

    for (const p of roster) {
      const fullNorm = normalizeText(p.full);
      if (fullNorm && textNorm.includes(fullNorm)) {
        add(target, p, 'full-name-callout', i + 1, text);
      }
    }

  }

  return byTarget;
}

function gatherSelfIntroEvidence(rows, roster, byTarget) {
  const introRe = /\b(?:my name is|my name['’]s)\s+([A-Za-z][A-Za-z'\-.]+(?:\s+[A-Za-z][A-Za-z'\-.]+){0,2})(?=[,.;:!?]|$)/iu;
  const introImRe = /\b(?:i am|i['’]m)\s+([A-Za-z][A-Za-z'\-.]+(?:\s+[A-Za-z][A-Za-z'\-.]+){0,2})(?=[,.;:!?]|$)/iu;

  function add(target, person, why, atindex, text) {
    if (!byTarget.has(target)) byTarget.set(target, new Map());
    const inner = byTarget.get(target);
    const prev = inner.get(person.slug) || { person, count: 0, examples: [], byKind: { callout: 0, selfIntro: 0, section: 0 } };
    prev.count += 3; // stronger than callout
    prev.byKind.selfIntro = Number(prev.byKind.selfIntro || 0) + 3;
    if (prev.examples.length < 3) prev.examples.push({ why, atindex, text: String(text || '').slice(0, 180) });
    inner.set(person.slug, prev);
  }

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const key = String(r?.speaker_key || '');
    if (!isUnknownSpeakerRow(r)) continue;
    const text = String(r?.text || '');
    const m = text.match(introRe);
    const im = text.match(introImRe);
    const introNameRaw = (m?.[1] || im?.[1] || '').trim();
    if (introNameRaw) {
      const introName = String(introNameRaw).trim();
      const exactFull = normalizeText(introName);
      let person = null;
      for (const p of roster) {
        if (normalizeText(p.full) === exactFull) {
          person = p;
          break;
        }
      }
      if (!person) person = bestRosterByFullName(introName, roster);
      if (!person) {
        const parts = introName.split(/\s+/u).filter(Boolean);
        if (parts.length === 1) {
          person = bestRosterByFirstName(parts[0], roster)
            || bestRosterByLastName(parts[0], roster);
        } else if (parts.length > 1) {
          person = bestRosterByFirstName(parts[0], roster)
            || bestRosterByLastName(parts.at(-1), roster);
        }
      }
      if (!person) person = personFromFullName(titleCaseName(introName));
      if (!person) person = personFromSingleName(introName);
      if (person) add(key, person, m ? 'self-intro' : 'self-intro-im', i + 1, text);
    }

    // Bare role intro format: "First Last, Role title." (roster-only to avoid false positives)
    if (!m && !im) {
      const roleIntro = text.match(/^([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,2})\s*,\s*[A-Za-z]/u);
      const person = roleIntro?.[1] ? bestRosterByFullName(roleIntro[1], roster) : null;
      if (person) add(key, person, 'role-intro', i + 1, text);
    }
  }
}

function gatherAgendaSectionEvidence(rows, roster, sectionRanges, byTarget) {
  function add(target, person, why, atindex, text, weight = 1) {
    if (!byTarget.has(target)) byTarget.set(target, new Map());
    const inner = byTarget.get(target);
    const prev = inner.get(person.slug) || { person, count: 0, examples: [], byKind: { callout: 0, selfIntro: 0, section: 0 } };
    const w = Math.max(1, Number(weight) || 1);
    prev.count += w;
    prev.byKind.section = Number(prev.byKind.section || 0) + w;
    if (prev.examples.length < 3) prev.examples.push({ why, atindex, text: String(text || '').slice(0, 180) });
    inner.set(person.slug, prev);
  }

  for (const sec of sectionRanges) {
    const presenters = extractNamesFromSectionTitle(sec.title, roster);
    if (!presenters.length) continue;

    const stats = new Map();
    for (let i = sec.startRow; i <= sec.endRow && i < rows.length; i += 1) {
      const r = rows[i];
      const key = String(r?.speaker_key || '');
      if (!isUnknownSpeakerRow(r)) continue;
      const words = String(r?.text || '').trim().split(/\s+/u).filter(Boolean).length;
      const prev = stats.get(key) || { words: 0, count: 0, firstIndex: i };
      prev.words += words;
      prev.count += 1;
      if (i < prev.firstIndex) prev.firstIndex = i;
      stats.set(key, prev);
    }
    const rankedUnknown = [...stats.entries()]
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.words - a.words || b.count - a.count || a.firstIndex - b.firstIndex);
    if (!rankedUnknown.length) continue;

    if (presenters.length === 1) {
      const top = rankedUnknown[0];
      const second = rankedUnknown[1];
      const dominant = top.words >= 90 && top.count >= 6 && (top.words / Math.max(1, second?.words || 1)) >= 1.25;
      if (!dominant) continue;
      add(top.key, presenters[0], `agenda-section-${sec.item || '?'}`, sec.startRow + 1, sec.title, 4);
      continue;
    }

    // 2+ presenters: map by speaking volume order to presenter order for this section.
    const usable = rankedUnknown.filter((x) => x.words >= 70 && x.count >= 4).slice(0, presenters.length);
    if (!usable.length) continue;
    for (let i = 0; i < usable.length && i < presenters.length; i += 1) {
      add(usable[i].key, presenters[i], `agenda-section-${sec.item || '?'}-presenter-${i + 1}`, sec.startRow + 1, sec.title, 2);
    }
  }
}

function chooseAssignments(byTarget) {
  return chooseAssignmentsWithRows(byTarget, []);
}

function gatherDirectIntroAssignments(rows, roster) {
  const introRe = /\b(?:my name is|my name['’]s)\s+([A-Za-z][A-Za-z'\-.]+(?:\s+[A-Za-z][A-Za-z'\-.]+){0,2})(?=[,.;:!?]|$)/iu;
  const byKey = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!isUnknownSpeakerRow(r)) continue;
    const text = String(r?.text || "");
    const m = text.match(introRe);
    if (!m?.[1]) continue;
    const introName = String(m[1] || "").trim();
    const parts = introName.split(/\s+/u).filter(Boolean);
    const person = bestRosterByFullName(introName, roster)
      || bestRosterByFirstName(parts[0] || "", roster)
      || bestRosterByLastName(parts.at(-1) || "", roster);
    if (!person) continue;
    const key = String(r?.speaker_key || "");
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const inner = byKey.get(key);
    const prev = inner.get(person.slug) || { person, count: 0, atindex: i + 1, sample: text };
    prev.count += 1;
    if (!prev.sample) prev.sample = text;
    inner.set(person.slug, prev);
  }

  const out = [];
  for (const [speakerKey, inner] of byKey.entries()) {
    const cands = [...inner.values()].sort((a, b) => b.count - a.count || a.person.full.localeCompare(b.person.full));
    if (!cands.length) continue;
    const best = cands[0];
    const second = cands[1];
    if (second && second.count === best.count) continue;
    out.push({
      speaker_key: speakerKey,
      person_full: best.person.full,
      person_slug: best.person.slug,
      evidence_count: Math.max(3, best.count * 3),
      margin: best.count - (second?.count || 0),
      examples: [{ why: "direct-self-intro", atindex: best.atindex, text: String(best.sample || "").slice(0, 180) }],
      alternatives: cands.slice(1, 4).map((x) => ({ full: x.person.full, count: x.count })),
    });
  }
  return out.sort((a, b) => a.speaker_key.localeCompare(b.speaker_key));
}

function isDirectSelfIntroAssignment(a) {
  const examples = Array.isArray(a?.examples) ? a.examples : [];
  return examples.some((x) => String(x?.why || "").trim() === "direct-self-intro");
}

function buildSpeakerSamples(rows, maxLines = 6) {
  const by = new Map();
  for (const r of rows) {
    const key = String(r?.speaker_key || '').trim();
    if (!key) continue;
    const arr = by.get(key) || [];
    if (arr.length < maxLines) arr.push(String(r?.text || '').trim());
    by.set(key, arr);
  }
  return by;
}

function looksLikeChairIntro(sampleLines) {
  const text = String((sampleLines || []).join(' ')).toLowerCase();
  if (!text) return false;
  const patterns = [
    /\bat\s+[0-9]+(?:\s*[a-z])?\b/u,
    /\b(?:next|item)\s+[0-9]+(?:\s*[a-z])?\b/u,
    /\bwe have (?:a )?(?:deputation|presentation)\b/u,
    /\b(?:deputation|presentation)\s+from\b/u,
    /\bwelcome,\s+[a-z]/u,
    /\bdoes anyone have any questions\b/u,
  ];
  return patterns.some((re) => re.test(text));
}

function chooseAssignmentsWithRows(byTarget, rows) {
  const samplesByKey = buildSpeakerSamples(rows || []);
  const out = [];
  for (const [speakerKey, m] of byTarget.entries()) {
    const cands = [...m.values()].sort((a, b) => b.count - a.count || a.person.full.localeCompare(b.person.full));
    if (!cands.length) continue;
    let best = cands[0];
    const second = cands[1];
    if (second && best.count === second.count) {
      const bestDirect = Number(best?.byKind?.callout || 0) + Number(best?.byKind?.selfIntro || 0);
      const secondDirect = Number(second?.byKind?.callout || 0) + Number(second?.byKind?.selfIntro || 0);
      if (bestDirect !== secondDirect) {
        best = bestDirect > secondDirect ? best : second;
      } else {
      // Prefer full roster-style identity over single-token alias when evidence ties.
      const bestIsFull = /\s/u.test(String(best?.person?.full || ''));
      const secondIsFull = /\s/u.test(String(second?.person?.full || ''));
      if (bestIsFull !== secondIsFull) {
        best = bestIsFull ? best : second;
      } else {
      // Resolve ties among single-name callout variants: Frank/Franklin/Frankly.
      const isSingleA = !/\s/u.test(String(best?.person?.full || ''));
      const isSingleB = !/\s/u.test(String(second?.person?.full || ''));
      if (isSingleA && isSingleB) {
        const a = normalizeToken(best.person.full);
        const b = normalizeToken(second.person.full);
        const near = a && b && (a.startsWith(b) || b.startsWith(a) || levenshtein(a, b) <= 2);
        if (near) {
          if (a.length !== b.length) best = a.length > b.length ? best : second;
          else {
            const aAt = Math.max(...(best.examples || []).map((x) => Number(x?.atindex || 0)), 0);
            const bAt = Math.max(...(second.examples || []).map((x) => Number(x?.atindex || 0)), 0);
            if (bAt > aAt) best = second;
          }
        } else {
          continue; // ambiguous tie
        }
      } else {
      // Handle corrected self-introductions from the same person, e.g. "Standalov" then "Standleff".
      const bSelf = Number(best?.byKind?.selfIntro || 0);
      const sSelf = Number(second?.byKind?.selfIntro || 0);
      const sameFirst = String(best?.person?.first || '') && String(best?.person?.first || '') === String(second?.person?.first || '');
      const lastA = String(best?.person?.last || '');
      const lastB = String(second?.person?.last || '');
      const lastNear = lastA && lastB ? levenshtein(lastA, lastB) <= 4 : false;
        if (bSelf > 0 && sSelf > 0 && sameFirst && lastNear) {
          const bestAt = Math.max(...(best.examples || []).map((x) => Number(x?.atindex || 0)), 0);
          const secondAt = Math.max(...(second.examples || []).map((x) => Number(x?.atindex || 0)), 0);
          if (secondAt > bestAt) best = second;
        } else {
          continue; // ambiguous tie
        }
      }
      }
      }
    }
    const margin = best.count - (second?.count || 0);
    const nonSectionEvidence = Number(best?.byKind?.callout || 0) + Number(best?.byKind?.selfIntro || 0);
    const sectionEvidence = Number(best?.byKind?.section || 0);

    const acceptViaDirect = nonSectionEvidence >= 1 && (best.count >= 2 || (best.count >= 1 && margin >= 1 && cands.length === 1));
    const acceptViaSectionOnly = nonSectionEvidence === 0 && sectionEvidence >= 6 && best.count >= 6 && margin >= 2;
    const accept = acceptViaDirect || acceptViaSectionOnly;
    if (!accept) continue;

    // Guardrail: reject likely chair/moderator segments assigned to a callee name.
    const samples = samplesByKey.get(speakerKey) || [];
    if (looksLikeChairIntro(samples)) {
      const hasSelfIntro = Number(best?.byKind?.selfIntro || 0) > 0;
      if (!hasSelfIntro) continue;
    }

    out.push({
      speaker_key: speakerKey,
      person_full: best.person.full,
      person_slug: best.person.slug,
      evidence_count: best.count,
      margin,
      examples: best.examples,
      alternatives: cands.slice(1, 4).map((x) => ({ full: x.person.full, count: x.count })),
    });
  }
  return out.sort((a, b) => a.speaker_key.localeCompare(b.speaker_key));
}

function countUnknown(rows) {
  let unknownRows = 0;
  const keys = new Set();
  for (const r of rows) {
    const k = String(r?.speaker_key || '');
    const d = String(r?.display || '');
    if (isUnknownSpeakerRow(r) || /^SPEAKER_\d+$/iu.test(d)) {
      unknownRows += 1;
      if (/^speaker_\d+$/iu.test(k)) keys.add(k);
    }
  }
  return { unknown_rows: unknownRows, unknown_keys: keys.size, unknown_key_list: [...keys].sort() };
}

async function ask(messages, { numPredict = 220 } = {}) {
  const body = {
    model: VERIFY_MODEL,
    mode: 'chat',
    keep_alive: 180,
    think: false,
    stream: false,
    options: { num_predict: numPredict },
    messages
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

function parseJsonObjectFromText(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch {}
  const m = src.match(/\{[\s\S]*\}/u);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function buildTransitionContext(rows, assignment, radius = 4) {
  const key = String(assignment?.speaker_key || '');
  if (!rows.length || !key) return '';
  const centers = [];
  for (const ex of (assignment?.examples || [])) {
    const idx = Number(ex?.atindex || 0) - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx < rows.length) centers.push(idx);
  }
  if (!centers.length) {
    const first = rows.findIndex((r) => String(r?.speaker_key || '') === key);
    if (first >= 0) centers.push(first);
  }
  const uniqCenters = [...new Set(centers)].slice(0, 3);
  const blocks = [];
  for (const center of uniqCenters) {
    const start = Math.max(0, center - radius);
    const end = Math.min(rows.length - 1, center + radius);
    const lines = [];
    for (let i = start; i <= end; i += 1) {
      const r = rows[i] || {};
      const line = `${i + 1}. [${String(r?.speaker_key || '')} | ${String(r?.display || '').trim() || 'unknown'}] ${String(r?.text || '').replace(/\s+/gu, ' ').trim()}`;
      lines.push(line);
    }
    blocks.push(`Context block around row ${center + 1}:\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

function resolveRosterPersonFromName(rawName, roster) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const byFull = bestRosterByFullName(name, roster);
  if (byFull) return byFull;
  const parts = name.split(/\s+/u).filter(Boolean);
  if (!parts.length) return null;
  const byLast = bestRosterByLastName(parts.at(-1), roster);
  if (byLast) return byLast;
  if (parts.length === 1) return bestRosterByFirstName(parts[0], roster);
  return bestRosterByFirstName(parts[0], roster);
}

async function verifyAssignmentWithContext({ assignment, rows, roster }) {
  const context = buildTransitionContext(rows, assignment, VERIFY_CONTEXT_RADIUS);
  const alternatives = Array.isArray(assignment?.alternatives) ? assignment.alternatives : [];
  const rosterList = roster.map((p) => p.full).join('\n');
  const prompt = [
    'Decide who the next speaker is at the transition context.',
    '',
    `Target speaker_key: ${String(assignment?.speaker_key || '')}`,
    `Proposed by heuristics: ${String(assignment?.person_full || '')}`,
    alternatives.length
      ? `Other candidates: ${alternatives.map((a) => `${String(a?.full || '').trim()} (${Number(a?.count || 0)})`).join('; ')}`
      : 'Other candidates: none',
    '',
    'ROSTER (only valid names):',
    rosterList,
    '',
    'CONTEXT (+/- nearby lines around transition):',
    context || '(no context)',
    '',
    'Return JSON only:',
    '{"accept": true|false, "person_full": "<roster full name or UNKNOWN>", "confidence": 0..1, "reason": "<short>"}',
    '',
    'Rules:',
    '- person_full must be a roster name exactly, or UNKNOWN.',
    '- Reject phrase fragments (example: "as you see", "talking", "slightly off topic").',
    '- Use the transition context; if uncertain, set accept=false and person_full=UNKNOWN.'
  ].join('\n');

  const raw = await ask([
    { role: 'system', content: 'You are a strict municipal speaker transition verifier.' },
    { role: 'user', content: prompt }
  ], { numPredict: 200 });
  const parsed = parseJsonObjectFromText(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'error', error: 'verifier returned non-JSON output', raw };
  }
  const accept = !!parsed.accept;
  const confidence = Number(parsed.confidence);
  const personRaw = String(parsed.person_full || '').trim();
  const reason = String(parsed.reason || '').trim();
  if (!accept) {
    return {
      status: 'reject',
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: reason || 'verifier rejected',
      raw,
    };
  }
  if (!Number.isFinite(confidence) || confidence < VERIFY_MIN_CONFIDENCE) {
    return {
      status: 'reject',
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: `confidence below threshold (${VERIFY_MIN_CONFIDENCE})`,
      raw,
    };
  }
  const person = resolveRosterPersonFromName(personRaw, roster);
  if (!person) {
    return {
      status: 'reject',
      confidence,
      reason: 'verifier did not return valid roster person',
      raw,
    };
  }
  if (person.slug === assignment.person_slug) {
    return { status: 'accept', confidence, reason, person, raw };
  }
  return { status: 'replace', confidence, reason, person, raw };
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || 'auto';
  const rosterArg = process.argv[4] || '';
  const voicesArg = process.argv[5] || DEFAULT_VOICES;
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }
  if (!rosterArg) {
    process.stderr.write('roster_file is required\n');
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolvePathFromRoot(transcriptDirArg);
  ensureDir(transcriptDir, 'transcript directory');

  const rosterPath = resolvePathFromRoot(rosterArg);
  const voicesDir = resolvePathFromRoot(voicesArg);
  ensureDir(path.dirname(rosterPath), 'roster parent directory');
  ensureDir(voicesDir, 'voices directory');

  const rosterText = fs.readFileSync(rosterPath, 'utf8');
  const roster = parseRoster(rosterText);
  if (!roster.length) throw new Error(`no roster people parsed from ${rosterPath}`);

  const { file: diarizeJson } = pickDiarizationJson(transcriptDir, prefixArg);
  const payload = JSON.parse(fs.readFileSync(diarizeJson, 'utf8'));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) throw new Error(`no rows in ${diarizeJson}`);

  const before = countUnknown(rows);
  const evidence = gatherEvidence(rows, roster);
  gatherSelfIntroEvidence(rows, roster, evidence);
  const agendaMatchesPath = pickAgendaMatchesJson(transcriptDir, prefixArg);
  if (agendaMatchesPath && fs.existsSync(agendaMatchesPath)) {
    const agendaMatchesObj = JSON.parse(fs.readFileSync(agendaMatchesPath, 'utf8'));
    const sectionRanges = buildSectionRangesFromAgendaMatches(rows, agendaMatchesObj);
    gatherAgendaSectionEvidence(rows, roster, sectionRanges, evidence);
  }
  const proposedAssignments = chooseAssignmentsWithRows(evidence, rows);
  const directIntroAssignments = gatherDirectIntroAssignments(rows, roster);
  const mergedAssignments = [...proposedAssignments];
  const existingKeys = new Set(mergedAssignments.map((x) => x.speaker_key));
  for (const a of directIntroAssignments) {
    if (existingKeys.has(a.speaker_key)) continue;
    mergedAssignments.push(a);
    existingKeys.add(a.speaker_key);
  }
  const allowOverwriteExisting = /^(1|true|yes)$/iu.test(String(process.env.PYA_AUTOASSIGN_OVERWRITE_EXISTING || ''));
  const assignments = [];
  const verifierRejected = [];
  const verifierErrors = [];
  const verifierReplaced = [];
  const skippedLocked = [];
  const unchangedStable = [];
  const writeErrors = [];

  for (const baseAssignment of mergedAssignments) {
    let a = baseAssignment;
    let metaPath = '';
    try {
      metaPath = ensureSpeakerMetaFile(voicesDir, a.speaker_key);
    } catch (err) {
      writeErrors.push({
        speaker_key: a.speaker_key,
        proposed_name: a.person_slug,
        error: String(err?.message || err),
      });
      continue;
    }
    const existingName = readSpeakerMetaName(metaPath);
    const existingStable = isStableSpeakerName(existingName);
    if (existingStable) {
      if (existingName === a.person_slug) {
        assignments.push(a);
        unchangedStable.push({
          speaker_key: a.speaker_key,
          existing_name: existingName,
        });
        continue;
      }
      if (!allowOverwriteExisting) {
        skippedLocked.push({
          speaker_key: a.speaker_key,
          existing_name: existingName,
          proposed_name: a.person_slug,
          proposed_full: a.person_full,
          evidence_count: a.evidence_count,
        });
        continue;
      }
    }
    if (VERIFY_ENABLED) {
      try {
        const v = await verifyAssignmentWithContext({ assignment: a, rows, roster });
        if (v.status === 'reject') {
          verifierRejected.push({
            speaker_key: a.speaker_key,
            proposed_name: a.person_slug,
            proposed_full: a.person_full,
            confidence: v.confidence,
            reason: v.reason,
          });
          continue;
        }
        if (v.status === 'error') {
          if (isDirectSelfIntroAssignment(a)) {
            // Safe fallback: direct "my name is X" matched to roster identity.
            // Keep moving when verifier transport/output fails.
            v.status = 'accept';
          } else {
          verifierErrors.push({
            speaker_key: a.speaker_key,
            proposed_name: a.person_slug,
            proposed_full: a.person_full,
            error: v.error,
          });
          continue;
          }
        }
        if (v.status === 'replace') {
          verifierReplaced.push({
            speaker_key: a.speaker_key,
            from_full: a.person_full,
            to_full: v.person.full,
            confidence: v.confidence,
            reason: v.reason || '',
          });
          a = {
            ...a,
            person_full: v.person.full,
            person_slug: v.person.slug,
          };
        }
      } catch (err) {
        if (isDirectSelfIntroAssignment(a)) {
          // Safe fallback when verifier call itself fails.
        } else {
        verifierErrors.push({
          speaker_key: a.speaker_key,
          proposed_name: a.person_slug,
          proposed_full: a.person_full,
          error: String(err?.message || err),
        });
        continue;
        }
      }
    }
    try {
      setSpeakerMetaName(metaPath, a.person_slug);
    } catch (err) {
      writeErrors.push({
        speaker_key: a.speaker_key,
        proposed_name: a.person_slug,
        error: String(err?.message || err),
      });
      continue;
    }
    assignments.push(a);
  }

  const reportPath = path.join(transcriptDir, `${payload?.prefix || 'auto'}.speaker.autoassign.report.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify({
    diarize_json: diarizeJson,
    roster_file: rosterPath,
    voices_dir: voicesDir,
    overwrite_existing: allowOverwriteExisting,
    before,
    proposed_assignments: proposedAssignments,
    direct_intro_assignments: directIntroAssignments,
    merged_assignments: mergedAssignments,
    verifier_enabled: VERIFY_ENABLED,
    verifier_model: VERIFY_MODEL,
    verifier_min_confidence: VERIFY_MIN_CONFIDENCE,
    verifier_context_radius: VERIFY_CONTEXT_RADIUS,
    verifier_rejected: verifierRejected,
    verifier_errors: verifierErrors,
    verifier_replaced: verifierReplaced,
    assignments,
    skipped_locked: skippedLocked,
    unchanged_stable: unchangedStable,
    write_errors: writeErrors,
    assigned_keys: assignments.map((x) => x.speaker_key),
    generated_at_utc: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`[speaker-autoassign] diarize: ${diarizeJson}\n`);
  process.stdout.write(`[speaker-autoassign] roster: ${rosterPath}\n`);
  process.stdout.write(`[speaker-autoassign] voices: ${voicesDir}\n`);
  process.stdout.write(`[speaker-autoassign] before unknown rows: ${before.unknown_rows}\n`);
  process.stdout.write(`[speaker-autoassign] before unknown keys: ${before.unknown_keys}\n`);
  process.stdout.write(`[speaker-autoassign] proposed keys: ${proposedAssignments.length}\n`);
  process.stdout.write(`[speaker-autoassign] direct intro keys: ${directIntroAssignments.length}\n`);
  process.stdout.write(`[speaker-autoassign] merged keys: ${mergedAssignments.length}\n`);
  process.stdout.write(`[speaker-autoassign] verifier enabled: ${VERIFY_ENABLED ? 'yes' : 'no'}\n`);
  process.stdout.write(`[speaker-autoassign] verifier rejected: ${verifierRejected.length}\n`);
  process.stdout.write(`[speaker-autoassign] verifier errors: ${verifierErrors.length}\n`);
  process.stdout.write(`[speaker-autoassign] verifier replaced: ${verifierReplaced.length}\n`);
  process.stdout.write(`[speaker-autoassign] assigned keys: ${assignments.length}\n`);
  process.stdout.write(`[speaker-autoassign] locked skips: ${skippedLocked.length}\n`);
  process.stdout.write(`[speaker-autoassign] unchanged stable: ${unchangedStable.length}\n`);
  process.stdout.write(`[speaker-autoassign] write errors: ${writeErrors.length}\n`);
  for (const e of writeErrors.slice(0, 8)) {
    process.stdout.write(`[speaker-autoassign] warn ${e.speaker_key}: ${e.error}\n`);
  }
  for (const a of assignments) {
    process.stdout.write(`[speaker-autoassign] ${a.speaker_key} -> ${a.person_full} (evidence=${a.evidence_count})\n`);
  }
  process.stdout.write(`[speaker-autoassign] report: ${reportPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
