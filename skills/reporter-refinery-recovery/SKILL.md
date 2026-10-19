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

When downloading eScribe attachments through a browser, canonicalize calendar-detail links to the meeting agenda route and reuse a valid cached `%PDF-` file before making another request; challenge HTML is not a PDF. For raster attachments, keep substantive scanned-document OCR strict, but let the configured vision-capable text model explicitly classify photograph-only pages so incidental signage does not turn an image-only bundle into a false partial-document failure.

When Stage 3 fails after partial generation, check both transport availability and the grounding contract before rerunning. Model-specific generation retries should own Ollama availability; a separate single-shot `/api/tags` preflight can create a false-negative failure during a brief LAN flap. For agenda previews, split every oversized attachment block into bounded, lossless source chunks before Stage 3 and verify their normalized concatenation reproduces the complete source.

When chronology segmentation repeatedly returns length-truncated JSON, do not retry the same oversized request unchanged. Keep the complete chronology, but split it into smaller overlapping LLM windows and retain strict literal-evidence validation; bounded output-token growth is a secondary retry, not a substitute for lossless input chunking.

For parent/container agenda spans, stop at the first explicit child handoff and keep child codes, dates, committee/document identity, recommendations, reports, motions, and outcomes out of the parent prose.

When adjacent agenda items share an item-owning committee or board identity, do not cut the current source at that shared identity; require a distinct next-item title or explicit handoff so the current item's own motion and vote remain in scope.

When a transcript date conflicts with the authoritative structured eScribe date, use the structured date for identity or omit the date; do not repeat an ASR date discrepancy.

When the source explicitly says it is returning to the next set or next item, keep the current item's preceding motion and disposition, and exclude all later-item material from that summary.

When a structured parent/container source span includes preview text followed by a procedural handoff, scope Stage 3 at that first handoff before generation; a welcome, request, or proposed ordering is not evidence that the previewed report was presented. Keep this boundary rule generic and preserve the full child chronology in its own authoritative item.

Numeric grounding must compare Arabic output with both Arabic and spoken-number source forms. At whole-meeting synthesis, validate against every source exposed to generation, including ranked candidates and authoritative meeting metadata. A bounded LLM retry loop must apply the complete downstream output contract before returning so malformed one-sentence prose remains retryable inside generation.

After any downstream LLM repair regenerates prose, reapply every earlier output contract before the next audit, including transcript-speaker metadata removal; a repair that passes grounding but reintroduces forbidden metadata remains retryable.

For minutes of another committee or board, distinguish the referenced body's identity from the current meeting's action: a current-meeting motion to move or approve those minutes followed by a carried vote belongs to the authoritative current meeting body unless the source explicitly places it in the earlier meeting.

Keep minutes narrative separate from the current meeting's minutes motion. If the source says “move the minutes,” preserve that literal action rather than upgrading it to “approve,” and attach the carried vote only to that motion; recommendations or discussion inside the referenced minutes are not a carried current-meeting report outcome.

For short procedural fragments, preserve literal self-reports as reported speech: “I've covered” and “No” may be summarized as what the speaker said or answered, but not upgraded to a formal agenda confirmation, approval, or minutes entry.

For motion revisions, distinguish a substantive amendment to a bylaw or policy from an amendment to the motion. A motion to amend the named bylaw or policy can carry even when a proposed amendment to that motion does not; “no amendment was made to the motion” does not erase a separately stated substantive document amendment. A document-qualified statement that the body approved an amendment to the named bylaw is not the same as approving an amendment to the motion when the source states both levels. If both appear, use explicit wording such as “the motion to amend the named document carried” and “the proposed amendment to the motion was not accepted.” Preserve later nominations or acclamations as separate actions.

For missing substantive items and non-procedural child presentations/deputations, require distinctive direct title evidence such as the report code, named subject, or multiple non-generic title terms, or an exact spoken item code before accepting a recovered transcript boundary. A neighboring span that shares only generic words such as “community,” “services,” “request,” “lands,” or “report” is not ownership; if no direct evidence exists, leave the item skipped rather than manufacturing a boundary or assigning another report's prose to it.

