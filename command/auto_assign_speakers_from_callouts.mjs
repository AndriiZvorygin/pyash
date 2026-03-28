#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';
const DEFAULT_VOICES = path.join(ROOT, 'world/voices');

function usage() {
  return [
    'Usage: node command/auto_assign_speakers_from_callouts.mjs <transcript_dir> [prefix] <roster_file> [voices_dir]',
    'Example: node command/auto_assign_speakers_from_callouts.mjs artifacts/.../transcript meeting-qwen-auto-normalized.sentences world/house/owen-sound-reporter/artifacts/owen-sound/2022-2026-council.txt world/voices',
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
  const banned = new Set([
    'Through', 'Chair', 'Mr', 'Mrs', 'Ms', 'Councillor', 'Councilor', 'Mayor', 'Deputy',
    'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
    'Avenue', 'Street', 'Road', 'West', 'East', 'North', 'South',
    'Committee', 'Council', 'City', 'Project', 'Moving', 'Forward', 'Neighborhood'
  ]);
  if (words.some((w) => banned.has(w.replace(/\./gu, '')))) return null;
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
  const banned = new Set([
    'Through', 'Chair', 'Mr', 'Mrs', 'Ms', 'Councillor', 'Councilor', 'Mayor', 'Deputy',
    'Committee', 'Council', 'City', 'Project', 'Item', 'Report',
    'Yes', 'Yeah', 'No', 'Okay', 'Ok', 'Thanks', 'Thank', 'Hello', 'Hi', 'Good', 'Great', 'Perfect',
    'Seeing', 'Call', 'Question', 'Moved', 'Second', 'Carried', 'Favor', 'Aye', 'All'
  ]);
  if (banned.has(name.replace(/\./gu, ''))) return null;
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
    const parts = full.split(/\s+/u).filter(Boolean);
    if (parts.length < 2) continue;
    const last = parts.at(-1);
    people.push({
      full,
      slug: slugName(full),
      first: normalizeToken(parts[0]),
      last: normalizeToken(last),
    });
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

function gatherEvidence(rows, roster) {
  const byTarget = new Map();
  const titleNameRe = /\b(?:councillor|mayor|deputy\s+mayor|mr\.?|ms\.?|miss)\s+([A-Za-z'\-\.]+)/giu;
  const calloutCueRe = /\b(go to|you'?re on|next|over to|go ahead|i'?ll ask|can you|call on|the floor is|thank you|welcome)\b/iu;
  const bareNameCalloutRe = /^\s*(?:go ahead,\s*)?([A-Z][A-Za-z'\-.]+)\s*[?.!,:;]?\s*$/u;

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
    const person = bestRosterByFirstName(m[1], roster)
      || bestRosterByLastName(m[1], roster);
    if (!person) continue;
    add(String(nxt?.speaker_key || ''), person, 'bare-name-handoff', i + 1, text, 3);
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
    if (m) {
      const introName = String(m[1] || '').trim();
      const exactFull = normalizeText(introName);
      let person = null;
      for (const p of roster) {
        if (normalizeText(p.full) === exactFull) {
          person = p;
          break;
        }
      }
      if (!person) person = bestRosterByFullName(introName, roster);
      if (!person) person = personFromFullName(titleCaseName(introName));
      if (!person) person = personFromSingleName(introName);
      if (person) add(key, person, 'self-intro', i + 1, text);
    }

    // Bare role intro format: "First Last, Role title." (roster-only to avoid false positives)
    if (!m) {
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
    const margin = best.count - (second?.count || 0);
    const nonSectionEvidence = Number(best?.byKind?.callout || 0) + Number(best?.byKind?.selfIntro || 0);
    const sectionEvidence = Number(best?.byKind?.section || 0);

    const acceptViaDirect = nonSectionEvidence >= 1 && (best.count >= 2 || (best.count >= 1 && margin >= 1 && cands.length === 1));
    const acceptViaSectionOnly = nonSectionEvidence === 0 && sectionEvidence >= 3 && best.count >= 3 && margin >= 1;
    const accept = acceptViaDirect || acceptViaSectionOnly;
    if (!accept) continue;

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
  const assignments = chooseAssignments(evidence);

  for (const a of assignments) {
    const metaPath = ensureSpeakerMetaFile(voicesDir, a.speaker_key);
    setSpeakerMetaName(metaPath, a.person_slug);
  }

  const reportPath = path.join(transcriptDir, `${payload?.prefix || 'auto'}.speaker.autoassign.report.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify({
    diarize_json: diarizeJson,
    roster_file: rosterPath,
    voices_dir: voicesDir,
    before,
    assignments,
    assigned_keys: assignments.map((x) => x.speaker_key),
    generated_at_utc: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`[speaker-autoassign] diarize: ${diarizeJson}\n`);
  process.stdout.write(`[speaker-autoassign] roster: ${rosterPath}\n`);
  process.stdout.write(`[speaker-autoassign] voices: ${voicesDir}\n`);
  process.stdout.write(`[speaker-autoassign] before unknown rows: ${before.unknown_rows}\n`);
  process.stdout.write(`[speaker-autoassign] before unknown keys: ${before.unknown_keys}\n`);
  process.stdout.write(`[speaker-autoassign] assigned keys: ${assignments.length}\n`);
  for (const a of assignments) {
    process.stdout.write(`[speaker-autoassign] ${a.speaker_key} -> ${a.person_full} (evidence=${a.evidence_count})\n`);
  }
  process.stdout.write(`[speaker-autoassign] report: ${reportPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
