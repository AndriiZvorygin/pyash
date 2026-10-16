import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAgendaReportCode,
  hookSourcePolarityUnsupported,
  hookTerminalDateFeedback,
  isClippedContrastHook,
  isGenericPreviewHook,
  rewriteHookWithoutFinancialClaim,
  rewriteHookWithoutPolarityFlip,
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

test('preview hook validation rejects a body-only agenda title', () => {
  assert.equal(isGenericPreviewHook('Community Services Committee Agenda'), true);
  assert.equal(isGenericPreviewHook('Ice Allocation Policy Review'), false);
});

test('hook validation gives the LLM actionable feedback for a terminal calendar term', () => {
  assert.match(
    hookTerminalDateFeedback('Beaver Coyote Bylaw Rates Align January'),
    /remove the date wording/iu,
  );
  assert.equal(hookTerminalDateFeedback('Beaver Coyote Bylaw Rates Align'), '');
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

test('source verifier scopes polarity to the hook topic instead of unrelated transcript complaints', () => {
  const sourceSummary = [
    'Residents described barriers and denied rides for wheelchair-accessible taxi trips.',
    'Parking fees increased revenue during the reporting period.',
  ].join(' ');
  assert.equal(hookSourcePolarityUnsupported('Parking Fees Increase Revenue', sourceSummary), false);
});

test('hook polarity repair asks the LLM to preserve barriers instead of inventing expansion', async () => {
  let prompt = '';
  const repaired = await rewriteHookWithoutPolarityFlip({
    askFn: async (messages) => {
      prompt = String(messages?.[1]?.content || '');
      return 'Wheelchair Taxi Access Barriers';
    },
    sourceSummary: 'Residents described barriers and denied rides for wheelchair-accessible taxi trips.',
    candidateHook: 'Wheelchair Taxis Expand Hospital Service',
    feedback: 'Hook flips source polarity.',
    jurisdiction: 'Owen Sound',
    body: 'Board - River District',
  });
  assert.equal(repaired, 'Wheelchair Taxi Access Barriers');
  assert.match(prompt, /Preserve the source polarity exactly/iu);
  assert.match(prompt, /barriers, denials, exclusion, or lack of access/iu);
});

test('hook financial repair asks the LLM to choose a non-financial source topic', async () => {
  let prompt = '';
  const repaired = await rewriteHookWithoutFinancialClaim({
    askFn: async (messages) => {
      prompt = String(messages?.[1]?.content || '');
      return 'Block Captains Map Changes';
    },
    sourceSummary: 'The board discussed funding and a proposed update to the Block Captains map.',
    candidateHook: 'Funding Surplus Expands Services',
    feedback: 'Financial claim audit did not return a valid structured result.',
    jurisdiction: 'Owen Sound',
    body: 'Board - River District',
  });
  assert.equal(repaired, 'Block Captains Map Changes');
  assert.match(prompt, /Remove financial claims entirely/iu);
  assert.match(prompt, /Choose one concrete non-financial topic/iu);
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
