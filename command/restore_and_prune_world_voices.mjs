#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';
const DEFAULT_VOICES_DIR = path.join(ROOT, 'world/voices');
const DEFAULT_REPORTS_ROOT = path.join(ROOT, 'world/house/owen-sound-reporter/artifacts/owen-sound/meetings');

const BAD_SLUGS = new Set([
  'good','yes','no','okay','welcome','none','unknown','moving_forward','moving','forward',
  'sorry_about_that','understood','done','talking','speaker','speaker_probe_temp'
]);

function usage() {
  return [
    'Usage: node command/restore_and_prune_world_voices.mjs [voices_dir] [reports_root]',
    'Example: node command/restore_and_prune_world_voices.mjs world/voices world/house/owen-sound-reporter/artifacts/owen-sound/meetings',
  ].join('\n');
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function normalizeSlug(v) {
  return String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function looksHumanSlug(slug) {
  if (!slug) return false;
  if (BAD_SLUGS.has(slug)) return false;
  if (/^speaker_\d+$/u.test(slug)) return false;
  // Prefer first_last, first_middle_last, etc.
  if (/^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)+$/u.test(slug)) return true;
  return false;
}

function titleFromSlug(slug) {
  return slug.split('_').map((p) => p ? (p[0].toUpperCase() + p.slice(1)) : p).join(' ');
}

function collectVotes(reportsRoot) {
  const votes = new Map(); // speaker_key -> Map(slug -> {count,full})
  const reportFiles = [];
  const sentenceFiles = [];

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name === 'auto.speaker.autoassign.report.json') reportFiles.push(full);
      else if (name.endsWith('.sentences.speaker.sentences.json')) sentenceFiles.push(full);
    }
  }
  walk(reportsRoot);

  const add = (speakerKey, slugRaw, fullRaw) => {
    const key = String(speakerKey || '').toLowerCase().trim();
    if (!/^speaker_\d+$/u.test(key)) return;
    const slug = normalizeSlug(slugRaw);
    if (!looksHumanSlug(slug)) return;
    const full = String(fullRaw || titleFromSlug(slug)).trim();
    if (!votes.has(key)) votes.set(key, new Map());
    const m = votes.get(key);
    const prev = m.get(slug) || { count: 0, full };
    prev.count += 1;
    if (!prev.full && full) prev.full = full;
    m.set(slug, prev);
  };

  for (const rf of reportFiles) {
    const obj = readJson(rf);
    if (!obj || typeof obj !== 'object') continue;

    for (const row of Array.isArray(obj.assignments) ? obj.assignments : []) {
      add(row?.speaker_key, row?.person_slug, row?.person_full);
    }
    for (const row of Array.isArray(obj.skipped_locked) ? obj.skipped_locked : []) {
      add(row?.speaker_key, row?.existing_name, row?.existing_name);
    }
    for (const row of Array.isArray(obj.unchanged_stable) ? obj.unchanged_stable : []) {
      add(row?.speaker_key, row?.existing_name, row?.existing_name);
    }
    for (const row of Array.isArray(obj.merged_assignments) ? obj.merged_assignments : []) {
      add(row?.speaker_key, row?.person_slug, row?.person_full);
    }
  }

  // Recover from relabeled diarization payloads (display field is what transcript uses).
  for (const sf of sentenceFiles) {
    const obj = readJson(sf);
    if (!obj) continue;
    const rows = Array.isArray(obj?.rows) ? obj.rows : (Array.isArray(obj?.sentences) ? obj.sentences : []);
    for (const row of rows) {
      const key = row?.speaker_key;
      const display = String(row?.display || '').trim();
      if (!display) continue;
      if (/^SPEAKER_\d+$/u.test(display)) continue;
      // Strip common honorific prefixes for slugging only.
      const cleaned = display
        .replace(/^(Councillor|Councilor|Mayor|Deputy Mayor|Deputy|Chair|Madam Chair|Mr\. Chair|Ms\.|Mr\.)\s+/iu, '')
        .trim();
      if (!cleaned) continue;
      add(key, normalizeSlug(cleaned), cleaned);
    }
  }

  const chosen = new Map();
  for (const [speakerKey, m] of votes) {
    const best = [...m.entries()].sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))[0];
    if (best) chosen.set(speakerKey, { slug: best[0], full: best[1].full || titleFromSlug(best[0]), count: best[1].count });
  }

  return { reportFiles, sentenceFiles, chosen };
}