When a motion to defer or postpone an item is defeated, do not write that the item was deferred or postponed; report the defeated motion and any later carried motion as separate dispositions.

When the transcript says discussion is on a reconsideration motion only, calls the question, and then says that motion is carried before introducing a later recommendation, accept that explicit carried disposition without requiring a numeric vote count; keep the later recommendation separate.

Do not bind a generic carried or approved outcome to every category in a list. A current category inherits an action only when the source explicitly identifies that category as the motion's subject.

For bare agenda-category fragments, do not infer a staff report, speaker, motion subject, approval, or carried outcome from the label or neighboring categories; keep the generated description neutral to the bounded evidence.

For a category-only fragment with no item-specific action, use fresh model prose that says the category was listed and no specific disposition is recorded; do not repeat a trailing generic “carried” phrase as the category's action.

Treat categories in such a fragment as parallel agenda items. Do not introduce “under,” “within,” “part of,” or other unsupported hierarchy between the current category and neighboring categories.

Keep reported historical actions separate from current receipt motions: a past approval by another body stays attributed to that body, while the current meeting may only be described as receiving the report unless it explicitly acts on the underlying matter.

When the current meeting body is authoritative and the bounded source records a current-meeting motion and vote, a generic member of that body may be used even if the transcript exposes only an internal speaker label; do not use that role for an incomplete fragment without a disposition.

Do not require the literal body name in the transcript for that contextual attribution: with an authoritative Council identity plus an explicit motion and carried vote, “a council member moved” is grounded even when the source exposes only an internal speaker label.

Treat meeting labels such as “Council Meeting - Regular” as authoritative Council identity for this rule.

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

When qualitative numeric repair keeps copying a malformed phone number, address, date, or amount from the rejected draft, stop including that draft after bounded attempts. Ask the canonical local text model loaded from `.pya` configuration for fresh source-grounded qualitative prose with all contact information and quantitative details omitted, while retaining the non-numeric civic action and outcome.

Distinguish a failed publication from a genuine no-candidate night. If recent meetings expose agendas but no recording or minutes, do not fabricate a transcript recap; report the missing authoritative media explicitly and keep checking future calendar refreshes.

Local reporter LLM work must use only the canonical text model declared in `.pya` configuration by default. Do not introduce another local model, deterministic content-generation fallbacks, or meeting-specific exceptions.

For corrected transcript-to-ASR timing, local word-count progression is not a safe alignment contract: an edited or removed passage can cause every later cue to drift, and consuming an unmatched sentence once while locating its start and again while locating its end doubles that error. Align corrected sentences with a monotonic chain of globally unique verbatim n-grams from the ASR word clock, retain exact ASR cue boundaries, and fail long inputs whose document-anchor coverage is too low. This deterministic evidence validation is for timestamps only; it must not replace LLM chronology segmentation or prose generation.

When a recording proves that a named meeting waited for quorum and adjourned without reaching agenda business, let Qwen ground the scope at the target-specific quorum unit and preserve the complete procedural chronology without inventing substantive items. Generated procedural recaps remain publishable when non-empty; substantive-item gates must still reject empty or timed-out prose. For Stage 3 JSON retries, include the rejected malformed response and vary the repair instruction; bound repair output structurally rather than parsing or fabricating prose deterministically.

Keep financial direction attached to the source category for every amount: additional funding, budget increases, repair or project costs, allowances, contingencies, estimates, and reserve draws are requests or costs, not savings. A separate efficiency saving, available reserve, or no-immediate-budget-impact statement must not be merged with a requested cost. Classify and repair these claims with the canonical local text model, then keep the non-empty source-faithful gate strict.

Scale whole-meeting child-process timeouts with recording length when synthesis performs chunk reviews, coverage adjudication, and bounded source-grounded repairs. Recap-mode repairs must use completed-meeting action and decision status; upcoming-preview instructions must never leak into a completed transcript recap.
