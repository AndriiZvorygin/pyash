import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('unified writer cli supports transcript-only publish flag wiring', () => {
  const filePath = path.resolve('command/unified-writer-cli.mjs');
  const src = fs.readFileSync(filePath, 'utf8');
  assert.match(src, /--transcript-only/);
  assert.match(src, /publish_transcript_to_helpos_from_payload\.mjs/);
});

test('unified writer cli preserves the shared long-form Stage 3 retry contract', () => {
  const filePath = path.resolve('command/unified-writer-cli.mjs');
  const src = fs.readFileSync(filePath, 'utf8');
  assert.match(src, /AGENDA_STAGE3_OLLAMA_ATTEMPTS = env\.AGENDA_STAGE3_OLLAMA_ATTEMPTS \|\| "9"/u);
  assert.match(src, /AGENDA_STAGE3_OLLAMA_TIMEOUT_MS = env\.AGENDA_STAGE3_OLLAMA_TIMEOUT_MS \|\| "300000"/u);
  assert.match(src, /AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = env\.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS \|\| "1500"/u);
  assert.match(src, /AGENDA_CHAPTER_MAX_SOURCE_CHARS = env\.AGENDA_CHAPTER_MAX_SOURCE_CHARS \|\| "12000"/u);
});
