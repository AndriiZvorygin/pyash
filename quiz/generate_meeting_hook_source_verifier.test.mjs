import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAgendaReportCode,
  hookSourcePolarityUnsupported,
  isClippedContrastHook,
  stripAgendaReportCodes,
  selectHookGenerationSource,
} from '../command/generate_meeting_hook_from_transcript_folder.mjs';

test('hook validation recognizes and removes municipality report identifiers', () => {
  const title = 'CSR-CS-19-26 Garafraxa Non-Profit Homes Emergency Repairs Funding Request';
  assert.equal(hasAgendaReportCode(title), true);
  assert.equal(stripAgendaReportCodes(title), 'Garafraxa Non-Profit Homes Emergency Repairs Funding Request');
  assert.equal(hasAgendaReportCode('Csr-cs-19-26 Garafraxa Non-profit Homes'), true);
});

test('hook validation rejects headings clipped at a terminal preposition', () => {
  assert.equal(isClippedContrastHook('Year Deputation Summerfolk Boardwalk Against'), true);
  assert.equal(isClippedContrastHook('Boardwalk Accessibility Options Reviewed'), false);
});

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

test('hook generation source retains substantive late-meeting developments', () => {
  const early = [
    "The committee opened the meeting.",
    "No declarations of interest were recorded.",
    "The prior minutes were confirmed.",
  ].join(" ");
  const late = "Staff presented a cybersecurity policy that replaces three outdated technology policies.";
  assert.match(selectHookGenerationSource(`${early} ${late}`), /cybersecurity policy/u);
});
