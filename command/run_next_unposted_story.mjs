#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { isiMeetingVideoIsReachable } from '../program/library/reporter_shared/video-source-availability.mjs';

const DEFAULTS = {
  timezone: process.env.TZ || 'America/Toronto',
  base_prefix: 'meeting-qwen-auto',
  focus: 'the newsworthy juicy and unusual bits',
  jurisdiction: 'auto',
  body: 'auto',
  site_url: 'https://helpos.ca',
  discussion_url: '',
  exec_mxid: '',
  community_name: '',
  transcript_archive_url: '',
  transcript_jurisdiction_slug: '',
};

function parseDotEnvText(src) {
  const out = {};
  const lines = String(src || '').split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFileIfExists(filePath) {
  if (!filePath) return {};
  if (!fs.existsSync(filePath)) return {};
  return parseDotEnvText(fs.readFileSync(filePath, 'utf8'));
}

function loadEnvFallbacks(startDir) {
  const start = path.resolve(startDir);
  const dirs = [];
  let cur = start;
  while (true) {
    dirs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const merged = {};
  for (const dir of dirs.reverse()) {
    Object.assign(merged, readEnvFileIfExists(path.join(dir, '.env')));
  }
  return merged;
}

function usage() {
  return [
    'Usage: node command/run_next_unposted_story.mjs <config.json>',
    'Config keys:',
    '  house_root, monthly_dir, meetings_dir',
    '  refresh_calendar_cmd: ["node", ".../extract-...mjs"]',
    '  run_meeting_from_ref_cmd: ["node", ".../run-...-meeting-from-ref.mjs"]',
    '  send_dm_cmd: ["node", ".../send-executive-dm.mjs"] (optional)',
    '  transcript_archive_url / transcript_jurisdiction_slug (optional remote posted check)',
    '  plus optional defaults: base_prefix, focus, jurisdiction, body, site_url, discussion_url, exec_mxid, community_name, timezone',
  ].join('\n');
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseSeriesLine(line) {
  const m = line.match(/^su name (.+?) since date (\S+) until date (\S+) ob text "(.+)" ya$/u);
  if (!m) return null;
  const [, suName, since, until, escapedJson] = m;
  try {
    const jsonText = JSON.parse(`"${escapedJson}"`);
    const payload = JSON.parse(jsonText);
    return { suName, since, until, payload };
  } catch {
    return null;
  }
}

function parseLocalDate(isoLike) {
  const s = String(isoLike || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(s)) return null;
  const [date, time] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}

function nowLocalDate(timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type, fallback) => parts.find((p) => p.type === type)?.value || fallback;
  return new Date(
    Number(get('year', '1970')),
    Number(get('month', '01')) - 1,
    Number(get('day', '01')),
    Number(get('hour', '00')),
    Number(get('minute', '00')),
    Number(get('second', '00')),
    0,
  );
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'meeting';
}

function inferPrimaryBodySlugFromPayload(payload = {}) {
  const meetingName = String(payload?.meeting_name || '').toLowerCase();
  const meetingType = String(payload?.meeting_type || '').toLowerCase();
  const source = `${meetingName} ${meetingType}`.trim();
  if (!source) return '';
  if (/committee of the whole/.test(source)) return 'committee-of-the-whole';
  if (/committee of adjustment/.test(source)) return 'committee-of-adjustment';
  if (/county council/.test(source)) return 'county-council';
  if (/committee\s*-\s*community services|community services/.test(source)) return 'committee-community-services';
  if (/committee\s*-\s*operations|operations/.test(source)) return 'committee-operations';
  if (/committee\s*-\s*corporate services|corporate services/.test(source)) return 'committee-corporate-services';
  if (/task force/.test(source)) return 'task-force';
  if (/committee/.test(source)) return 'committee';
  if (/council/.test(source)) return 'council';
  return '';
}

function inferBodySlugCandidatesFromPayload(payload = {}, bodyDefault = '') {
  const out = [];
  const add = (s) => {
    if (!s) return;
    const slug = slugify(s);
    if (!out.includes(slug)) out.push(slug);
  };
  const inferred = inferPrimaryBodySlugFromPayload(payload);
  if (inferred) add(inferred);
  if (bodyDefault && bodyDefault !== 'auto') add(bodyDefault);
  // Conservative fallback only when no reliable hint exists.
  if (!out.length) {
    add('county-council');
    add('committee-of-the-whole');
    add('council');
    add('committee');
  }
  return out;
}

function inferFolder(row) {
  const payload = row.payload || {};
  const day = String(row.since || '').slice(0, 10) || 'unknown-day';
  const id = String(payload.meeting_id || 'unknown-id');
  return `${day}_${slugify(payload.meeting_name)}_${id.slice(0, 8)}`;
}

function resolveMeetingDir(row, meetingsDir) {
  const inferredFolder = inferFolder(row);
  const inferredDir = path.join(meetingsDir, inferredFolder);
  if (fs.existsSync(inferredDir)) {
    return { folder: inferredFolder, meetingDir: inferredDir };
  }

  const payload = row.payload || {};
  const day = String(row.since || '').slice(0, 10) || 'unknown-day';
  const id8 = String(payload.meeting_id || 'unknown-id').slice(0, 8);
  if (!fs.existsSync(meetingsDir) || !day || !id8) {
    return { folder: inferredFolder, meetingDir: inferredDir };
  }

  const suffix = `_${id8}`;
  const matches = fs.readdirSync(meetingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name.startsWith(`${day}_`) && name.endsWith(suffix))
    .sort();
  if (matches.length) {
    const folder = matches[matches.length - 1];
    return { folder, meetingDir: path.join(meetingsDir, folder) };
  }

  // Some sources publish timestamps in UTC while their meeting workspace is
  // named from the source's local calendar date. The stable meeting id is a
  // stronger identity than the derived day, so accept a unique cross-day id
  // match instead of writing results into a nonexistent inferred directory.
  const idMatches = fs.readdirSync(meetingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name.endsWith(suffix))
    .sort();
  if (idMatches.length === 1) {
    const folder = idMatches[0];
    return { folder, meetingDir: path.join(meetingsDir, folder) };
  }

  return { folder: inferredFolder, meetingDir: inferredDir };
}

function findPublishResponsePath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return '';
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.meeting-publish.response.json`);
  const files = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith('.meeting-publish.response.json'))
    .sort();
  if (fs.existsSync(direct) && files.includes(path.basename(direct))) {
    return direct;
  }
  if (fs.existsSync(direct)) return direct;
  if (!files.length) return '';
  return path.join(transcriptDir, files[files.length - 1]);
}

function parsePostedFromResponse(respPath) {
  if (!respPath || !fs.existsSync(respPath)) return { posted: false, post_url: '', transcript_url: '' };
  try {
    const json = JSON.parse(fs.readFileSync(respPath, 'utf8'));
    const postUrl = String(json?.post_url || json?.article_url || json?.stream_url || '').trim();
    const transcriptUrl = String(json?.transcript_url || '').trim();
    const err = String(json?.error || '').trim();
    const transcriptPathLike = /\/transcripts\//iu.test(transcriptUrl);
    return {
      posted: Boolean((postUrl || transcriptUrl) && !err),
      posted_transcript: Boolean(transcriptPathLike && !err),
      post_url: postUrl,
      transcript_url: transcriptUrl,
    };
  } catch {
    return { posted: false, posted_transcript: false, post_url: '', transcript_url: '' };
  }
}

function parsePostedFromAgendaResponse(respPath) {
  if (!respPath || !fs.existsSync(respPath)) return { posted: false, post_url: '', agenda_url: '', transcript_url: '' };
  try {
    const json = JSON.parse(fs.readFileSync(respPath, 'utf8'));
    const postUrl = String(json?.post_url || '').trim();
    const agendaUrl = String(json?.agenda_url || '').trim();
    const transcriptUrl = String(json?.transcript_url || '').trim();
    const err = String(json?.error || '').trim();
    return {
      posted: Boolean((postUrl || agendaUrl) && !err),
      posted_agenda: Boolean(/\/agendas\//iu.test(agendaUrl) && !err),
      post_url: postUrl,
      agenda_url: agendaUrl,
      transcript_url: transcriptUrl,
    };
  } catch {
    return { posted: false, posted_agenda: false, post_url: '', agenda_url: '', transcript_url: '' };
  }
}

function parseLocalPostedKinds(meetingDir) {
  const out = { posted_agenda: false, posted_transcript: false };
  const resultPath = path.join(meetingDir, 'next-story.result.json');
  if (!fs.existsSync(resultPath)) return out;
  try {
    const json = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const mode = String(json?.mode || '').trim().toLowerCase();
    if (mode === 'upcoming_agenda') out.posted_agenda = true;
    if (mode === 'past_video') out.posted_transcript = true;
  } catch {
    return out;
  }
  return out;
}

function listPublishResponsePaths(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return [];
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.meeting-publish.response.json`);
  const others = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith('.meeting-publish.response.json'))
    .map((n) => path.join(transcriptDir, n))
    .sort();

  const unique = [];
  const seen = new Set();
  const push = (p) => {
    const key = path.resolve(p);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(p);
  };
  if (fs.existsSync(direct)) push(direct);
  for (const p of others) push(p);
  return unique;
}

