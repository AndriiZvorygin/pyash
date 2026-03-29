#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/htaf/pyac/pyash';

function usage() {
  return [
    'Usage: node command/relabel_speaker_sentence_srt_from_transcript_folder.mjs <transcript_dir> [prefix] [voices_dir]',
    'Example: node command/relabel_speaker_sentence_srt_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto world/voices'
  ].join('\n');
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`directory not found: ${dirPath}`);
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMs = Math.round(safe * 1000);
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseSpeakerMetaFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  const re = /^\s*su name (.+?) ob (.+?) ya\s*$/gmu;
  let m;
  while ((m = re.exec(text))) {
    const key = String(m[1] || '').trim();
    const body = String(m[2] || '').trim();
    if (body.startsWith('text ')) {
      const q = body.slice(5).trim();
      try { out[key] = JSON.parse(q); } catch { out[key] = q.replace(/^"|"$/g, ''); }
      continue;
    }
    if (body.startsWith('num ')) {
      const n = Number(body.slice(4).trim());
      if (Number.isFinite(n)) out[key] = n;
      continue;
    }
    if (body.startsWith('bool ')) {
      out[key] = body.slice(5).trim().toLowerCase() === 'truth';
    }
  }
  return out;
}

function loadSpeakerMetadataMap(voicesDir) {
  const out = new Map();
  if (!fs.existsSync(voicesDir)) return out;
  const files = fs.readdirSync(voicesDir)
    .filter((n) => n.endsWith('.pya') && n !== 'index.pya')
    .sort();
  for (const file of files) {
    const key = file.replace(/\.pya$/u, '');
    try { out.set(key, parseSpeakerMetaFile(path.join(voicesDir, file))); } catch {}
  }
  return out;
}

function toDisplayLabel(speakerKey, metadataMap) {
  const key = String(speakerKey || '').trim();
  const meta = metadataMap.get(key) || {};
  const rawName = String(meta.name || '').trim();
  if (rawName && !/^speaker_\d+$/iu.test(rawName)) {
    return rawName.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  const m = key.match(/^speaker_(\d+)$/iu);
  if (m) return `SPEAKER_${String(Number(m[1])).padStart(3, '0')}`;
  if (rawName) return rawName.replace(/_/g, ' ');
  return key || 'SPEAKER_UNKNOWN';
}

function pickAutoAssignReport(transcriptDir, resolvedPrefix) {
  const exact = path.join(transcriptDir, `${resolvedPrefix}.speaker.autoassign.report.json`);
  if (fs.existsSync(exact)) return exact;
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.speaker.autoassign.report.json'))
    .sort();
  if (!files.length) return '';
  return path.join(transcriptDir, files[files.length - 1]);
}

function toTitleCaseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\b\w/gu, (m) => m.toUpperCase());
}

function isJunkSpeakerName(rawName) {
  const n = String(rawName || '').trim().toLowerCase();
  if (!n) return true;
  if (/^speaker_\d+$/iu.test(n)) return true;
  const junk = new Set([
    'good', 'yep', 'welcome', 'okay', 'ok', 'yes', 'no', 'thanks', 'thank', 'hello', 'hi', 'great', 'perfect', 'thinking',
  ]);
  return junk.has(n);
}

function loadMeetingAssignmentsMap(reportPath) {
  const out = new Map();
  if (!reportPath || !fs.existsSync(reportPath)) return out;
  try {
    const obj = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const arr = Array.isArray(obj?.assignments) ? obj.assignments : [];
    for (const a of arr) {
      const key = String(a?.speaker_key || '').trim();
      const full = toTitleCaseName(a?.person_full || '');
      if (!key || !full) continue;
      out.set(key, full);
    }
  } catch {}
  return out;
}

