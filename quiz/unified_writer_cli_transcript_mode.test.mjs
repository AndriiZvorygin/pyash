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