function parsePostedFromResponses(transcriptDir, basePrefix) {
  const paths = listPublishResponsePaths(transcriptDir, basePrefix);
  let last = { posted: false, posted_transcript: false, post_url: '', transcript_url: '' };
  let lastPath = '';
  for (const p of paths) {
    const parsed = parsePostedFromResponse(p);
    if (parsed.posted) return { ...parsed, response_path: p };
    last = parsed;
    lastPath = p;
  }
  return { ...last, response_path: lastPath };
}

function normalizeComparableUrl(value) {
  return String(value || "").trim().replace(/\/+$/u, "").toLowerCase();
}

function readPayloadContentType(payloadPath) {
  if (!payloadPath || !fs.existsSync(payloadPath)) return "";
  try {
    const obj = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    return String(obj?.content_type || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function loadAllMeetings(monthlyDir) {
  if (!fs.existsSync(monthlyDir)) return [];
  const files = fs.readdirSync(monthlyDir)
    .filter((n) => n.endsWith('.events.series.pya'))
    .map((n) => path.join(monthlyDir, n))
    .sort();

  const rows = [];
  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === 'prah' || line.startsWith('su name ')) {
        if (!line.includes(' since date ')) continue;
      }
      const row = parseSeriesLine(line);
      if (!row) continue;
      rows.push(row);
    }
  }
  return rows;
}

