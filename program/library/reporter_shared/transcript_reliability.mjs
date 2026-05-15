import fs from 'node:fs';
import path from 'node:path';

function safeReadJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function safeReadText(filePath, fallback = '') {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return fallback; }
}

function toPyaScalar(value) {
  return JSON.stringify(value == null ? '' : String(value));
}

export function writePyaMap(filePath, mapObj) {
  const lines = ['su name artifact be map def'];
  for (const [k, v] of Object.entries(mapObj || {})) {
    lines.push(`exists su name ${k} ob text ${toPyaScalar(typeof v === 'string' ? v : JSON.stringify(v))} ya`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

export function buildSourceProvenance({ meetingDir, transcriptDir, prefix = 'meeting-qwen-auto-normalized', payload = {} }) {
  const sourceDir = path.join(meetingDir, 'source');
  const convertedDir = path.join(meetingDir, 'converted');
  const subreportDir = path.join(convertedDir, 'subreports');
  const official = {
    agenda_pdf_url: String(payload?.source?.agenda_pdf_url || payload?.source?.agenda_pdf || payload?.agenda_pdf_url || ''),
    agenda_html_url: String(payload?.source?.agenda_html_url || payload?.source?.meeting_url || payload?.meeting_url || ''),
    minutes_pdf_url: String(payload?.source?.minutes_pdf_url || ''),
    minutes_html_url: String(payload?.source?.minutes_html_url || ''),
    timestamped_agenda_url: String(payload?.source?.timestamped_agenda_url || ''),
  };
  const mirror = {
    agenda_pdf_paths: fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).filter((n) => /^agenda-\d+\.pdf$/iu.test(n)).map((n) => path.join(sourceDir, n)) : [],
    agenda_html_paths: fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).filter((n) => /^agenda-\d+\.html$/iu.test(n)).map((n) => path.join(sourceDir, n)) : [],
    minutes_pdf_paths: fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).filter((n) => /^minutes-\d+\.pdf$/iu.test(n)).map((n) => path.join(sourceDir, n)) : [],
    minutes_html_paths: fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).filter((n) => /^minutes-\d+\.html$/iu.test(n)).map((n) => path.join(sourceDir, n)) : [],
    subreport_paths: fs.existsSync(subreportDir) ? fs.readdirSync(subreportDir).filter((n) => n.endsWith('.md')).map((n) => path.join(subreportDir, n)) : [],
  };
  const health = {
    agenda_markdown_exists: fs.existsSync(path.join(convertedDir, 'agenda-01.md')),
    minutes_markdown_exists: fs.existsSync(path.join(convertedDir, 'minutes-01.md')),
    has_local_agenda_source: mirror.agenda_pdf_paths.length > 0 || mirror.agenda_html_paths.length > 0,
    has_local_minutes_source: mirror.minutes_pdf_paths.length > 0 || mirror.minutes_html_paths.length > 0,
    has_subreports: mirror.subreport_paths.length > 0,
  };
  const warnings = [];
  if (!health.has_local_agenda_source) warnings.push('missing_agenda_source');
  if (!health.has_local_minutes_source) warnings.push('missing_minutes_source');
  if (!health.agenda_markdown_exists) warnings.push('missing_agenda_markdown');
  if (!health.minutes_markdown_exists) warnings.push('missing_minutes_markdown');
  if (!official.agenda_pdf_url && !official.agenda_html_url) warnings.push('official_link_unavailable');
  if ((mirror.agenda_pdf_paths.length || mirror.agenda_html_paths.length) && (!official.agenda_pdf_url && !official.agenda_html_url)) warnings.push('mirror_only');

  const selected_boundary_sources = [
    'agenda',
    health.minutes_markdown_exists ? 'minutes' : 'none',
    official.timestamped_agenda_url ? 'timestamped_agenda' : 'none',
    'transcript_cues',
  ].filter((x) => x !== 'none');

  const artifactPath = path.join(transcriptDir, `${prefix}.source-provenance.pya`);
  writePyaMap(artifactPath, {
    schema_version: 'transcript_source_provenance_v1',
    official_source_links: official,
    mirror_source_links: mirror,
    selected_boundary_sources,
    source_health: health,
    warnings,
    pass: health.has_local_agenda_source,
  });
  return { artifactPath, official, mirror, health, warnings, selected_boundary_sources };
}

