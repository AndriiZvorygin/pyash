import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBasePrefix, deriveNormalizedPrefix } from '../program/library/reporter_shared/prefix-normalization.mjs';

test('sanitizeBasePrefix rejects flag-like prefixes', () => {
  assert.equal(sanitizeBasePrefix('--only', 'meeting-qwen-auto'), 'meeting-qwen-auto');
});

test('deriveNormalizedPrefix appends normalized only once', () => {
  assert.equal(deriveNormalizedPrefix('meeting-qwen-auto-normalized'), 'meeting-qwen-auto-normalized');
});

test('sanitizeBasePrefix keeps canonical meeting prefix', () => {
  assert.equal(sanitizeBasePrefix('meeting-qwen-auto', 'x'), 'meeting-qwen-auto');
});