function findAgendaPublishResponsePath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return '';
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.agenda-publish.response.json`);
  const files = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith('.agenda-publish.response.json'))
    .sort();
  if (fs.existsSync(direct) && files.includes(path.basename(direct))) return direct;
  if (fs.existsSync(direct)) return direct;
  if (!files.length) return '';
  return path.join(transcriptDir, files[files.length - 1]);
}

function meetingState(row, meetingsDir, basePrefix) {
  const { folder, meetingDir } = resolveMeetingDir(row, meetingsDir);
  const transcriptDir = path.join(meetingDir, 'transcript');
  const payloadPath = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.json`);
  const payloadContentType = readPayloadContentType(payloadPath);
  const responsePath = findPublishResponsePath(transcriptDir, basePrefix);
  const postedInfo = parsePostedFromResponses(transcriptDir, basePrefix);
  const agendaResponsePath = findAgendaPublishResponsePath(transcriptDir, basePrefix);
  const agendaPostedInfo = parsePostedFromAgendaResponse(agendaResponsePath);
  const sameDiscussionPostForAgendaAndTranscript =
    normalizeComparableUrl(postedInfo.post_url)
    && normalizeComparableUrl(postedInfo.post_url) === normalizeComparableUrl(agendaPostedInfo.post_url);
  const localKinds = parseLocalPostedKinds(meetingDir);
  const postedTranscriptByMeetingPublish = Boolean(postedInfo.posted_transcript) && !sameDiscussionPostForAgendaAndTranscript;
  const postedAgendaByLegacyMeetingPublish = Boolean(postedInfo.posted && payloadContentType === "agenda");
  const hasResponseArtifacts = Boolean((postedInfo.response_path || '').trim() || agendaResponsePath);
  const postedAgendaFromResult = !hasResponseArtifacts && localKinds.posted_agenda;
  const postedTranscriptFromResult = !hasResponseArtifacts && localKinds.posted_transcript;
  const payload = row.payload || {};
  const agendaCount = Array.isArray(payload.agenda) ? payload.agenda.length : 0;
  const agendaCoverCount = Array.isArray(payload.agenda_cover) ? payload.agenda_cover.length : 0;
  const minutesCount = Array.isArray(payload.minutes) ? payload.minutes.length : 0;
  // Typical eScribe upcoming meetings expose one agenda PDF plus one agenda HTML link.
  // Treat only *additional* agenda docs (beyond that pair) and minutes as supporting docs.
  const supportDocCount = Math.max(0, agendaCount - 2) + minutesCount;

  return {
    row,
    folder,
    meeting_dir: meetingDir,
    transcript_dir: transcriptDir,
    payload_path: payloadPath,
    response_path: postedInfo.response_path || responsePath,
    posted: postedTranscriptByMeetingPublish || agendaPostedInfo.posted,
    posted_local: postedTranscriptByMeetingPublish,
    posted_local_any: postedTranscriptByMeetingPublish || agendaPostedInfo.posted,
    posted_local_agenda: postedAgendaFromResult || agendaPostedInfo.posted || postedAgendaByLegacyMeetingPublish,
    // Treat successful transcript publish responses as canonical local transcript state.
    // next-story.result.json may be missing or stale when runs were done via direct commands.
    posted_local_transcript: postedTranscriptFromResult || postedTranscriptByMeetingPublish,
    posted_agenda: postedAgendaFromResult || agendaPostedInfo.posted || postedAgendaByLegacyMeetingPublish,
    posted_transcript: postedTranscriptFromResult || postedTranscriptByMeetingPublish,
    posted_remote: false,
    posted_remote_agenda: false,
    posted_remote_transcript: false,
    publish_post_collision: Boolean(sameDiscussionPostForAgendaAndTranscript),
    post_url: postedInfo.post_url || agendaPostedInfo.post_url,
    transcript_url: postedInfo.transcript_url,
    has_agenda: agendaCount > 0,
    has_video: Array.isArray(payload.video) && payload.video.length > 0,
    agenda_count: agendaCount,
    agenda_cover_count: agendaCoverCount,
    minutes_count: minutesCount,
    support_doc_count: supportDocCount,
    has_supporting_docs: supportDocCount > 0,
    since_date: parseLocalDate(row.since),
  };
}