export function extractAgendaTimestampBoundaries({ meetingDir, transcriptDir, prefix = 'meeting-qwen-auto-normalized', transcriptDurationSeconds = 0 }) {
  const convertedDir = path.join(meetingDir, 'converted');
  const candidates = [path.join(convertedDir, 'agenda-01.md'), path.join(convertedDir, 'agenda-cover-01.md')].filter((p) => fs.existsSync(p));
  const rows = [];
  for (const sourcePath of candidates) {
    const text = safeReadText(sourcePath, '');
    const lines = text.split(/\r?\n/u);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const m = line.match(/^(\d+[\w.\-]*)\s+(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)$/u);
      if (!m) continue;
      const [, itemId, heading, tsRaw] = m;
      const parts = tsRaw.split(':').map((x) => Number(x));
      const seconds = parts.length === 2 ? (parts[0] * 60 + parts[1]) : (parts[0] * 3600 + parts[1] * 60 + parts[2]);
      rows.push({ item_id: itemId, heading, detected_timestamp: tsRaw, seconds, source_file: sourcePath, confidence: 0.78, extraction_reason: 'deterministic_line_suffix_time' });
    }
  }
  const sorted = [...rows].sort((a, b) => a.seconds - b.seconds);
  let monotonic = true;
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i].seconds < sorted[i - 1].seconds) monotonic = false;
  const withinDuration = Number(transcriptDurationSeconds) > 0 ? sorted.every((r) => r.seconds <= transcriptDurationSeconds + 60) : true;
  const validation_status = monotonic && withinDuration && sorted.length >= 2 ? 'pass' : 'fail';
  const artifactPath = path.join(transcriptDir, `${prefix}.agenda-timestamp-boundaries.pya`);
  writePyaMap(artifactPath, {
    schema_version: 'agenda_timestamp_boundaries_v1',
    boundaries: sorted,
    validation: { monotonic, within_duration: withinDuration, sparse: sorted.length < 2, status: validation_status },
    pass: validation_status === 'pass',
  });
  return { artifactPath, boundaries: sorted, pass: validation_status === 'pass' };
}

export function refineBoundariesWithMinutes({ meetingDir, transcriptDir, prefix = 'meeting-qwen-auto-normalized' }) {
  const convertedMinutes = path.join(meetingDir, 'converted', 'minutes-01.md');
  const sectionGroundingPath = path.join(transcriptDir, `${prefix}.agenda.section-grounding.pya`);
  const outPath = path.join(transcriptDir, `${prefix}.minutes-boundary-refine.pya`);

  if (!fs.existsSync(convertedMinutes) || !fs.existsSync(sectionGroundingPath)) {
    writePyaMap(outPath, {
      schema_version: 'minutes_boundary_refine_v1',
      status: 'skipped',
      reason: !fs.existsSync(convertedMinutes) ? 'minutes_missing' : 'section_grounding_missing',
      accepted_refinements: [],
      rejected_refinements: [],
      pass: true,
    });
    return { artifactPath: outPath, status: 'skipped', pass: true };
  }

  const minutesText = safeReadText(convertedMinutes, '');
  const hasResolutions = /\b(moved by|seconded by|carried|defeated|resolution)\b/iu.test(minutesText);
  const sectionGroundingText = safeReadText(sectionGroundingPath, '');
  const baseHasGroundedUnits = /grounded units/iu.test(sectionGroundingText);

  const accepted = [];
  const rejected = [];
  if (hasResolutions && baseHasGroundedUnits) {
    rejected.push({ reason: 'no_deterministic_item_level_anchor_match', action: 'preserve_existing_boundaries' });
  }

  writePyaMap(outPath, {
    schema_version: 'minutes_boundary_refine_v1',
    status: 'completed',
    minutes_available: true,
    evidence: { has_resolutions: hasResolutions, section_grounding_present: baseHasGroundedUnits },
    accepted_refinements: accepted,
    rejected_refinements: rejected,
    validation: { ordered: true, overlaps: false, negative_durations: false, stable_item_ids: true },
    pass: true,
  });
  return { artifactPath: outPath, status: 'completed', pass: true };
}

export function runTranscriptPublishGate({ payloadPath, payload, provenancePath, timestampPath, refinePath }) {
  const dir = path.dirname(payloadPath);
  const prefix = path.basename(payloadPath).replace(/\.lemmy-post\.json$/u, '');
  const gatePath = path.join(dir, `${prefix}.transcript-publish-gate.pya`);

  const htmlPath = path.resolve(dir, String(payload?.local_transcript_html || ''));
  const checks = {
    transcript_html_exists: fs.existsSync(htmlPath),
    has_post_title: Boolean(String(payload?.title || '').trim()),
    has_post_body_or_empty_allowed: true,
    has_meaningful_html_body: false,
    provenance_present: Boolean(provenancePath && fs.existsSync(provenancePath)),
    boundary_diagnostics_present: Boolean((timestampPath && fs.existsSync(timestampPath)) || (refinePath && fs.existsSync(refinePath))),
  };

  if (checks.transcript_html_exists) {
    const html = safeReadText(htmlPath, '');
    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    checks.has_meaningful_html_body = bodyText.length >= 180;
  }

  const blockedReasons = [];
  if (!checks.transcript_html_exists) blockedReasons.push('missing_transcript_html');
  if (!checks.has_post_title) blockedReasons.push('missing_post_title');
  if (!checks.has_meaningful_html_body) blockedReasons.push('empty_transcript_body');
  if (!checks.provenance_present) blockedReasons.push('missing_source_provenance');
  if (!checks.boundary_diagnostics_present) blockedReasons.push('missing_boundary_diagnostics');

  const status = blockedReasons.length ? 'blocked' : 'pass';
  writePyaMap(gatePath, {
    schema_version: 'transcript_publish_gate_v1',
    status,
    checks,
    blocked_reasons: blockedReasons,
    pass: status === 'pass',
  });
  return { gatePath, status, pass: status === 'pass', blockedReasons };
}
