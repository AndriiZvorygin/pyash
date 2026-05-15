import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSourceProvenance,
  extractAgendaTimestampBoundaries,
  refineBoundariesWithMinutes,
  runTranscriptPublishGate,
} from '../program/library/reporter_shared/transcript_reliability.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-rel-'));
}

test('source provenance records official and mirror links', () => {
  const root = mkTmp();
  const meetingDir = path.join(root, 'meeting');
  const transcriptDir = path.join(meetingDir, 'transcript');
  fs.mkdirSync(path.join(meetingDir, 'source'), { recursive: true });
  fs.mkdirSync(path.join(meetingDir, 'converted', 'subreports'), { recursive: true });
  fs.writeFileSync(path.join(meetingDir, 'source', 'agenda-01.pdf'), 'x');
  fs.writeFileSync(path.join(meetingDir, 'converted', 'agenda-01.md'), '# agenda');
  fs.writeFileSync(path.join(meetingDir, 'converted', 'subreports', 'a.md'), 'detail');
  fs.mkdirSync(transcriptDir, { recursive: true });

  const out = buildSourceProvenance({
    meetingDir,
    transcriptDir,
    prefix: 't',
    payload: { source: { agenda_pdf_url: 'https://example/agenda.pdf' } },
  });
  assert.equal(fs.existsSync(out.artifactPath), true);
  const txt = fs.readFileSync(out.artifactPath, 'utf8');
  assert.match(txt, /official_source_links/);
  assert.match(txt, /mirror_source_links/);
});

test('timestamp extraction parses deterministic suffix timestamps', () => {
  const root = mkTmp();
  const meetingDir = path.join(root, 'meeting');
  const transcriptDir = path.join(meetingDir, 'transcript');
  fs.mkdirSync(path.join(meetingDir, 'converted'), { recursive: true });
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(path.join(meetingDir, 'converted', 'agenda-01.md'), '8.a.1 Report CR-26-043 00:12\n8.b.1 Report CR-26-044 00:44\n');
  const out = extractAgendaTimestampBoundaries({ meetingDir, transcriptDir, prefix: 't', transcriptDurationSeconds: 4000 });
  assert.equal(out.boundaries.length, 2);
  assert.equal(fs.existsSync(out.artifactPath), true);
});

test('minutes refinement skips cleanly when minutes missing', () => {
  const root = mkTmp();
  const meetingDir = path.join(root, 'meeting');
  const transcriptDir = path.join(meetingDir, 'transcript');
  fs.mkdirSync(transcriptDir, { recursive: true });
  const out = refineBoundariesWithMinutes({ meetingDir, transcriptDir, prefix: 't' });
  assert.equal(out.status, 'skipped');
  assert.equal(fs.existsSync(out.artifactPath), true);
});

test('publish gate blocks missing transcript html', () => {
  const root = mkTmp();
  const payloadPath = path.join(root, 'x.lemmy-post.json');
  const payload = { title: 'Title', local_transcript_html: 'missing.html' };
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  const out = runTranscriptPublishGate({ payloadPath, payload, provenancePath: '', timestampPath: '', refinePath: '' });
  assert.equal(out.pass, false);
  assert.match(out.blockedReasons.join(','), /missing_transcript_html/);
});