function eligibleUpcomingAgendaStates(states, timezone, cfg = {}) {
  const now = nowLocalDate(timezone);
  const notPosted = states
    .filter((s) => !s.posted_agenda && s.since_date instanceof Date)
    // Cron "next" should only create brand-new meeting outputs.
    // If transcript was already published for this meeting, do not pick it again.
    .filter((s) => !s.posted_transcript);
  const requireSupportingDocs = /^(1|true|yes)$/iu.test(String(cfg.require_upcoming_supporting_docs || "0"));
  return notPosted
    .filter((s) => {
      if (s.since_date < now) return false;
      if (!s.has_agenda) return false;
      if (requireSupportingDocs && !s.has_supporting_docs) return false;
      return true;
    })
    .sort((a, b) => a.since_date - b.since_date);
}

function pickCandidate(states, timezone, cfg = {}) {
  const now = nowLocalDate(timezone);
  const notPostedPastVideo = states.filter((s) => !s.posted_transcript && s.since_date instanceof Date);

  const pastWithVideo = notPostedPastVideo
    .filter((s) => s.has_video && s.since_date < now)
    .sort((a, b) => b.since_date - a.since_date);
  const recentPastMaxAgeDays = Math.max(0, Number(cfg.prefer_past_video_max_age_days || 14));
  const recentPastCutoff = new Date(now.getTime() - recentPastMaxAgeDays * 24 * 60 * 60 * 1000);
  const recentPastWithVideo = pastWithVideo.filter((s) => s.since_date >= recentPastCutoff);

  const upcomingWithAgenda = eligibleUpcomingAgendaStates(states, timezone, cfg);
  const imminentAgendaDays = Math.max(0, Number(cfg.imminent_agenda_priority_days || 7));
  const imminentAgendaCutoff = new Date(now.getTime() + imminentAgendaDays * 24 * 60 * 60 * 1000);
  const imminentUpcomingWithAgenda = upcomingWithAgenda.filter((s) => s.since_date <= imminentAgendaCutoff);
  const laterUpcomingWithAgenda = upcomingWithAgenda.filter((s) => s.since_date > imminentAgendaCutoff);
  const preferPastVideo = !/^(0|false|no)$/iu.test(String(cfg.prefer_past_video_before_agenda || "1"));
  if (imminentUpcomingWithAgenda.length) return { mode: 'upcoming_agenda', state: imminentUpcomingWithAgenda[0] };
  if (preferPastVideo && recentPastWithVideo.length) return { mode: 'past_video', state: recentPastWithVideo[0] };
  if (laterUpcomingWithAgenda.length) return { mode: 'upcoming_agenda', state: laterUpcomingWithAgenda[0] };
  if (pastWithVideo.length) return { mode: 'past_video', state: pastWithVideo[0] };

  return null;
}