function toDisplayLabelWithMeetingAssignments(speakerKey, metadataMap, meetingAssignments) {
  const key = String(speakerKey || '').trim();
  const m = key.match(/^speaker_(\d+)$/iu);
  if (m) {
    const meta = metadataMap.get(key) || {};
    const rawName = String(meta.name || '').trim();
    if (rawName && !isJunkSpeakerName(rawName)) {
      return rawName.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
    }
    const assigned = String(meetingAssignments.get(key) || '').trim();
    if (assigned) return assigned;
    return `SPEAKER_${String(Number(m[1])).padStart(3, '0')}`;
  }
  const meta = metadataMap.get(key) || {};
  const rawName = String(meta.name || '').trim();
  if (rawName && !isJunkSpeakerName(rawName)) {
    return rawName.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  if (rawName && !isJunkSpeakerName(rawName)) return rawName.replace(/_/g, ' ');
  return key || 'SPEAKER_UNKNOWN';
}

function pickDiarizationJson(transcriptDir, prefix = 'auto') {
  if (prefix !== 'auto') {
    const p = path.join(transcriptDir, `${prefix}.speaker.sentences.json`);
    if (!fs.existsSync(p)) throw new Error(`speaker sentences json missing: ${p}`);
    return { file: p, resolvedPrefix: prefix };
  }
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.speaker.sentences.json'));
  if (!files.length) throw new Error(`no *.speaker.sentences.json found in ${transcriptDir}`);
  const ranked = files
    .map((name) => {
      const lower = name.toLowerCase();
      const st = fs.statSync(path.join(transcriptDir, name));
      let score = 0;
      if (lower.includes('.normalized.')) score += 40;
      if (lower.startsWith('meeting-qwen-auto')) score += 15;
      return { name, score, mtime: Number(st.mtimeMs || 0) };
    })
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.name.localeCompare(b.name));
  const chosen = ranked[0].name;
  return {
    file: path.join(transcriptDir, chosen),
    resolvedPrefix: chosen.replace(/\.speaker\.sentences\.json$/u, ''),
  };
}

function renderSrt(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    out.push(String(i + 1));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(`${row.display}: ${row.text}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || 'auto';
  const voicesDirArg = process.argv[4] || '';
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = path.resolve(process.cwd(), transcriptDirArg);
  ensureDir(transcriptDir);
  const { file: diarizeJson, resolvedPrefix } = pickDiarizationJson(transcriptDir, prefixArg);

  const voicesDir = voicesDirArg
    ? path.resolve(process.cwd(), voicesDirArg)
    : path.join(ROOT, 'world', 'voices');

  const payload = JSON.parse(fs.readFileSync(diarizeJson, 'utf8'));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) throw new Error(`no rows in ${diarizeJson}`);

  const metadataMap = loadSpeakerMetadataMap(voicesDir);
  const autoAssignReportPath = pickAutoAssignReport(transcriptDir, resolvedPrefix);
  const meetingAssignments = loadMeetingAssignmentsMap(autoAssignReportPath);
  const updatedRows = rows.map((row) => ({
    ...row,
    display: toDisplayLabelWithMeetingAssignments(row.speaker_key, metadataMap, meetingAssignments),
  }));

  const outSrt = path.join(transcriptDir, `${resolvedPrefix}.speaker.sentence.srt`);
  fs.writeFileSync(outSrt, renderSrt(updatedRows), 'utf8');
  fs.writeFileSync(diarizeJson, `${JSON.stringify({
    ...payload,
    relabeled_at: new Date().toISOString(),
    voices_dir: voicesDir,
    rows: updatedRows,
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`[speaker-relabel] source: ${diarizeJson}\n`);
  process.stdout.write(`[speaker-relabel] voices dir: ${voicesDir}\n`);
  if (autoAssignReportPath) process.stdout.write(`[speaker-relabel] autoassign report: ${autoAssignReportPath}\n`);
  process.stdout.write(`[speaker-relabel] wrote: ${outSrt}\n`);
  process.stdout.write(`[speaker-relabel] updated: ${diarizeJson}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