function writePyaMeta(filePath, speakerKey, slug, full) {
  const now = new Date().toISOString();
  const text = [
    'su name speaker metadata be map def',
    `su name created_at ob text "${now}" ya`,
    `su name full_name ob text "${String(full || '').replace(/"/g, '\\"')}" ya`,
    `su name name ob text "${String(slug || '').replace(/"/g, '\\"')}" ya`,
    'su name origin ob text "restore" ya',
    `su name speaker ob text "${speakerKey}" ya`,
    `su name updated_at ob text "${now}" ya`,
    'prah',
    ''
  ].join('\n');
  try {
    if (isFile(filePath)) fs.unlinkSync(filePath);
  } catch {}
  fs.writeFileSync(filePath, text, 'utf8');
}

function rebuildIndex(voicesDir, keptKeys) {
  const next = Math.max(1, ...keptKeys.map((k) => Number(k.split('_')[1]) || 0)) + 1;
  const lines = [
    'su name speaker metadata be map def',
    `su name next_speaker_id ob num ${next} ya`,
    'prah',
    ''
  ];
  fs.writeFileSync(path.join(voicesDir, 'index.pya'), lines.join('\n'), 'utf8');
}

function main() {
  const voicesArg = process.argv[2] || DEFAULT_VOICES_DIR;
  const reportsArg = process.argv[3] || DEFAULT_REPORTS_ROOT;
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const voicesDir = path.isAbsolute(voicesArg) ? voicesArg : path.resolve(process.cwd(), voicesArg);
  const reportsRoot = path.isAbsolute(reportsArg) ? reportsArg : path.resolve(process.cwd(), reportsArg);

  if (!isDir(voicesDir)) throw new Error(`voices dir not found: ${voicesDir}`);
  if (!isDir(reportsRoot)) throw new Error(`reports root not found: ${reportsRoot}`);

  const { reportFiles, sentenceFiles, chosen } = collectVotes(reportsRoot);

  const names = fs.readdirSync(voicesDir);
  const speakerBaseKeys = new Set(
    names
      .map((n) => n.match(/^(speaker_\d+)\.(?:pya|npy|wav)$/u)?.[1])
      .filter(Boolean)
  );
  for (const key of chosen.keys()) speakerBaseKeys.add(key);

  // hard remove known-bad speaker_004
  for (const ext of ['.pya', '.npy', '.wav']) {
    const p = path.join(voicesDir, `speaker_004${ext}`);
    if (isFile(p)) {
      try { fs.unlinkSync(p); } catch (err) { process.stdout.write(`[voices-restore] warn could not remove ${p}: ${String(err?.message || err)}\n`); }
    }
  }

  const kept = [];
  const pruned = [];
  const updated = [];

  for (const key of [...speakerBaseKeys].sort((a,b)=>Number(a.split('_')[1])-Number(b.split('_')[1]))) {
    if (key === 'speaker_004') continue;
    const label = chosen.get(key);
    if (!label || !looksHumanSlug(label.slug)) {
      for (const ext of ['.pya', '.npy', '.wav']) {
        const p = path.join(voicesDir, `${key}${ext}`);
        if (isFile(p)) {
          try { fs.unlinkSync(p); } catch (err) { process.stdout.write(`[voices-restore] warn could not prune ${p}: ${String(err?.message || err)}\n`); }
        }
      }
      pruned.push(key);
      continue;
    }

    const pyaPath = path.join(voicesDir, `${key}.pya`);
    writePyaMeta(pyaPath, key, label.slug, label.full);
    updated.push({ key, slug: label.slug, full: label.full, votes: label.count });
    kept.push(key);
  }

  // prune temp/rebuild/probe files
  for (const n of fs.readdirSync(voicesDir)) {
    if (/rebuildbak|probe_temp/u.test(n)) {
      const p = path.join(voicesDir, n);
      try { if (isFile(p)) fs.unlinkSync(p); } catch {}
    }
  }

  rebuildIndex(voicesDir, kept);

  process.stdout.write(`[voices-restore] reports used: ${reportFiles.length}\n`);
  process.stdout.write(`[voices-restore] sentence files used: ${sentenceFiles.length}\n`);
  process.stdout.write(`[voices-restore] recovered labels: ${chosen.size}\n`);
  process.stdout.write(`[voices-restore] kept human speakers: ${kept.length}\n`);
  process.stdout.write(`[voices-restore] pruned speakers: ${pruned.length}\n`);
  for (const row of updated.slice(0, 200)) {
    process.stdout.write(`[voices-restore] ${row.key} -> ${row.slug} (${row.full}) votes=${row.votes}\n`);
  }
}

main();
