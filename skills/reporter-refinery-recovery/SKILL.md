---
name: reporter-refinery-recovery
description: Diagnose and repair failed Andrii YouTube, Owen Sound, or Grey County scheduled reporter pipelines from refinery-watchdog incidents, then verify publication without meeting-specific or deterministic prose fallbacks.
---

# Reporter Refinery Recovery

Use this skill only for incidents produced by `world/house/refinery-watchdog/` or an explicit request to repair one of its reporter pipelines.

1. Read `/home/htaf/pyash/AGENTS.md` and `documentation/runbooks/reporter-refinery-recovery.md` completely.
2. Read the incident JSON and logs named by the task before running or editing anything.
3. Check `/tmp/municipal-reporter-pipeline.lock` and the three reporter cron locks. Never overlap GPU-heavy work.
4. Reproduce the narrow failure, implement a general fix, run targeted tests, and rerun only affected reporters.
5. Verify the HelpOS or stream publication independently. Return the structured recovery result requested by the caller.

For eScribe incidents, keep structured HTML identity authoritative: validate that the canonical item sequence is monotonic and do not let PDF-only inferred identities reorder it. Treat player metadata as a lead rather than proof that media exists; probe the embedded media URL before selecting an old meeting. If an ASR row is too large to preserve agenda transitions, an LLM may split it only into validated verbatim spans whose normalized concatenation exactly reproduces the source.

When Stage 3 fails after partial generation, check both transport availability and the grounding contract before rerunning. Model-specific generation retries should own Ollama availability; a separate single-shot `/api/tags` preflight can create a false-negative failure during a brief LAN flap. For agenda previews, split every oversized attachment block into bounded, lossless source chunks before Stage 3 and verify their normalized concatenation reproduces the complete source.

When chronology segmentation repeatedly returns length-truncated JSON, do not retry the same oversized request unchanged. Keep the complete chronology, but split it into smaller overlapping LLM windows and retain strict literal-evidence validation; bounded output-token growth is a secondary retry, not a substitute for lossless input chunking.

Numeric grounding must compare Arabic output with both Arabic and spoken-number source forms. At whole-meeting synthesis, validate against every source exposed to generation, including ranked candidates and authoritative meeting metadata. A bounded LLM retry loop must apply the complete downstream output contract before returning so malformed one-sentence prose remains retryable inside generation.

Require an explicit semantic coverage check for every chronology chunk in whole-meeting output. An aggregate reviewer score alone can hide an omitted early or late topic.

Treat semantic-review failures as allegations to adjudicate against the literal source before discarding grounded prose. Accept common final-score labels, and audit final coverage one chronology chunk at a time so a model cannot collapse a large aggregate JSON review.

Keep structured eScribe parent headings and attachment labels available as authoritative role evidence for child items. Civic sentence splitting must preserve abbreviations such as `No.` in agenda identities. When qwen repeats a shape, role, or numeric defect, vary the retry instruction and include the rejection reason or rejected prose; do not repeat an identical prompt.

When a per-item recap repeatedly copies article-level meeting-date metadata from its source, make the retry delete the exact date phrase and begin directly with the substantive action or topic. Do not simultaneously tell that retry to preserve every grounded detail, because that conflicts with the metadata exclusion and can lock qwen into the rejected shape.

When a blind boundary audit classifies a different canonical item and the literal transcript directly supports that competing structured title, preserve the blind classification. Do not let a later proposal-biased recovery audit force the boundary back onto the original item; this is especially important for explicit transitions such as public forum, correspondence, bylaws, and adjournment.

Focused boundary recovery must independently search the broad preceding chronology for the earliest Qwen-grounded handoff or presenter start. Compare ownership on the proposed atomic unit itself so an adjacent target transition cannot erase a competing structured identity; ignore generic municipal-body words when comparing titles. If a provisional boundary names the preceding canonical item, allow a bounded forward correction to the immediately following target transition. Bind the identity from the single structured target rather than trusting a model that copies the JSON `ITEM` placeholder.

If whole-meeting prose repeatedly invents named actors after varied grounded revision attempts, carry every rejected name into the next audit and switch to a fresh source-grounded no-personal-name synthesis. Do not revise the contaminated draft indefinitely or relax actor grounding.

If a synthesis format requires exact authoritative headings, exclude those heading labels from prose-only actor-name checks. Continue rejecting named councillors in generated prose, but do not create an impossible contract by simultaneously requiring and forbidding a name embedded in the canonical heading.

Keep bounded-generation contracts canonical across the retry loop and every downstream artifact gate. When a complete multi-topic teaser consistently exceeds a narrow cosmetic word target, preserve chronology and grounding with one shared reasonable limit rather than letting producer and consumer validators diverge.

For hybrid PDFs, classify native text that contains only the current printed page number as pagination, not failed scan OCR. Keep substantive scan-only pages retryable, and never treat a short non-pagination OCR response as complete attachment text.

Combined recordings require both meeting-scope edges. After locating the target start, use Qwen with literal handoff or named-call-to-order evidence to exclude a following separate meeting. References to committees, appointments, reports, closed items, or minutes in the canonical agenda do not establish that another live meeting began.

Independently audit the named identity of the proposed meeting start. An explicit County Council opening is not a Committee of the Whole opening merely because both meetings use overlapping agenda numbers. Within the accepted target scope, preserve Qwen-grounded out-of-order returns to pulled consent items, and make independently refined focused boundaries outrank later complete-window interior fragments during deduplication.

When a recording starts directly with the target meeting but omits a formal named call-to-order phrase, let Qwen ground the start from multiple canonical opening items in order plus target-specific structured titles such as named minutes or reports. Retry a rejection with that complete contract and the prior rejection reason; do not require a later separate-meeting handoff that does not exist.

When the ASR clock splits a literal call-to-order phrase across several short adjacent atomic units, validate the complete normalized quote against a bounded contiguous span and keep the boundary on the first unit of that span. Do not reject grounded meeting-start evidence merely because the quote crosses an artificial ASR row boundary.

In timeline reconciliation, `empty` is a boundary-bearing status and must retain a validated atomic unit, role, literal quote, and confidence; only `skipped` and `container` have blank boundary fields. If Qwen returns a blank `empty` disposition, retry with the rejected JSON and this distinction instead of repeating a generic unknown-unit error.

When an article verifier flags evaluative language, distinguish an unsupported value judgment from grounded institutional terminology such as a crisis residence or crisis service. Exact source-backed service names must not be rejected solely because one word can also be rhetorical.

When qualitative numeric repair keeps copying a malformed phone number, address, date, or amount from the rejected draft, stop including that draft after bounded attempts. Ask qwen3.5:9b for fresh source-grounded qualitative prose with all contact information and quantitative details omitted, while retaining the non-numeric civic action and outcome.

Distinguish a failed publication from a genuine no-candidate night. If recent meetings expose agendas but no recording or minutes, do not fabricate a transcript recap; report the missing authoritative media explicitly and keep checking future calendar refreshes.

Local reporter LLM work must use only `qwen3.5:9b`. Do not introduce another local model, deterministic content-generation fallbacks, or meeting-specific exceptions.

For corrected transcript-to-ASR timing, local word-count progression is not a safe alignment contract: an edited or removed passage can cause every later cue to drift, and consuming an unmatched sentence once while locating its start and again while locating its end doubles that error. Align corrected sentences with a monotonic chain of globally unique verbatim n-grams from the ASR word clock, retain exact ASR cue boundaries, and fail long inputs whose document-anchor coverage is too low. This deterministic evidence validation is for timestamps only; it must not replace LLM chronology segmentation or prose generation.
