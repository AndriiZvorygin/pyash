import test from 'node:test';
import assert from 'node:assert/strict';

import { hookSourcePolarityUnsupported } from '../command/generate_meeting_hook_from_transcript_folder.mjs';

test('source verifier blocks positive-service hook when source describes access barriers', () => {
  const sourceSummary = [
    'Residents described barriers getting wheelchair-accessible taxi service for hospital visits.',
    'Several said they were denied rides and were unable to access service when needed.',
  ].join(' ');
  const hook = 'Wheelchair Taxis Now Serve Hospital Visits';
  assert.equal(hookSourcePolarityUnsupported(hook, sourceSummary), true);
});

test('source verifier allows positive-service hook when source explicitly confirms approved expansion', () => {
  const sourceSummary = [
    'Council approved expanded service for wheelchair-accessible taxis after months of complaints.',
    'The service expansion approved includes hospital-trip availability.',
  ].join(' ');
  const hook = 'Wheelchair Taxis Expand Hospital Service';
  assert.equal(hookSourcePolarityUnsupported(hook, sourceSummary), false);
});

test('source verifier blocks positive-service hook when source uses exclusion framing', () => {
  const sourceSummary = 'Residents described the exclusion of wheelchair users from non-emergency taxi trips to hospitals.';
  const hook = 'Wheelchair Taxis Serve Hospital Trips';
  assert.equal(hookSourcePolarityUnsupported(hook, sourceSummary), true);
});