async function urlExists(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (head.status >= 200 && head.status < 300) return true;
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
      return get.status >= 200 && get.status < 300;
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchPageKind(url, cache) {
  const key = `kind:${url}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      cache.set(key, 'none');
      return 'none';
    }
    const html = String(await res.text() || '').toLowerCase();
    const transcriptSignals = [
      'full transcript',
      'jump to transcript',
      'discussion',
      '00:00:',
    ];
    const agendaSignals = [
      'original agenda package links',
      'most newsworthy agenda items',
      'whole agenda summary',
      'read full agenda archive',
    ];
    const lowerUrl = String(url || '').toLowerCase();
    let transcriptHits = transcriptSignals.reduce((acc, token) => acc + (html.includes(token) ? 1 : 0), 0);
    let agendaHits = agendaSignals.reduce((acc, token) => acc + (html.includes(token) ? 1 : 0), 0);
    // URL path is authoritative for content type.
    // Transcript pages can legitimately include agenda-related sections/links.
    if (lowerUrl.includes('/transcripts/')) {
      cache.set(key, 'transcript');
      return 'transcript';
    }
    if (lowerUrl.includes('/agendas/')) {
      cache.set(key, 'agenda');
      return 'agenda';
    }
    const kind = transcriptHits >= agendaHits && transcriptHits > 0
      ? 'transcript'
      : (agendaHits > 0 ? 'agenda' : 'unknown');
    cache.set(key, kind);
    return kind;
  } catch {
    cache.set(key, 'none');
    return 'none';
  }
}

async function isPostedByDirectTranscriptProbe(state, cfg, cache) {
  const site = String(cfg.site_url || '').replace(/\/+$/u, '');
  if (!site) return false;
  const jurisdictionSlug = slugify(cfg.transcript_jurisdiction_slug || cfg.jurisdiction || '');
  const dateIso = parseDateIsoFromSince(state?.row?.since);
  if (!jurisdictionSlug || !dateIso) return false;

  const payload = state?.row?.payload || {};
  const bodySlugs = inferBodySlugCandidatesFromPayload(payload, cfg.body);
  for (const bodySlug of bodySlugs) {
    const transcriptUrl = `${site}/transcripts/${jurisdictionSlug}/${bodySlug}/${dateIso}`;
    const agendaUrl = `${site}/agendas/${jurisdictionSlug}/${bodySlug}/${dateIso}`;
    const transcriptKey = `transcript:${transcriptUrl}`;
    const agendaKey = `agenda:${agendaUrl}`;

    if (!cache.has(transcriptKey)) {
      cache.set(transcriptKey, await urlExists(transcriptUrl));
    }
    if (!cache.has(agendaKey)) {
      cache.set(agendaKey, await urlExists(agendaUrl));
    }

    if (cache.get(transcriptKey)) {
      const kind = await fetchPageKind(transcriptUrl, cache);
      if (kind === 'agenda') return { posted_transcript: false, posted_agenda: true };
      if (kind === 'transcript') return { posted_transcript: true, posted_agenda: false };
      return { posted_transcript: true, posted_agenda: true };
    }
    if (cache.get(agendaKey)) return { posted_transcript: false, posted_agenda: true };
  }
  return { posted_transcript: false, posted_agenda: false };
}

async function pickCandidateWithRemoteProbe(states, timezone, cfg) {
  const picked = pickCandidate(states, timezone, cfg);
  if (!picked) return null;

  const now = nowLocalDate(timezone);
  const upcomingWithAgenda = states
    .filter((s) => s.since_date instanceof Date)
    .filter((s) => s.since_date >= now && s.has_agenda)
    .sort((a, b) => a.since_date - b.since_date)
    .map((s) => ({ mode: 'upcoming_agenda', state: s }));
  const pastWithVideo = states
    .filter((s) => s.since_date instanceof Date)
    .filter((s) => s.has_video && s.since_date < now)
    .sort((a, b) => b.since_date - a.since_date)
    .map((s) => ({ mode: 'past_video', state: s }));
  const preferPastVideo = !/^(0|false|no)$/iu.test(String(cfg.prefer_past_video_before_agenda || "1"));
  const recentPastMaxAgeDays = Math.max(0, Number(cfg.prefer_past_video_max_age_days || 14));
  const recentPastCutoff = new Date(now.getTime() - recentPastMaxAgeDays * 24 * 60 * 60 * 1000);
  const recentPastWithVideo = pastWithVideo.filter((c) => c.state.since_date >= recentPastCutoff);
  const stalePastWithVideo = pastWithVideo.filter((c) => c.state.since_date < recentPastCutoff);
  const imminentAgendaDays = Math.max(0, Number(cfg.imminent_agenda_priority_days || 7));
  const imminentAgendaCutoff = new Date(now.getTime() + imminentAgendaDays * 24 * 60 * 60 * 1000);
  const imminentUpcomingWithAgenda = upcomingWithAgenda.filter((c) => c.state.since_date <= imminentAgendaCutoff);
  const laterUpcomingWithAgenda = upcomingWithAgenda.filter((c) => c.state.since_date > imminentAgendaCutoff);
  const ordered = preferPastVideo
    ? [...imminentUpcomingWithAgenda, ...recentPastWithVideo, ...laterUpcomingWithAgenda, ...stalePastWithVideo]
    : [...upcomingWithAgenda, ...pastWithVideo];
  const cache = new Map();

  for (const candidate of ordered) {
    // Local publish artifacts are the primary source of truth for whether this
    // house has already posted this meeting. Remote probes are only for
    // locally-unposted rows (to catch external/manual publishes).
    if (candidate.mode === 'upcoming_agenda' && candidate.state.posted_agenda) {
      continue;
    }
    if (candidate.mode === 'past_video' && candidate.state.posted_transcript) {
      continue;
    }
    if (candidate.mode === 'upcoming_agenda' && candidate.state.posted_transcript) {
      continue;
    }

    const directPosted = await isPostedByDirectTranscriptProbe(candidate.state, cfg, cache);
    // If transcript URL probing fails (moved/cleaned page), but we have a
    // confirmed local transcript publish response and the discussion post URL
    // is still live, treat transcript as already posted to avoid duplicate picks.
    if (!directPosted.posted_transcript && candidate.mode === 'past_video') {
      const localPostUrl = String(candidate?.state?.post_url || '').trim();
      const locallyMarkedTranscript = Boolean(candidate?.state?.posted_local_transcript);
      if (locallyMarkedTranscript && localPostUrl) {
        const postKey = `post:${localPostUrl}`;
        if (!cache.has(postKey)) {
          cache.set(postKey, await urlExists(localPostUrl));
        }
        if (cache.get(postKey)) {
          directPosted.posted_transcript = true;
        }
      }
    }
    // Remote probe is used only as a secondary check for locally-unposted rows.
    const blocksCandidate = candidate.mode === 'upcoming_agenda'
      ? directPosted.posted_agenda
      : directPosted.posted_transcript;
    if (blocksCandidate) continue;
    if (candidate.mode === 'upcoming_agenda') {
      if (candidate.state.posted_agenda) continue;
      const requireSupportingDocs = /^(1|true|yes)$/iu.test(String(cfg.require_upcoming_supporting_docs || "0"));
      if (!candidate.state.has_agenda) continue;
      if (requireSupportingDocs && !candidate.state.has_supporting_docs) continue;
    }
    if (candidate.mode === 'past_video' && !candidate.state.has_video) continue;
    if (candidate.mode === 'past_video' && !await isiMeetingVideoIsReachable(candidate.state?.row?.payload || {})) {
      log(`[next-story] skipping unavailable ISI recording: ${candidate.state?.row?.payload?.meeting_id || candidate.state?.row?.suName || "unknown"}`);
      continue;
    }
    return candidate;
  }
  return null;
}

function parseDateIsoFromSince(since) {
  return String(since || '').slice(0, 10);
}

function extractTranscriptBodyDateKeysFromArchiveHtml(html, jurisdictionSlug) {
  const slug = String(jurisdictionSlug || '').trim().toLowerCase();
  const src = String(html || '');
  const out = new Set();
  const re = /\/transcripts\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})/giu;
  let m;
  while ((m = re.exec(src)) !== null) {
    const j = String(m[1] || '').toLowerCase();
    const body = String(m[2] || '').toLowerCase();
    const d = String(m[3] || '');
    if (!body || !d) continue;
    if (slug && j !== slug) continue;
    out.add(`${body}|${d}`);
  }
  return out;
}

async function fetchRemotePostedKeys(cfg) {
  const archiveUrl = String(cfg.transcript_archive_url || '').trim();
  if (!archiveUrl) return new Set();
  try {
    const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return new Set();
    const html = await res.text();
    return extractTranscriptBodyDateKeysFromArchiveHtml(html, cfg.transcript_jurisdiction_slug);
  } catch {
    return new Set();
  }
}

function mergeRemotePosted(states, remotePostedKeys, cfg = {}) {
  if (!remotePostedKeys || remotePostedKeys.size === 0) return states;
  return states.map((s) => {
    const iso = parseDateIsoFromSince(s?.row?.since);
    const payload = s?.row?.payload || {};
    const bodySlugs = inferBodySlugCandidatesFromPayload(payload, cfg.body);
    const remotePostedAny = Boolean(
      iso && bodySlugs.some((bodySlug) => remotePostedKeys.has(`${bodySlug}|${iso}`))
    );
    if (!remotePostedAny) return s;
    return {
      ...s,
      posted_remote: true,
      posted_remote_any: true,
    };
  });
}

function runWithStreaming({ cmd, args, cwd, env = {}, timeoutMs = 60 * 60 * 1000, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const t = String(chunk || '');
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on('data', (chunk) => {
      const t = String(chunk || '');
      stderr += t;
      process.stderr.write(t);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(10_000, Number(timeoutMs) || 10_000));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? 'null'} signal=${signal ?? ''})\n${stderr || stdout}`.trim()));
    });
  });
}

async function maybeNotify(cfg, execMxid, message) {
  const dm = Array.isArray(cfg.send_dm_cmd) ? cfg.send_dm_cmd : [];
  if (!dm.length) return;
  try {
    await runWithStreaming({
      cmd: dm[0],
      args: [...dm.slice(1), execMxid, message],
      cwd: cfg.house_root,
      timeoutMs: 2 * 60 * 1000,
      label: 'notify-dm',
    });
  } catch (err) {
    process.stderr.write(`[next-story] dm notification failed: ${String(err?.message || err)}\n`);
  }
}

function ensureString(value, name) {
  const v = String(value || '').trim();
  if (!v) throw new Error(`config missing required string: ${name}`);
  return v;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const cfgRaw = readJson(path.resolve(process.cwd(), configPath));
  const cfg = { ...DEFAULTS, ...cfgRaw };
  const envFallback = loadEnvFallbacks(process.cwd());

  cfg.house_root = ensureString(cfg.house_root, 'house_root');
  cfg.monthly_dir = ensureString(cfg.monthly_dir, 'monthly_dir');
  cfg.meetings_dir = ensureString(cfg.meetings_dir, 'meetings_dir');
  if (!Array.isArray(cfg.refresh_calendar_cmd) || !cfg.refresh_calendar_cmd.length) {
    throw new Error('config missing refresh_calendar_cmd array');
  }
  if (!Array.isArray(cfg.run_meeting_from_ref_cmd) || !cfg.run_meeting_from_ref_cmd.length) {
    throw new Error('config missing run_meeting_from_ref_cmd array');
  }

  const pickOnly = /^(1|true|yes)$/iu.test(String(process.env.NEXT_STORY_PICK_ONLY || process.env.OWEN_NEXT_STORY_PICK_ONLY || '0'));
  const diarizeOnly = /^(1|true|yes)$/iu.test(String(process.env.NEXT_STORY_DIARIZE_ONLY || process.env.OWEN_NEXT_STORY_DIARIZE_ONLY || '0'));
  const skipRefresh = /^(1|true|yes)$/iu.test(String(process.env.NEXT_STORY_SKIP_REFRESH || process.env.OWEN_SKIP_MONTHLY_REFRESH || '0'));

  if (!process.env.MEETING_PUBLISH_AUTH_TOKEN) {
    const token = String(envFallback.MEETING_PUBLISH_AUTH_TOKEN || '').trim();
    if (token) process.env.MEETING_PUBLISH_AUTH_TOKEN = token;
  }
  if (!process.env.MEETING_PUBLISH_COMMUNITY_NAME) {
    const communityName = String(envFallback.MEETING_PUBLISH_COMMUNITY_NAME || cfg.community_name || '').trim();
    if (communityName) process.env.MEETING_PUBLISH_COMMUNITY_NAME = communityName;
  }

  if (skipRefresh) {
    log('[next-story] skip calendar refresh (NEXT_STORY_SKIP_REFRESH=1)');
  } else {
    log('[next-story] refreshing calendar cache');
    await runWithStreaming({
      cmd: cfg.refresh_calendar_cmd[0],
      args: cfg.refresh_calendar_cmd.slice(1),
      cwd: cfg.house_root,
      timeoutMs: 5 * 60 * 1000,
      label: 'refresh-calendar',
    });
  }

  const rows = loadAllMeetings(cfg.monthly_dir);
  if (!rows.length) throw new Error('no meetings in monthly cache');

  const localStates = rows.map((row) => meetingState(row, cfg.meetings_dir, cfg.base_prefix));
  const remotePostedKeys = await fetchRemotePostedKeys(cfg);
  if (remotePostedKeys.size > 0) {
    log(`[next-story] remote transcript body/date keys found: ${remotePostedKeys.size}`);
  }
  const states = mergeRemotePosted(localStates, remotePostedKeys, cfg);
  const picked = await pickCandidateWithRemoteProbe(states, cfg.timezone, cfg);
  const execMxid = cfg.exec_mxid;

  if (!picked) {
    log('[next-story] no unposted candidate found');
    await maybeNotify(cfg, execMxid, '[reporter] No unposted meeting candidate found (upcoming agenda or past video).');
    return;
  }

  const { mode, state } = picked;
  const payload = state.row.payload || {};
  const meetingRef = String(payload.meeting_id || payload.meeting_url || '').trim();
  if (!meetingRef) throw new Error('picked meeting has no meeting_id or meeting_url');

  log(`[next-story] picked mode: ${mode}`);
  log(`[next-story] meeting: ${payload.meeting_name || '(unknown)'} (${state.row.since})`);
  log(`[next-story] ref: ${meetingRef}`);

  if (pickOnly) {
    const pickPath = path.join(state.meeting_dir, 'next-story.pick.json');
    fs.mkdirSync(state.meeting_dir, { recursive: true });
    fs.writeFileSync(pickPath, `${JSON.stringify({
      mode,
      meeting_id: String(payload.meeting_id || ''),
      meeting_name: String(payload.meeting_name || ''),
      since: state.row.since,
      meeting_url: String(payload.meeting_url || ''),
      meeting_dir: state.meeting_dir,
      generated_at_utc: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    log(`[next-story] pick-only mode, wrote: ${pickPath}`);
    return;
  }

  if (!diarizeOnly && !String(process.env.MEETING_PUBLISH_AUTH_TOKEN || '').trim()) {
    throw new Error('MEETING_PUBLISH_AUTH_TOKEN is missing (.env or env var) for non-pick runs');
  }

  const env = {
    ...process.env,
    PYA_COMMAND_TIMEOUT_MS: process.env.PYA_COMMAND_TIMEOUT_MS || '28800000',
    OWEN_PIPELINE_DIARIZE_ONLY: diarizeOnly ? '1' : (process.env.OWEN_PIPELINE_DIARIZE_ONLY || '0'),
    OWEN_PIPELINE_SKIP_IMAGE: process.env.OWEN_PIPELINE_SKIP_IMAGE || process.env.PIPELINE_SKIP_IMAGE || '0',
    OWEN_PIPELINE_SKIP_LEMMY: process.env.OWEN_PIPELINE_SKIP_LEMMY || process.env.PIPELINE_SKIP_POST || '0',
    OWEN_PIPELINE_FORCE: process.env.OWEN_PIPELINE_FORCE || process.env.PIPELINE_FORCE || '0',
    MEETING_PUBLISH_COMMUNITY_NAME: process.env.MEETING_PUBLISH_COMMUNITY_NAME || cfg.community_name || '',
  };

  if (diarizeOnly) {
    env.OWEN_PIPELINE_SKIP_IMAGE = '1';
    env.OWEN_PIPELINE_SKIP_LEMMY = '1';
  }

  const postCmd = String(
    process.env.MEETING_POST_COMMAND
    || process.env.OWEN_LEMMY_POST_COMMAND
    || ''
  ).trim();
  if (postCmd) {
    env.OWEN_LEMMY_POST_COMMAND = postCmd;
  } else {
    env.OWEN_LEMMY_POST_COMMAND = `node ${path.join(cfg.house_root, 'program/publish-meeting-to-helpos-from-payload.mjs')}`;
  }

  await runWithStreaming({
    cmd: cfg.run_meeting_from_ref_cmd[0],
    args: [
      ...cfg.run_meeting_from_ref_cmd.slice(1),
      meetingRef,
      cfg.base_prefix,
      cfg.focus,
      cfg.jurisdiction,
      cfg.body,
      cfg.site_url,
      cfg.discussion_url,
    ],
    cwd: cfg.house_root,
    env,
    timeoutMs: 8 * 60 * 60 * 1000,
    label: 'run-meeting',
  });

  const responsePath = findPublishResponsePath(state.transcript_dir, cfg.base_prefix);
  const agendaResponsePath = findAgendaPublishResponsePath(state.transcript_dir, cfg.base_prefix);
  const postedInfo = mode === 'upcoming_agenda'
    ? {
        ...parsePostedFromAgendaResponse(agendaResponsePath),
        response_path: agendaResponsePath,
      }
    : parsePostedFromResponses(state.transcript_dir, cfg.base_prefix);
  const summaryPath = path.join(state.meeting_dir, 'next-story.result.json');

  fs.writeFileSync(summaryPath, `${JSON.stringify({
    mode,
    meeting_id: String(payload.meeting_id || ''),
    meeting_name: String(payload.meeting_name || ''),
    since: state.row.since,
    meeting_url: String(payload.meeting_url || ''),
    meeting_dir: state.meeting_dir,
    transcript_dir: state.transcript_dir,
    payload_path: path.join(state.transcript_dir, `${cfg.base_prefix}-normalized.lemmy-post.json`),
    response_path: postedInfo.response_path || responsePath,
    post_url: postedInfo.post_url,
    agenda_url: postedInfo.agenda_url || '',
    transcript_url: postedInfo.transcript_url,
    posted: postedInfo.posted,
    generated_at_utc: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  const dmLines = [
    `[reporter] Posted: ${payload.meeting_name || '(unknown meeting)'}`,
    `Date: ${state.row.since}`,
    postedInfo.post_url ? `Post: ${postedInfo.post_url}` : 'Post: (not found in response)',
    postedInfo.agenda_url ? `Agenda: ${postedInfo.agenda_url}` : '',
    postedInfo.transcript_url ? `Transcript: ${postedInfo.transcript_url}` : 'Transcript: (not found in response)',
    `Meeting dir: ${state.meeting_dir}`,
  ].filter(Boolean);
  if (!postedInfo.posted) dmLines.unshift('[reporter] Run finished but publish confirmation was not found.');

  await maybeNotify(cfg, execMxid, dmLines.join('\n'));
}

main().catch(async (err) => {
  const msg = String(err?.stack || err?.message || err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
