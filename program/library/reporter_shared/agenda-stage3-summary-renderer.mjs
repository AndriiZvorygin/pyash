import fs from "node:fs";
import path from "node:path";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateAgendaSummaryStrict,
} from "./agenda-stage-contracts.mjs";
import {
  normalizeUnambiguousSpokenNumbers,
  unsupportedNumericTokens,
} from "./grounded-numeric-fidelity.mjs";
import { unsupportedNamedMotionAttributions } from "./motion-attribution-verifier.mjs";
import { auditFinancialClaim } from "./financial-claim-audit.mjs";
import { buildAgendaPreviewChunkSpans } from "./agenda-preview-source-chunks.mjs";
import { requestManagedOllamaChat } from "../../runtime/gpu/managed-ollama.mjs";

const PROCEDURAL_FLOOR_SEQUENCE_RULE = "When a source records a motion being moved, asks whether there are further questions, receives no substantive intervening discussion, and then records a vote or carried result, do not infer that discussion proceeded, that debate occurred, or that the floor was opened for consideration before the vote. Report only the source-supported motion and its disposition, or use the exact impersonal floor status if the source states it. A no-further-questions transition is not evidence of discussion, and 'the floor was opened for consideration' is not a substitute for the source's literal floor wording.";

const STAGE2_GROUNDING_ROOT = "agenda section grounding artifact";
const STAGE3_SUMMARY_ROOT = "agenda summary artifact";
const ORDINAL_MOTION_OWNERSHIP_RULE = "High-priority motion-ownership check: attach each disposition to the motion that is explicitly under discussion immediately before that disposition, preserving source order through intervening debate. A later 'that is carried' cannot change an earlier motion that the source already says was defeated, and a later amendment's disposition cannot be transferred to the motion before the amendment. When an amendment removes a named scope and the amended motion is then carried, the final motion has the remaining scope only; do not describe the removed scope as retained. Keep original motion and disposition, later motion and disposition, amendment motion and disposition, and amended motion and disposition as separate source-supported steps, and omit any step whose subject or outcome is not explicit.";
const ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE = "A moved motion may be summarized by a direct consequence that the same bounded source explicitly explains. If the source says a motion approves recommendations as presented and explicitly explains that this means no change to named requirements, wording such as 'a motion to retain those requirements' is a faithful paraphrase of that same motion, not a separately inferred motion. Attach the source's explicit disposition to that same motion. Do not use a consequence-level paraphrase to invent a subject, scope, or disposition that the source does not state.";
const EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE = "High-priority disposition check: an explicit source statement such as 'that motion is defeated' or 'that motion is carried' controls the outcome of the motion immediately under discussion. The equivalent literal outcomes 'passed', 'was passed', 'it is passed', and 'that is passed' are also explicit dispositions; when a motion was moved or seconded and the clerk or chair then says one of those phrases, accept a concise summary that the body passed or carried that motion. When the source records a member moving a recommendation, including 'move the recommendation contained in the report', and then records that motion as carried or passed, accept a concise paraphrase that the body carried or approved a motion on that recommendation: 'move' identifies the introduced motion and the later disposition supplies its outcome. Do not reject 'approve' merely because the source uses 'move' for the motion introduction. Do not require the exact word 'carried', a formal roll-call phrase, or a numeric vote count before recognizing that source-supported outcome. Do not recompute or override that stated disposition from a preceding vote count, apparent majority, conversational aside, or later motion. A later 'that's carried' belongs only to the later motion whose question or subject immediately precedes it. Preserve a source's explicit procedural wording even when the spoken count appears inconsistent; omit the count rather than changing the stated outcome.";
const MOTION_CONTEXT_SEPARATION_RULE = "Keep a motion's source-supported action and disposition separate from background context. A recommendation or motion may follow a consultation, recruitment, partnership, or other process without the body passing it 'via' or 'through' that process. Preserve the exact object and scope: removing an expenditure or budget line is not removing the underlying service, software, platform, project, or program. Preserve proposal strength exactly: a speaker's suggestion, possibility, question, or discussion of a change is not a formal amendment, motion, recommendation, or decision unless the source explicitly uses and pairs that procedural act. A first-person statement that someone would or could support an idea, especially when qualified by a need for more information, is not by itself institutional consideration, a recommendation, or a motion. An uncompleted suggestion that a matter may be deferred or that a motion to defer would be needed is not an actual motion or decision; when no motion disposition is recorded, say only that a possible deferral was raised or discussed and do not call it a decision, a motion that was made, or a deferred outcome. Keep a proposed amendment distinct from a motion to amend: when the source says someone proposed, suggested, or discussed an amendment but does not explicitly record moving, seconding, voting on, or carrying that amendment, say that a proposed amendment was discussed or raised and do not call it a motion or imply procedural completion. A tentative first-person question such as 'I'm wondering if we can amend' supports 'a proposed amendment' or 'a speaker proposed amending the motion', but does not by itself support 'the amendment was moved', 'seconded', or 'carried'. Likewise, 'I would recommend a deferral' supports 'a speaker recommended deferral' without implying that the matter was actually deferred. Use proposed, suggested, recommended, considered, or discussed only when the source supports that speech act; when the distinction is uncertain, preserve the speaker's qualified statement or say only that the source records discussion, and omit the formal label. Procedural verbs such as moved, seconded, carried, or defeated attach only to the immediately stated motion subject; a topic introduced afterward by 'for discussion', 'regarding', 'about', or a question is separate debate context, not the purpose, condition, or object of the moving or seconding. Treat phrases such as 'the motion is not on the floor' or 'motion not on the floor' as procedural or quoted discussion language, not as proof that a formal motion with an identified subject was discussed. Do not attach a nearby conditional consequence such as 'if the body decides to remove an item' to that phrase or convert it into a motion to remove the item; if the source does not explicitly pair a motion with that subject and action, omit the formal motion clause and retain only neutral procedural discussion. Do not replace a literal source action such as remove, defer, return, or bring back with a procedural synonym such as reconsider or reconsidered unless the source itself uses that synonym; a future possibility or committee discussion is not reconsideration of a current item. An opportunity, invitation, or statement that someone may move or defer something is not itself a proposed amendment or introduced motion; report an amendment or motion only when the source explicitly records that it was proposed, moved, seconded, or put to a vote. Do not write that a motion was seconded for discussion of a separate topic, or that an offered opportunity was an amendment. Do not import a later motion or deferral from outside the supplied bounded source window or from sibling context when the current window ends before that procedural event. Do not turn contextual participants or process details into the mechanism of the vote; use neutral framing such as 'following' or 'after' only when that relationship is explicitly stated, or omit the context while retaining the supported motion outcome.";
const UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE = "UNIVERSAL BOUNDED-SOURCE PROSE CONTRACT: use only the supplied source window for the requested prose and preserve its speech act and chronology. If the window ends before a motion, vote, deferral, recommendation outcome, or conclusion, do not report that later event. A possibility, conditional support statement, request for a future motion, recommendation to defer, or proposed deferral is not a completed decision, motion, table action, recommendation outcome, or disposition; do not call an item tabled unless the source explicitly records that procedural act. When a speaker only verbally suggests an amendment or deferral and no formal motion is recorded, use 'a speaker suggested' or 'a possible deferral was mentioned'; do not write 'a recommendation was raised/made' when that wording could imply a completed procedural act. A tentative first-person question such as 'I'm wondering if we can amend' supports 'a proposed amendment' or 'a speaker proposed amending the motion', but not that an amendment was formally moved, seconded, voted on, or carried. 'I would recommend a deferral' supports 'a speaker recommended deferral' without implying that the matter was actually deferred. A statement such as 'I would support it' followed by a request for more information or a condition supports qualified or conditional support ('a speaker said they would support it pending more information'), not unconditional past-tense support ('supported a proposal') or formal motion support. When the source explicitly records a speaker making a recommendation, 'a speaker recommended X' describes that speech act and does not imply that the recommendation was adopted, carried, or completed; use those stronger outcomes only when explicitly recorded. Preserve conditional relationships exactly: an 'if X, Y could/may happen' statement must remain conditional, and a possible consequence or future committee discussion is not evidence that the body discussed or decided X itself. Do not rewrite discussion of an item's possible consequence as discussion of whether to take the underlying action. When the source explicitly records a motion being moved and seconded, including through a chair's or clerk's procedural announcement such as 'it has been moved by ... and seconded by ...', a generic statement that a motion was moved and seconded is faithful even if the motion text or proposer lines are elsewhere in the bounded source; do not require the announcer to be the mover, and do not require unsupported mover or seconder names. Keep motion introduction/reporting separate from institutional disposition: the member who reports or moves a motion is not the actor who carries, approves, defeats, or adopts it unless the source explicitly says so; attribute those outcomes to the body or use a neutral passive construction. Omission of a later 'on the floor for discussion' or similar status qualifier is acceptable when the candidate makes no conflicting vote, decision, or outcome claim; this is an included-claim audit, not a completeness requirement. If a chair or clerk announces that a motion is 'now on the floor for discussion', describe that status impersonally ('the motion was on the floor for discussion') or omit it; never use 'placing', 'placed', 'brought', 'put', or 'moved' the item onto the floor for discussion, and do not say that the mover or another participant placed or brought the item onto the floor unless the source explicitly assigns that act to them. When the supplied bounded source ends mid-phrase or mid-sentence, do not complete the missing object, department, amount, outcome, or qualifier from sibling text, a broader meeting span, or inference; omit the incomplete modifier or use only the literal verified prefix. Keep an explicit motion subject separate from debate context: do not attach a topic introduced during discussion with 'regarding', 'about', or 'whether' to the motion's object unless the source explicitly states that topic as the motion subject. Report the motion first and put the debate topic in a separate neutral clause or omit it. Preserve literal actor spelling and identity: do not normalize, phonetic-match, or infer a mover's or seconder's name from conflicting forms such as Greg, Gray, or Gregg; when the source identity is ambiguous, omit the personal name and use a generic mover or seconder. Do not call an expenditure 'specific' unless the bounded source specifies its object. Willingness, availability, or openness to take direction—such as 'happy to', 'open to', or 'can take direction'—is not agreement, commitment, a promise to seek direction, or a completed next step. A speaker's acknowledgment, tentative plan, or statement such as 'we'll look to the CAO' or 'we'll take direction' is not by itself a recommendation, direction, commitment, or institutional decision; preserve it as consultation or willingness only when the source supports that wording. If an independent audit says a motion subject is absent or unpaired in this bounded window, omit that entire motion clause even if broader or sibling chronology mentions a related motion; do not import it. When audit evidence is internally contradictory, preserve only the conservative claim directly verified in this supplied window and omit the disputed procedural claim. Preserve a speaker's personal uncertainty, interest, or need for information as that speaker's statement, not as an objective institutional fact. A handoff, addressee, callout, or name/title mentioned inside another speaker's block does not establish that person's role or authorship; when attribution is uncertain, omit the actor-specific clause rather than inventing a named, titled, or generic actor. Do not import facts from sibling text or a larger meeting span.";
const OPTION_MOTION_SCOPE_RULE = "When a bounded source presents options, alternatives, proposed changes, or a request for direction, keep those proposals separate from any motion and disposition. An option's stated effect is not proof that a motion on that option was carried, passed, defeated, or approved. Attach a procedural outcome only when the same source chronology explicitly pairs that motion subject with the outcome; historical or later motions cannot supply the current option's disposition. Do not call transcript content a report, report description, or document unless the source explicitly identifies it that way. When the source gives an option without a paired outcome, describe it as an option, proposal, or direction under consideration and omit the outcome.";
const MOTION_VOTE_OMISSION_RULE = "A grounded summary may omit a source vote count while retaining the source-supported motion outcome. Do not reject or call a candidate contradictory merely because it omits an explicit count; omission is conservative, especially when several motions share one bounded source. Include a count only when it is unmistakably paired with the same motion and does not conflict with the source's explicit disposition.";
const REPEATED_SUBJECT_MOTION_RULE = "Repeated subject matter does not make separate motions one motion. A procedural clarification that later motions address the same topic or continue the same step can describe their relationship, but it does not erase an earlier explicit defeat or transfer a later carried or amended disposition backward. Preserve each explicit move and disposition in chronological order, even when the motions repeat the same policy, location, recommendation, or requirements.";
const STAGE3_SUMMARY_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 2400 },
    "chapter text": { type: "string", maxLength: 120 },
    confidence: { type: "number" },
    notes: { type: "string", maxLength: 300 },
  },
  required: ["summary", "chapter text", "confidence", "notes"],
  additionalProperties: false,
});
const STAGE3_TWO_FIELD_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" },
    "chapter text": { type: "string" },
  },
  required: ["summary", "chapter text"],
  additionalProperties: false,
});
const STAGE3_NUMERIC_AUDIT_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" },
    "chapter text": { type: "string" },
    "numeric valid": { type: "boolean" },
  },
  required: ["summary", "chapter text", "numeric valid"],
  additionalProperties: false,
});
const STAGE3_NUMERIC_REPLACEMENT_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    replacements: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  required: ["replacements"],
  additionalProperties: false,
});
const STAGE3_TITLE_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    title: { type: "string", maxLength: 180 },
  },
  required: ["title"],
  additionalProperties: false,
});
const STAGE3_ORTHOGONALITY_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    orthogonal: { type: "boolean" },
    "duplicate chapter indices": {
      type: "array",
      items: { type: "integer", minimum: 1 },
      maxItems: 2,
    },
    notes: { type: "string", maxLength: 300 },
  },
  required: ["orthogonal", "duplicate chapter indices", "notes"],
  additionalProperties: false,
});
const STAGE3_ORTHOGONALITY_ADJUDICATION_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    distinct: { type: "boolean" },
  },
  required: ["distinct"],
  additionalProperties: false,
});
const STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    grounded: { type: "boolean" },
    "unsupported claims": {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    notes: { type: "string", maxLength: 500 },
  },
  required: ["grounded", "unsupported claims", "notes"],
  additionalProperties: false,
});
const STAGE3_ORDINAL_MOTION_EVIDENCE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    motions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          ordinal: { type: "string", maxLength: 40 },
          subject: { type: "string", maxLength: 500 },
          scope: { type: "string", maxLength: 500 },
          disposition: { type: "string", maxLength: 120 },
          vote: { type: "string", maxLength: 240 },
          evidence: { type: "string", maxLength: 500 },
        },
        required: ["ordinal", "subject", "scope", "disposition", "vote", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["motions"],
  additionalProperties: false,
});
const STAGE3_AMENDMENT_EVIDENCE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    "document amendment": { type: "string", maxLength: 500 },
    "motion amendment": { type: "string", maxLength: 500 },
    "original motion disposition": { type: "string", maxLength: 160 },
    "later action": { type: "string", maxLength: 500 },
    evidence: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 500 },
    },
  },
  required: [
    "document amendment",
    "motion amendment",
    "original motion disposition",
    "later action",
    "evidence",
  ],
  additionalProperties: false,
});
const STAGE3_SPEAKER_HANDOFF_EVIDENCE_FORMAT = Object.freeze({
  type: "object",
  properties: {
    handoff: { type: "boolean" },
    "preceding speaker": { type: "string", maxLength: 120 },
    "standalone callout": { type: "string", maxLength: 160 },
    "following speaker": { type: "string", maxLength: 120 },
    evidence: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 500 },
    },
  },
  required: ["handoff", "preceding speaker", "standalone callout", "following speaker", "evidence"],
  additionalProperties: false,
});
const COMPOSITE_MOTION_SCOPE_RULE = "When one source-recorded motion, consent action, or approval explicitly covers multiple listed items, preserve the complete supported scope in the prose. Do not narrow an all/each/three/list/range action to the first item or a singular item, and do not imply that a composite motion covered only one member of the source-listed set.";
const CONTAINER_HANDOFF_RULE = "A parent/container status is not an executable report. This parent/container boundary may contain preview text, but when the current source span explicitly hands off to a child or another agenda item, summarize only the parent's procedural handoff. Stop at the first explicit child handoff. A welcome, invitation, request to hear a report, advance announcement, proposed ordering, or preview before the handoff is not proof that the report was presented or that its recommendations, motion, or outcome occurred. Do not copy the child agenda code, date, committee or document identity, recommendation, report substance, motion, speaker, presenter, or outcome into the parent/container summary merely because the source span contains trailing child material.";
const STRUCTURED_IDENTITY_BINDING_RULE = "Structured agenda identity is authoritative for the current report, minutes, committee, board, document, and date. When a bounded source span later mentions a different committee or document, that mention is a handoff boundary even when no numeric agenda code is spoken: do not replace the current label's identity with the neighboring name or attach the neighboring document's date to the current item, and exclude the later neighboring content. If the transcript date is absent or conflicts with the authoritative current label date, use the structured label date for identity framing or omit the date; never repeat an ASR date that conflicts with the structured agenda. A grounding audit must accept the authoritative label date as identity evidence when the transcript supplies a conflicting date and must not treat that conflict as a candidate defect. Never borrow a later neighboring date. Summarize only facts and actions explicitly tied to the current label, or use a generic current-item description when the ownership is unclear.";
const CATEGORY_ACTION_BINDING_RULE = "When the bounded source lists several adjacent agenda categories or headings and then states a generic procedural outcome such as 'carried', do not attach that outcome to the current category unless the source explicitly identifies the current category as the motion's subject. A category in a list does not inherit a later motion, approval, or carried status; identify the explicit motion scope or omit the outcome rather than assigning it to every listed category.";
const AGENDA_CATEGORY_FRAGMENT_RULE = "When the bounded source is only a bare agenda-category list, heading, or fragment plus a generic follow-up, do not infer a staff report, speaker, motion subject, approval, or carried outcome from the agenda label or neighboring categories. A collective phrase such as 'all in favour' or 'that is carried' without an explicit motion subject is not evidence that each listed category was moved, passed, or carried, and it is not evidence that a named member moved the list. Use fresh LLM prose that neutrally says the current category was listed among several parallel agenda items and that no specific disposition is recorded in this excerpt; do not say it was under, within, part of, or subordinate to another category, and do not report the trailing generic 'carried' phrase as an action for the current category.";
const PROCEDURAL_FRAGMENT_RULE = "For a short or fragmentary procedural span, preserve literal announcements, questions, answers, and speaker self-reports at their stated strength. An announcement such as 'Calling the meeting to order' supports only that the meeting was called to order; use impersonal wording when the source does not identify the actor, and do not add a governing body, formal outcome, or additional-business result. A terse reply such as 'Just me' is not evidence that no business was presented. An isolated reply such as 'Thank you.' is only a literal reply: do not pluralize it, infer reciprocal thanks, or turn it into an event. A bare title or address token such as 'Worship.' is only literal speech and is not evidence of a topic, action, or subject being addressed; quote it as speech or omit it. Do not turn 'back to' into proof that an item was addressed, a question-and-answer such as 'Did I cover ...? No' into a formal record or confirmation, or 'I've covered' into a completed agenda action; do not claim that minutes record an event unless the source explicitly says so.";
const DOCUMENT_SOURCE_SPEECH_ACT_RULE = "When GROUNDED_SOURCE contains an Attachment:, Document:, or Source: block, treat the following text as a document or attachment, not a meeting transcript. Describe what the notice, order, report, or other document states, requires, schedules, permits, or warns. Preserve the document's speech act exactly: a declarative capability or availability statement such as 'we could accommodate' is not a question or request, so use 'the correspondence stated' or 'the document reported' rather than 'the City asked'; call something a question or request only when the document explicitly does so. Keep separately listed formal remedies or requested actions as separate requests; do not join them with 'due to', 'because', or another causal relationship unless the document explicitly makes that connection. Background findings may be reported separately from the relief requested. High-priority conservative document audit rule: a concise candidate may report one source-supported formal request or a broad source-supported descriptor without enumerating every additional remedy or every list member; omission is not a grounding defect unless the candidate denies, contradicts, or changes the requested relief. For example, a source-supported request to confirm an order remains grounded when the candidate omits a separately listed request to dismiss the appeal, and an umbrella such as roof maintenance violations is acceptable when the document enumerates roof-related maintenance defects. Do not turn instructions, conditions, permissions, or hypothetical questions into events that occurred, and do not write that a party asked a question, another person answered, or a hearing discussed or decided something unless the document explicitly records that event. For example, 'Questions of clarification may be asked' is permission, not evidence that anyone asked or answered a question. A document's explicit formal request is also document evidence: when it identifies a party, respondent, applicant, or organization and says that party requests, seeks, submits, argues, or asks for relief, a neutral paraphrase such as 'the Respondent requested confirmation' or 'the City requested that the order be confirmed' preserves the document's actor and request; it does not claim that the meeting body decided the request or that the party spoke live. Do not reject that paraphrase because the legal addressee is implicit or because the document lists additional requested remedies that the concise candidate omits. Reject only a changed actor, action, or outcome, such as turning a party's request into a committee decision or live dialogue. Email or correspondence blocks marked Email from, From, To, or Subject are also document evidence: describe a recorded email, reply, representation, or correspondence, not a meeting speaker. First-person wording in an email identifies the recorded sender's party or organization and must not become 'the speaker' or a live meeting statement. Use neutral document framing such as 'The notice states', 'The order requires', or 'The email reported'.";
const DOCUMENT_SOURCE_AUDIT_PRIORITY_RULE = "DOCUMENT-ONLY AUDIT PRIORITY: This is static document or correspondence evidence, not a live transcript. Accept a concise candidate when each included request, actor, descriptor, date, and action is directly supported or clearly entailed by the document. Do not reject solely because the candidate omits another separately listed remedy, compresses an enumerated defect list into a supported umbrella, or uses 'the City' for a document-defined Respondent identified as the City. Reject only a changed or contradicted claim, a date transferred to a different event, or a live-meeting speech act. If the candidate is conservative and the source supports the included claim, return grounded=true.";
const GENERAL_CONSERVATIVE_OMISSION_AUDIT_RULE = "HIGH-PRIORITY GENERAL GROUNDING RULE: Audit the claims the candidate includes, not whether it reproduces every source detail. A concise candidate may omit source-supported qualifiers, exact historical or projected time windows, one member of a list, secondary context, or a later outcome when the wording it retains remains true. For example, a source-supported request for historical and projected data remains grounded when the source gives exact past and forecast periods; those omitted qualifiers are a coverage issue, not an unsupported claim. Preserve any timing, actor, action, outcome, amount, location, and relationship that the candidate does state, and reject only wording that changes, contradicts, or materially broadens or narrows the retained claim. If the retained core claim is supported, return grounded=true even when a more complete summary could add non-contradictory detail.";
const DEFERRAL_OBJECT_OMISSION_AUDIT_RULE = "HIGH-PRIORITY DEFERRAL-OBJECT REPAIR RULE: When deferral-object repair is active, a candidate that says only 'a motion to defer was moved and seconded and was carried' is grounded when the bounded source explicitly records a motion to defer or refer, its seconding, and its carried or passed disposition. Accept omission of the underlying main-motion subject, date, destination, condition, pending-information phrase, nearby debate topic, and all personal mover, seconder, chair, councillor, or speaker names. Do not reject the conservative generic procedural claim for omitting those details, and do not demand a specific subject that would reintroduce a disputed or unpaired main-motion action.";
const PROCEDURAL_FLOOR_STATUS_AUDIT_RULE = "HIGH-PRIORITY PROCEDURAL-FLOOR STATUS RULE: When GROUNDED_SOURCE explicitly records that a motion was moved and seconded and that it was on the floor for discussion, accept an impersonal candidate such as 'a motion was moved and seconded; the motion was on the floor for discussion' even when no disposition is recorded. The candidate does not claim that the proposed subject happened, was approved, or was carried. Do not reject the candidate for omitting a vote or outcome, and do not require the source's personal mover or seconder names. Reject only actor-attributed floor placement such as a participant placing or bringing the item onto the floor, or a changed subject or disposition.";
const PROCEDURAL_ABSENCE_AUDIT_RULE = "HIGH-PRIORITY BOUNDED-PROCEDURE ABSENCE RULE: When the bounded source records a proposal, possible action, question, or discussion but contains no explicit moved motion, second, vote, carried result, defeated result, or other disposition for that claim, accept a candidate that says no disposition was recorded in the excerpt. The absence statement is a conservative description of this source window, not an invented event. Do not reject it merely because the source says a proposal exists, asks to consider alternatives, or ends before a decision; reject only when the same bounded source explicitly records a disposition that the candidate denies or omits in a misleading way.";
const LITERAL_NUMERIC_AND_DATE_PRIORITY_RULE = "HIGH-PRIORITY LITERAL DATE AND NUMBER RULE: Exact years, dates, amounts, counts, and other numeric values explicitly present in GROUNDED_SOURCE are source evidence when the candidate pairs them with the same subject, action, or document. Do not replace an exact source value with a year inferred from the meeting date, approval cycle, document chronology, or surrounding context, and do not reject the candidate because an auditor hypothesizes an implied alternative value. Reject only when the source explicitly pairs a different value with that same subject or the candidate changes the source's pairing. If the source itself contains competing or ambiguous values, do not invent a resolution; accept an unchanged literal pairing that the source explicitly supports and preserve uncertainty rather than importing an inferred value.";
const NUMERIC_CONFLICT_OMISSION_AUDIT_RULE = "When numeric-conflict repair is active, the candidate intentionally omits a disputed numeric, date, year, amount, or ordinal detail. Do not reject that omission or demand one competing value. Accept a conservative nonnumeric paraphrase when its remaining action, subject, speech act, procedural status, and chronology are source-supported. High-priority literal motion rule: when GROUNDED_SOURCE explicitly says it has been moved by one person and seconded by another, a candidate saying 'a motion to remove an expenditure was moved and seconded' is grounded even if it omits names, even if earlier speakers said they would put a motion on the floor, and even if no vote or outcome appears in this window. Do not downgrade that explicit announcement to a proposal or suggestion. When the source explicitly says the motion is on the floor for discussion, accept that impersonal status and keep later discussion in a separate sentence. Reject only a numeric value that the candidate actually asserts, or a separate nonnumeric claim that is absent or contradicted.";
const PROCEDURAL_SELF_REPORT_RULE = "A literal self-report such as 'I've covered 12A' may be summarized as a speaker saying or reporting that they covered 12A, and a literal 'No' answer may be summarized as the speaker saying they did not cover 12B. Keep it as speech content, not a formal agenda status, confirmation, approval, or minutes entry; accept only neutral verbs such as said, reported, answered, or asked when they preserve the source's self-report and question-answer form. Preserve tense and modality in first-person procedural language: 'I'll pass the gavel back' supports that the speaker said or intended they would pass it, not that the completed pass occurred in this source span; 'I am going to vote against that' supports that a member stated an intention or opposition, not necessarily that the vote was completed; 'will be appointed' supports a statement about a future or recorded appointment, not necessarily an announcement or completed appointment by the current speaker. Do not turn a self-report, future statement, or transition into a completed action.";
const ADDITIONAL_BUSINESS_REMARKS_RULE = "In an additional-business segment, a speaker's statement such as 'I have two matters' or 'I just have two matters' introduces remarks or topics, not formal proposals or motions, unless the same source explicitly says a matter was proposed, moved, or put to a vote. Describe the remarks, congratulations, thanks, or quoted observations at their literal speech-act strength; do not upgrade them to proposed matters, motions, approvals, or decisions. A question and an implied response remain a question and response unless the source records a stronger action.";
const ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE = "High-priority additional-business check: 'I have two matters' or 'I just have two matters' supports that a speaker introduced or discussed two remarks or topics, but it does not support that the speaker proposed two matters, made two motions, or sought a formal decision unless the same bounded source explicitly records proposing, moving, seconding, voting, or carrying one. Congratulating, thanking, quoting an observation, or asking whether someone wants to give a speech remains informal additional-business speech. Reject only the unsupported formal-proposal or motion framing; accept neutral coverage of the source's remarks and topics.";
const PROCEDURAL_DECISION_SEQUENCE_RULE = "When the bounded source records multiple materially different procedural dispositions about the same matter, such as a motion being defeated or withdrawn, a motion to reconsider being carried, and a later recommendation being carried, preserve that decision sequence in the summary. When the source explicitly says the discussion is on the motion to reconsider only, calls the question, and then says that motion is carried before introducing a later recommendation, accept the reconsideration as carried even without a numeric vote count; keep the later recommendation motion and its outcome separate. Do not infer reconsideration from discussion alone or from a preliminary statement that nobody wants to move it. If a motion to defer or postpone an item is defeated, say that the motion to defer or postpone was defeated; do not say that the item itself was deferred or postponed. Describe any later motion and its outcome as a separate action. Do not compress the sequence into a straightforward approval or imply that the final outcome was the only motion. When a source shows substantive back-and-forth about a report or item, ordinary framing such as 'the body discussed' or 'the body debated the report' is a faithful compression even if the transcript does not use the exact word debated. Do not reject that framing merely because the candidate omits a later procedural outcome; omission is a coverage issue unless the candidate denies, reverses, or misattributes the outcome. A candidate may summarize the discussion and the later actions in separate concise clauses without reproducing every motion detail.";
const DECISION_SEQUENCE_REPAIR_RULE = "When the source records a carried motion to reconsider followed by a separate carried motion accepting a recommendation, preserve both actions in order and keep their subjects explicit. Do not generalize a named matter into a broader program, do not call the recommendation 'staff recommendations' unless that exact relationship is stated, and do not merge the reconsideration and recommendation outcomes into one action.";
const REPORT_PROPOSAL_STATUS_RULE = "A report may explicitly propose, describe, or provide a proposed process even when a later motion about implementing or changing that process is defeated. Treat 'proposed' or 'recommends' as source framing for the report, not as a claim that Council adopted, approved, carried, or successfully implemented the proposal; reject only if the generated prose upgrades the proposal to a completed outcome. A motion concerning a proposal is not automatically the proposal itself: do not say that the report's process was defeated, rejected, changed, or completed unless the source explicitly applies that disposition to the process. Do not infer a historical defeat from public comments, criticism, a question about whether an amendment is needed, or discussion of the need for an official plan amendment; a defeat requires an explicit source disposition or an unmistakable literal reference to a defeated motion. When the source says an earlier motion was 'defeated' and the current motion needs amendment, a summary may say that the discussion referred to an earlier defeated motion; this does not claim a final outcome for the current amendment. When the same bounded source later records a defeated, amended, or otherwise contrary motion about that process, the summary must state the report's proposal and that later procedural status as separate source-supported facts; do not leave the proposal as the only apparent current direction.";
const REPORT_PROPOSAL_AUDIT_PRIORITY_RULE = "When a report source says the discussion is 'in keeping with the motion that was defeated' and then says the motion on the floor needs to be amended, treat the defeated motion as an explicitly referenced earlier action and the amendment as current proposed or discussed status. The source's explicit statement that the defeated motion would have gone out to look for expressions of interest is direct evidence that the earlier motion concerned seeking expressions of interest; do not require the formal motion text to be repeated. When the same source explicitly links that defeated motion to not going out to seek expressions of interest or to another named process, accept concise wording that the earlier motion concerned that process even if the full motion wording is not repeated. When the source explicitly says a member will move to accept the staff recommendation and the subsequent question is carried, accept concise wording that the recommendation was accepted or carried; the paired motion subject and disposition need not repeat the same verb in the final vote line. Do not reinterpret that historical reference as a claim that the current motion was defeated or carried. Accept concise wording that the discussion referred to an earlier defeated motion and that a proposed amendment was discussed when those phrases preserve the source's temporal and procedural distinction. Do not accept an earlier defeated-motion claim when the source only mentions public comments, a question about the need for an official plan amendment, or general discussion without a literal defeated disposition. A source statement that an amendment is required for construction or development supports ordinary faithful framing that it accommodates or enables that construction; do not reject that paraphrase solely because the source uses 'required for' wording.";
const REPORT_PROPOSAL_REPAIR_RULE = "When a report describes a proposed process, preserve only process steps and criteria explicitly stated in the bounded source. Preserve the source's grammatical framing: if it says the report 'provides a proposed process', do not rewrite that as 'the report proposes' or as an adopted direction. A request-for-interest form is not an RFP, evaluation criteria, or a lease-selection process unless those exact details are stated. Keep later discussion of limiting outreach, existing interested parties, advertising, or an alternative motion separate from the report's initial proposed process unless the source explicitly applies that condition to the same process step; do not attach a later restriction to an RFP or form merely because both appear in the same item. When the source explicitly says the earlier defeated motion would have sought expressions of interest, it is acceptable to identify that earlier motion as concerning that process; when it only refers to an earlier motion without that link, use neutral wording such as 'an earlier related motion'. Do not combine a later proposal to limit outreach to people who already expressed interest with the final carried staff recommendation unless the source explicitly records that limitation as adopted. A public comment or question about whether an official plan amendment is needed is not evidence that an earlier motion was defeated; report it as comment or discussion unless the source explicitly records defeat. A defeated motion about whether to seek interest does not supply missing process details; keep the report's proposal and the defeated or amended motion separate, and include both when both are material to the bounded source's status.";
const PUBLIC_COMMENT_PLAN_AMENDMENT_RULE = "A source phrase that public comments were received at a public meeting about the need for an official plan amendment supports only public comments or discussion about that need. It does not establish a motion, an earlier defeated motion, or an amendment outcome. Use defeated or defeat only when the same bounded source explicitly identifies a motion and explicitly says that motion was defeated; do not treat 'I will move the recommendation' or a carried current recommendation as evidence of a prior defeated motion. Keep the report's recommendation and the public-comment context as separate source-supported facts.";
const PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE = "Adjacent transcript chapters may share the same proceeding, named person, or final subject and still be distinct. Treat a later procedural completion, nomination or appointment result, acclamation, formal vote, or handoff as unique coverage when its own source window records that step, even if an earlier chapter mentions the same person or decision. Do not classify chapters as duplicates merely because they share an outcome; compare the exact source windows and preserve each distinct procedural stage.";
const MULTI_BOUNDARY_REPAIR_RULE = "When a location or relationship is stated with multiple explicit boundaries, alternatives, or connected references, preserve the complete supported relationship rather than dropping one member or implying exclusivity. If the full relationship cannot be stated accurately, omit that location claim and summarize another supported source detail; do not replace it with a narrower boundary.";
const QUESTION_ANSWER_REPAIR_RULE = "When a bounded source is a question-and-answer exchange, preserve the speech act: do not convert a question into an asserted report finding, completed action, or fact attributed to a report. If the source only records a routine invitation for questions followed by 'not seeing any', 'none', or an equivalent no-question transition, omit that exchange rather than reconstructing a question, answer, confirmation, or actor. In a mixed chunk, retain the source's substantive declarative facts and decisions while omitting routine question transitions. If a substantive question is retained, use only its explicit wording and separately supported answer; when the actor or exact pairing is unclear, omit the whole exchange rather than inventing 'a council member', 'another speaker', 'a staff member', or a preceding question inferred from an answer. Do not infer a stronger conclusion than the answer states.";
const REPORTED_PAST_ACTION_RULE = "When the current source reports that another body previously approved, adopted, or otherwise acted on an agreement, policy, or project and the current meeting later moves to receive the verbal report, keep those actions separate: attribute the historical action to the named earlier body and the carried receipt motion to the current meeting body. Do not describe the current meeting as approving the underlying matter, and do not replace a motion to receive a report with asking for or approving the reported result.";
const REPORTED_ACTION_REPAIR_RULE = "When a source reports that an earlier body approved an agreement and the current meeting receives the verbal report, use two separate clauses: attribute the historical approval to the earlier body, and attribute only receipt of the report to the current meeting. Preserve the reported amount and program effect as historical report content, but never say the current meeting approved the agreement or funding.";
const MOTION_AMENDMENT_DISPOSITION_RULE = "Distinguish a substantive amendment to a bylaw, policy, or other document from an amendment to the motion itself. A motion to amend the named bylaw, policy, or document can carry even when a proposed amendment to that motion does not. Do not misread 'no amendment was made to the motion' as saying that no substantive document amendment was approved: if the source's original motion says it approves or makes an amendment to the named bylaw, policy, or document and that original motion is later carried, that document amendment is supported. When the source later says that no amendment was made or accepted to the motion and that the motion on the screen was carried, report the proposed motion amendment as not accepted or not made and the original motion as carried; never say that the rejected motion amendment carried or attach its wording to the carried motion. If both kinds of amendment occur, use explicit wording such as 'the motion to amend the [named document] carried' and 'the proposed amendment to the motion was not accepted'. A document-qualified claim such as '[the body] approved an amendment to the named bylaw' is not a claim that the body approved an amendment to the motion; accept it when the source's original motion states that document amendment and the source later carries that original motion. Do not reject that document-qualified claim solely because a separate motion amendment was rejected. Prefer explicit document-qualified wording and reject only a claim that the proposed amendment to the motion or its added wording carried. Preserve any later nomination or acclamation as a separate subsequent action.";
const AMENDMENT_LAYER_AUDIT_PRIORITY_RULE = "High-priority amendment-layer check: when the source first records an original motion to approve or make an amendment to a named bylaw, policy, agreement, or other document, and later records that a proposed amendment to the motion was not accepted or was not made before saying the motion on the screen carried, a candidate saying the body approved or carried the amendment to the named document is grounded. The later rejection applies to the proposed change to the motion wording, not retroactively to the named-document action. Accept the document-qualified action and the original motion outcome; reject only wording that says the proposed added text, such as an added office or person, was approved, carried, or adopted. Keep a later nomination, appointment, or acclamation separate. Do not let the pronoun in a phrase such as 'no amendment was made to it' erase an earlier explicit document-qualified amendment when the surrounding source distinguishes the motion amendment from the named-document amendment.";
const AMENDMENT_EVIDENCE_PRIORITY_RULE = "When structured amendment evidence is supplied, use it to keep the layers separate: the original motion's explicit action on a named bylaw, policy, or other document is distinct from a later proposed change to the motion wording. If the source explicitly says the original motion approves an amendment to the named document, then says the proposed motion amendment was not accepted or was not made and the motion on the screen carried, the document amendment and original motion disposition are source-supported. Do not reinterpret the phrase 'no amendment was made to it' or 'wasn't accepted' as cancelling the separately stated document amendment. A later nomination or appointment is a separate action.";
const AMENDMENT_SEQUENCE_REPAIR_RULE = "When the source contains a proposed amendment to a motion, later says that no amendment was made or accepted to that motion, then says the motion on the screen carried, keep the layers separate: the original motion's explicitly named document amendment may be described as carried, the proposed wording amendment to the motion was not accepted, and any later nomination or acclamation is a separate action. If the original motion explicitly contains both a document amendment and a separate appointment or nomination, preserve both source-supported actions; a repair that mentions only the document amendment is incomplete. Do not turn a whereas clause or explanatory rationale into a causal purpose such as 'to replace' or 'in place of' unless the source explicitly states that purpose; when the audit rejects that paraphrase, omit it and retain the literal appointment or nomination. A rejected causal relationship is a hard ban: do not repeat the rejected wording or a synonym such as replace, replacement, substitute, or in place of; use only the literal source-supported appointment or nomination. Use explicit document-qualified wording and never merge the rejected motion amendment with the carried original motion or with a later nomination. Do not infer the mover, seconder, recipient, or rejecting official from an agenda label, a speaker label, or a nearby name. If the source does not pair a person's name with that action in the same source sentence, use a generic motion subject. 'No amendment was made' or 'wasn't accepted' does not identify a person who declined it.";
const ORDINAL_MOTION_SEQUENCE_RULE = "When a bounded source mentions first, second, third, next, or other ordinal motions, preserve each ordinal as a separate procedural reference. A listed or on-screen first option is not a moved first motion unless this bounded source explicitly says that first motion was moved or otherwise acted on. When the source explicitly identifies the first motion on screen and later records a matching 'I'll move' or equivalent motion for that subject, treat it as a moved first motion; a later explicit 'that motion is defeated' applies to that moved first motion. If literal motion evidence has no explicit first-motion record, never write that a first motion was moved, placed on the table, carried, defeated, or otherwise acted on. A question about one motion does not transfer its subject to another motion. Keep a motion's subject, geographic or policy scope, amendment, outcome, and vote count attached only when the same source wording pairs them; do not transfer a later motion's scope or roll-call count to an earlier motion, merge numbered motions, or infer an outcome for a motion that is only being clarified. Never turn an unnumbered or ambiguous 'on the table' phrase into a numbered first motion or attach it to a subject the source does not explicitly pair with it; omit that ambiguity, and omit the unnumbered motion from the generated prose entirely when naming it would invite an inferred first-motion label. When a roll call is explicitly on one motion, do not describe it as a vote split between alternative proposals merely because later alternatives are discussed; state the voted motion's own subject and describe later alternatives separately. If an earlier motion is carried without a spoken count, do not borrow a later count for it. When several motions occur in one bounded excerpt and the count-to-motion pairing is not unmistakable, omit vote counts entirely and report only the source-supported motion outcomes. If a source explicitly moves a second motion, later calls its question, and says that it is carried, attach that carried disposition to the second motion; keep a later third motion and its own amendment or vote separate. If the source says a separate motion to amend was carried and then says the amended motion was carried, write two distinct procedural clauses or sentences: first, the amendment motion was carried; second, after that amendment, the amended motion was carried. Never compress this into 'the third motion was amended and carried' without separately reporting the carried amendment motion. An explicit disposition such as 'that motion is defeated' controls the motion immediately under discussion even when a preceding vote count or conversational aside is noisy. A spoken roll-call sequence immediately before that disposition, such as counts of those in favour and opposed, is vote-count evidence and may be rendered numerically only when its target motion is unambiguous; preserve the count's order and labels, so 'three in favour' and 'two opposed' must not become 'three opposed to two'. Conversely, do not call a later motion pending, approved, carried, defeated, or under consideration merely because it is described as a next step, another motion, or a step two/three, or because the excerpt ends while participants ask whether another motion is needed; use neutral wording that later motions were described or omit them until their own disposition is explicitly recorded.";
const ORDINAL_MOTION_AUDIT_PRIORITY_RULE = "For an ordinal-motion audit, align each disposition with the nearest explicitly moved motion in source order, scanning forward through intervening discussion until the next explicitly moved ordinal. A question call and carried result before the next ordinal belongs to the current motion even when the full motion wording is not repeated at the vote. When the source explicitly identifies the first motion on screen, later records a matching motion to move that subject, and then says that motion is defeated, accept concise wording that the first or initial moved motion was defeated; this is not an inference from a listed option. Do not infer a missing first motion merely because later motions are explicitly called second and third; an explicitly moved unnumbered motion remains unnumbered, and an unnumbered on-the-table status is grounded when the source states it. A current minutes receipt or approval motion followed by a carried vote is a supported action even if the same excerpt later narrates that an earlier committee item was postponed. Do not let that earlier carried minutes result overwrite a later separate motion. When the source uses a transition such as 'that is carried' for the current minutes and later says 'that motion is defeated' before introducing the next motions, these are separate dispositions: the later explicit phrase, especially after an unambiguous spoken in-favour/opposed count, is a supported defeat of the motion immediately under discussion; if the candidate reports that later motion as defeated, accept the literal phrase rather than reassigning the earlier carried result. If the source separately carries an amendment and then carries the amended motion, a grounded candidate must preserve both actions as separate procedural steps. When the source literally records a motion to amend by removing a scope, says that amendment is carried, then returns to the amended motion and says that motion is carried, wording such as 'the amendment was carried; subsequently, the amended motion was also carried' explicitly preserves those two distinct actions and must be accepted. If the source explicitly restates that the changes now relate only to the remaining scope, or says that the amendment leaves only that scope, accept that narrowed scope as grounded; do not demand that the final carried sentence repeat the entire amended subject. If an earlier 'on the table' or separate second/third motion is ambiguous, conservative omission of it is acceptable; do not demand that the summary invent an 'initial' sequence or conflate it with the later carried amendment steps. Do not substitute the earlier narrative postponement or carried result for that later defeat, and do not reject a concise summary that reports both separate actions.";
const CURRENT_MEETING_MINUTES_ACTION_RULE = "When the current agenda item is minutes of another committee, board, or earlier meeting, treat that body as the subject of the minutes, not automatically as the body taking the current action. Narrative before the current meeting's minutes motion is content of the referenced minutes: describe it as what the minutes report, discuss, or recommend, and do not turn it into a current-meeting presentation, receipt, approval, or carried outcome. If the source explicitly records a motion to receive the current minutes, approve recommendations contained within them, and then says that motion carried, accept that exact current action; do not let a later narrative about a different earlier committee's postponed minutes negate it. A narrative statement such as 'Council postponed the earlier committee minutes in order to provide time for comment' is historical or referenced-minute content; do not apply that postponement to a later motion in the current bounded excerpt unless the same motion subject and chronology explicitly do so. When the same excerpt later says that the first motion was defeated, that explicit current motion disposition controls; do not replace it with the earlier narrative postponement. Conversely, do not treat an earlier carried receipt-and-approval motion for the current minutes as approval of a later unrelated motion. Match every disposition to the motion or item it directly follows. A handoff such as 'back to you for the minutes', 'pass it back to you', or an invitation to present them is only a transition, not a completed presentation, report-back, receipt, approval, or carried action. A qualified summary such as 'the excerpt records a handoff to the minutes without recording their presentation or approval' is grounded when no later minutes content, motion, or vote appears in the bounded span; do not reject that negative qualification merely because the handoff verb itself is explicit. Do not say the minutes were reported, reported back, presented, received, approved, or carried unless the bounded source explicitly records that action or content. For a handoff-only span with no minutes content, motion, or vote, use neutral transition wording such as 'the discussion returned to the minutes' and omit the recipient's name. Keep a carried vote attached only to the motion it directly follows. If the source says 'move the minutes', preserve that literal move action and do not upgrade it to 'approve' unless approval is explicitly stated. If the source records a current-meeting motion to move, adopt, receive, or approve those minutes followed by a carried vote, attribute that disposition to the authoritative current meeting body or use neutral wording that the minutes were moved. Do not transfer the current-meeting motion to the referenced committee unless the source explicitly places the motion in that earlier meeting.";
const MINUTES_MOTION_SCOPE_REPAIR_RULE = "When a minutes item begins with a handoff to the current labeled committee's minutes, then uses a generic phrase such as 'I'll move the minutes' followed by a carried vote, preserve only that literal motion and disposition when the motion is explicitly paired with the current committee. If the same source later switches to another named committee's minutes and the generic motion never repeats the current committee, treat the generic motion as ambiguous rather than assigning it to the current item: use a handoff-only summary for the current label and omit the generic vote. Treat the later named committee as a boundary and omit its content and receipt motion from the current item. Do not infer that a generic 'move the minutes' refers to either committee, and do not claim that the current minutes were received or approved unless those words are explicitly paired with them.";
const CONSENT_AGENDA_SCOPE_REPAIR_RULE = "When a consent-agenda motion explicitly lists a received range and a separate recommendations-approved range with exceptions, preserve both clauses and every exception exactly as source scope. Do not narrow the receive range to the approval range, expand the approval range to the receive range, replace 'save and accept' or 'save and except' with a generic approval, or attach a later pulled-item deferral or defeat to the composite consent motion. A carried composite motion may be summarized with the two explicit ranges and exceptions; later discussion of a pulled item is a separate action and may be omitted from the parent consent-agenda summary.";
const CURRENT_MEETING_BODY_ATTRIBUTION_RULE = "When an authoritative current meeting body is supplied and the bounded source explicitly records a current-meeting motion and vote, a generic member of that body may be used for the motion even if the transcript exposes only an internal speaker label; this is contextual body identity, not an unsupported named office. When the authoritative body label identifies a Council meeting, including labels such as 'Council Meeting - Regular', accept wording such as 'a council member moved for approval' when the source records the motion and carried vote; do not demand the literal word council in the transcript and do not reject that generic attribution as unsupported. Do not use that generic role for an incomplete fragment, a call-to-order announcement, or a question-and-answer without an explicit motion and disposition.";
const EXPLICIT_NAMED_MOTION_ATTRIBUTION_RULE = "EXPLICIT NAMED-MOTION ATTRIBUTION RULE: when the bounded source explicitly pairs a named mover or seconder with the motion, a candidate that repeats the same name and paired action is source-grounded. A candidate may also conservatively omit those names and use impersonal wording. Do not state that a candidate correctly attributes the named actions and then reject it merely because the candidate uses the explicitly sourced names or because a generic paraphrase would also be acceptable. Reject a named attribution only when the source does not pair that name with the claimed action, the spelling or role conflicts, or the candidate transfers the name to a different action.";
const PARENT_SPEECH_ACT_AND_ACTOR_RULE = "PARENT SPEECH-ACT AND ACTOR FIDELITY RULE: preserve the distinction between an individual speaker's remark, a staff or officer recommendation being presented, and a formal institutional decision. A source-supported recommendation, proposal, presentation, or statement that the body will take direction does not support saying the body adopted, approved, carried, decided, or directed the proposal unless the same bounded chronology explicitly records that outcome. If the source identifies one named councillor or speaker with a remark, do not pluralize it into 'councillors' or another aggregate actor; retain the explicitly paired individual or use impersonal wording. Do not turn a source-supported discussion or comparison into a formal decision or adoption.";
const ROLE_ATTRIBUTION_FIDELITY_RULE = "Role-attribution fidelity is strict: use a named office or role such as mayor, councillor, council member, chair, or staff only when the same speaker block or an explicitly paired source line identifies that speaker with the claimed action or statement. A phrase addressed to the Mayor or Council, 'Your Worship', a floor handoff, or a person being thanked identifies an addressee or transition, not the preceding speaker's role. A name or title that appears inside a labeled speaker's dialogue is not automatically that speaker; it may be an addressee or a person being mentioned. Do not promote that dialogue name into the block's actor, and do not treat a shared surname or substring as proof that the displayed speaker and the mentioned person are the same actor. Do not infer that a speaker is a council member from correspondence being sent to Mayor and Council or from the meeting setting. Never merge facts from separate labeled speaker blocks into one speaker's action: a generic 'a speaker' may cover only facts anchored to one source block, while facts from different blocks must remain separate or use impersonal wording. A procedural handoff such as 'take questions after [item]', 'I'll continue with [item] narrative', or calling on the next participant is not by itself evidence that the speaker presented the named item's substantive content; require the same block's substantive lines before assigning that presentation, and otherwise omit the actor-specific presentation claim. When a displayed transcript speaker label spans a direct-address question, a named addressee, and a first-person response, treat those as separate dialogue turns: the addressee is not automatically the respondent, and the first-person response is not evidence that the named addressee performed the action. This is especially important for motions: do not name the addressee as mover or seconder unless an independent source line explicitly pairs that person with the motion; use a generic council-member or meeting subject when the motion and disposition are supported, or omit the actor. A later paraphrase of the motion within the same ambiguous dialogue does not independently resolve that attribution. When the speaker's role is unclear, use a speaker only for an action explicitly tied to an unidentified speaker; for a question, answer, confirmation, thanks, or presentation claim whose actor pairing is unclear, use an impersonal source description rather than assigning it to 'another speaker' or 'staff'. Use staff only when the source explicitly identifies the response or actor as staff; otherwise omit the role. The current meeting body may supply a generic council-member subject for an explicit current-meeting motion and disposition, but not for ordinary remarks, questions, or correspondence discussion without that motion record.";
const GENERIC_PLURAL_ACTOR_FIDELITY_RULE = "Generic actor-number fidelity: a generic plural may summarize two or more explicitly sourced people performing the same action when the bounded source clearly supports that shared action; do not require every source-listed or invited person to be named, and do not use a plural when it would add people who did not perform that action. When the source pairs the retained claim with one speaker, use that named speaker, singular 'a speaker', or impersonal source wording; do not turn one person's proposal, statement, or figures into a plural claim merely because other people appear elsewhere in the source window. Keep adjacent remarks from different speaker blocks separate unless the source explicitly supports a shared action.";
const PARENT_OVERVIEW_GROUNDING_RULE = "PARENT-OVERVIEW GROUNDING CONTRACT: this summary is synthesized from child chapters, so preserve each retained substantive topic, action, outcome, and source speech act. Use only complete claims already stated in an audited child summary, unless a paired literal anchor corrects that claim; never invent a new question, answer, confirmation, actor, role, or institutional subject from a declarative sentence or a nearby line. Prioritize source-stated subjects, evidence, proposals, decisions, directions, and next steps; omit conversational question-answer exchanges, confirmations, thanks, and no-further-question transitions unless a child summary and its paired literal anchor explicitly identify a material decision with its actors. Never turn a topic or explanatory sentence into 'a council member asks', 'another speaker confirms', or a staff response. If a child source names a presenter or speaker, retain that explicit attribution or use impersonal wording such as 'the source records discussion of ...'; do not turn speaker-specific remarks into an action of the meeting, council, county, or another institution. Do not write that 'the meeting addressed' a topic or that institutional initiatives 'were discussed' unless the literal source explicitly gives that institutional subject and action. Do not call transcript content a 'report description', 'report', or 'document' unless the literal source or authoritative item identity explicitly supports that document or report identity; an agenda heading alone does not establish the source speech act. A parent may compress or omit details, but every retained topic, action, outcome, and relationship must remain directly supported by its child summary and paired source evidence.";
const PARENT_AUDITED_CHILD_EVIDENCE_RULE = "PARENT AUDITED CHILD EVIDENCE RULE: in a parent overview audit, each paired child summary is an independently generated and semantically audited source-derived evidence unit. Accept a concrete claim that is stated in an audited child summary when the parent preserves that claim's topic, actor, action, amount, timing, outcome, and speech act; do not reject it merely because the complete paired source anchor is abbreviated or appears elsewhere in the supplied parent evidence. Use the paired literal anchor to correct or reject a child claim when it conflicts, but do not demand that every child-summary detail be repeated verbatim in the abbreviated anchor. A child summary may describe a source-supported report, explanation, question, or debate without a formal agenda-topic heading; do not reject that ordinary substantive framing merely because the transcript has no separate topic header. Do not upgrade a generic or impersonal child attribution to staff, council, committee, or another institutional actor unless the paired source evidence explicitly supports that pairing. This permits complete whole-meeting coverage while keeping the child audit and structured agenda identity authoritative.";
const SPEAKER_HANDOFF_ATTRIBUTION_RULE = "A standalone name or title callout at the end of one transcript speaker's block is usually a floor handoff to the next speaker, not attribution of the preceding speech. This includes a chair calling a person by name, a name followed by 'from' an organization, or an affirmative such as 'yes, [name]' immediately before a different transcript speaker block. Keep the preceding questions, concerns, reasons, and motions attached to the source speaker label that carries those lines; do not assign them to the person named in the following callout, and do not assign the following block to that name unless the source explicitly pairs the name with that block's claim or action. Attribute a named person only when the same source line or an explicitly paired source line identifies that person as delivering the claim or action. When the mapping is unclear, omit the name and use a generic public speaker, council-member, or meeting reference.";
const SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE = "When structured speaker-handoff evidence marks a standalone name or title callout immediately before a new speaker block, treat that callout as a floor handoff. Do not attribute any preceding block's question, concern, reason, or motion to the called-out person. Use the preceding source speaker or a generic speaker for preceding content, and attribute the called-out person only to content in the following block when the source explicitly supports it. During a handoff repair, do not put the called-out person's name or title in the summary or chapter headline unless the source explicitly pairs that person with a later claim or action.";
const REPORT_INTRODUCTION_ATTRIBUTION_RULE = "When one source speaker introduces or frames a report as 'a report from [person]' or 'this is [person]'s report' and a later speaker block contains the report or its substantive remarks, the named person identifies the report subject or source, not the introducing speaker and not proof that the named person introduced or presented it. Keep the introducer and the named report subject separate. Attribute presentation to the named person only when the same or a later source block explicitly pairs that person with the report speech; otherwise use generic wording such as 'the meeting heard a report on ...' or 'the report described ...' and omit the personal attribution. A historical phrase such as 'we received a report from [person]' supports receipt by the named committee or body, not that [person] introduced the report. When a historical minutes passage and a later current-meeting passage mention the same person or topic, preserve them as separate chronological report events; do not merge the historical receipt, its subject, or its outcome with the later report or motion.";
const REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE = "High-priority attribution and chronology check: reject wording such as '[person] introduced his/her report' or '[person] presented the report' when the source says another speaker announced 'a report from [person]' and the substantive report begins in a different speaker block without explicitly naming that person as the speaker. The phrase 'report from [person]' is report identity or historical source attribution, not speaker ownership of the introducing line. Also reject a summary that combines a historical 'we received a report ... regarding [earlier subject]' with a later separate report about [later subject] as one receipt or report. Accept a neutral report description or a generic meeting/report subject, and keep historical committee receipt, later report presentation, and later motion as separate source-supported events.";
const INFORMAL_DISCUSSION_STATUS_RULE = "High-priority speech-act check: ordinary discussion, comments, reactions, feasibility talk, or conversational agreement do not establish a formal institutional agreement, direction, commitment, resolution, or decision. The words discussion or discussed may neutrally compress multiple source remarks, questions, suggestions, or responses about the same topic; they do not imply a formal procedure unless the candidate adds a decision, motion, vote, or institutional action. Use discussed, commented, considered, raised, or similar wording when that is what the source records. Do not use addressed, tackled, resolved, agreed, decided, directed, committed, approved, adopted, or a completed future action as an institutional outcome merely to summarize that a topic appeared in discussion; use those stronger forms only when the source explicitly states that action or outcome. A speaker saying that people will discuss something later, or participants discussing a future revision, is not by itself a council agreement to take that action.";
const FRAGMENTED_TRANSCRIPT_GROUNDING_RULE = "FRAGMENTED-TRANSCRIPT GROUNDING RULE: normalized transcript windows may break one spoken sentence across adjacent labeled lines or end one line with a fragment that continues on the next line. Combine adjacent lines in the same bounded source and speaker block when they jointly state a complete fact, and accept an ordinary concise paraphrase of that fact; do not call a claim absent merely because ASR punctuation or line breaks make the source grammatical only across several lines. This does not authorize completing a source window that ends mid-thought, importing sibling text, or adding an evaluative adjective, scope, actor, outcome, or qualifier that the literal lines do not support. When the final source fragment is incomplete, omit only the incomplete clause and retain other complete facts from the same bounded window.";
const LITERAL_SOURCE_CLAIM_CHECK_RULE = "Before marking a candidate claim absent, compare its concrete wording and ordinary paraphrases against the complete GROUNDED_SOURCE, including every line before a handoff. If the source explicitly states the claim, it is grounded even when it appears in a list or beside other actions; do not report it as absent. Generic presentation framing is a faithful paraphrase when the source speaker presents a report; do not reject it merely because the candidate says 'the presentation described' instead of repeating the speaker's wording. Generic actor compression such as 'one councillor' and 'another speaker' is acceptable when the source clearly supports two distinct participants performing the described actions; do not require names when the candidate does not assert unsupported roles. A wrong or noisy body label that appears only in GROUNDED_SOURCE is not a candidate defect; reject it only when the candidate itself asserts the wrong body. If your notes say that the source explicitly contains or supports the candidate claim, return grounded=true and leave unsupported claims empty. ${FRAGMENTED_TRANSCRIPT_GROUNDING_RULE}";
const GENERIC_SPEAKER_QUESTION_RULE = "GENERIC QUESTION ATTRIBUTION RULE: when the literal source contains a participant's direct question or question wording, accept a neutral paraphrase such as 'a speaker asked about ...' or 'the source records a question about ...' even when the exact speaker label is not explicitly paired with that question. This generic wording does not assert a named actor, formal inquiry, motion, vote, or institutional action. Do not reject it merely because the source does not identify the questioner by name; reject only a changed question subject, a completed answer or outcome, or a formal procedural claim not present in the source.";
const EXPLICIT_PROPOSAL_PARAPHRASE_RULE = "EXPLICIT PROPOSAL PARAPHRASE RULE: when the literal source explicitly says a speaker or staff member is proposing, proposed, or recommends an action and pairs that speech act with its object or rationale, accept a neutral paraphrase such as 'the proposal involved ...' or 'a proposal was made to ...'. The singular word proposal does not by itself add a formal motion, completed outcome, or unsupported definitive scope. Reject only an object, rationale, actor, or outcome that changes or exceeds the source's explicit pairing.";
const SOURCE_QUALIFIER_FIDELITY_RULE = "NON-NEGOTIABLE source-strength rule: preserve qualifiers, alternatives, singular/plural scope, and near-total wording that changes the claim's truth conditions. If the source gives alternatives such as 'acted upon or have been completed', retain the alternatives or omit that claim; do not choose the stronger branch 'completed'. If the source says one recommendation, do not pluralize it to recommendations unless the source supports a set. If the source says 'virtually' or 'almost', retain that qualification or omit the result; never strengthen it to 'all' or 'erased', and never drop a source-stated exception. Do not add descriptive qualifiers such as 'new', 'updated', 'current', 'redesigned', 'digital', 'expanded', or 'improved' unless the bounded source explicitly supports that qualifier for the retained subject; when the core subject or action is supported but a modifier is not, omit only the modifier and preserve the complete source-supported claim. If a speaker says they would or could support a proposal but immediately qualifies that support with a condition, contrast, or need for more information, preserve the qualification in the same claim; do not rewrite it as unconditional support plus a separate request. When the same source block contains qualified support followed by questions or requests for information, it is acceptable to report both facts, but use wording such as 'a speaker said they would support the proposal while requesting more information' or separate neutral clauses; never use unconditional past-tense 'supported' for that qualified statement. A concise summary may omit secondary detail, but it must not strengthen a qualified, approximate, disjunctive, or exception-bearing source statement.";
const QUALIFIED_SUPPORT_SPEECH_ACT_RULE = "Qualified-support speech-act rule: when the same source block says 'I would support it' and then asks for more information, report conditional or pending support and the separate information request. Prefer 'a speaker said they would support the proposal while requesting more information' or two neutral clauses. Do not compress this into 'a speaker supported the proposal but requested information'; that removes the qualification. If the source block or actor pairing is ambiguous, omit the actor-specific linkage rather than merging the support and question into one speaker's unconditional action.";
const TENTATIVE_SPEECH_ACT_FIDELITY_RULE = "Tentative-speech-act fidelity rule: 'I'm wondering if we can amend' supports a possible or proposed amendment, not a completed formal amendment; use 'a possible amendment was raised' or 'a speaker considered proposing an amendment' when the object is clear, and do not use stronger 'suggested amending' wording when the audit says it implies completion. 'I would recommend a deferral' supports 'a speaker said they would recommend deferral' or the explicitly qualified speech-act form 'a speaker recommended deferral' when the source and qualifier remain clear; it does not mean the item was deferred, and it must retain conditions such as pending further information. A grounding audit must accept those source-faithful recommendation and possible-amendment paraphrases when the literal source contains the corresponding first-person statements; reject only a stronger formal action, completed outcome, missing condition, or wrong subject. Keep amendment/referral and deferral recommendation in separate clauses.";
const CONDITIONAL_STATEMENT_FIDELITY_RULE = "Conditional-statement fidelity rule: when the source explicitly records a speaker stating an 'if X, Y could/may happen' or 'if the body decides X' condition, accept a concise attribution such as 'the speaker said that if the body decides X, Y could happen' or 'the speaker discussed that conditional possibility' when it preserves the condition. This reports the speaker's conditional statement; it does not assert that X occurred, that Y occurred, or that the body decided X. Prefer 'said that' over a wording that could sound like institutional discussion, but do not reject a source-faithful conditional merely because it uses 'discussed' when the candidate retains the literal if-clause and makes no completed-action claim.";
const CONDITIONAL_RELATIONSHIP_AUDIT_RULE = "HIGH-PRIORITY CONDITIONAL-RELATIONSHIP RULE: when the bounded source says 'if X, Y would/could/may happen', the candidate must retain the if-condition and modal or otherwise omit that hypothetical relationship. Do not rewrite X as a current or completed fact, and do not report Y as an unconditional present action. A source sentence such as 'we have not integrated X if Y proceeds' remains conditional about Y; do not say that X is or is not integrated because Y occurred. Accept a concise conditional paraphrase or conservative omission, and reject only a claim that changes the condition, modality, chronology, or outcome.";
const DEFERRAL_PROPOSAL_STATUS_RULE = "Deferral-proposal status rule: when the source says that an item 'could be deferred' or that a motion would be needed to defer it, do not call that a recommendation that was made, a formal motion, or a completed decision. Use 'a possible deferral was raised' or 'a speaker said deferral could be considered' and retain the future meeting date only when the source explicitly supplies it. If the source is truncated after an unfinished first-person thought, omit the missing continuation and do not upgrade the conditional proposal.";
const LITERAL_SOURCE_PHASE_PRIORITY_RULE = "NON-NEGOTIABLE chronology rule for grounding audits: a source excerpt may contain multiple procedural phases, including a closed session, a return to open session, later questioning, and later motions. Do not treat later phase language as proof that an earlier source-stated phase did not occur. If the candidate repeats an explicit source statement such as 'In the closed session' or 'no direction was provided' at that point in the chronology, accept that literal claim as grounded even when the same excerpt later records open-session discussion, motions, votes, or adjournment on the item. A later motion or vote is separate source evidence, not a reason to call the earlier literal statement unsupported; reject only a candidate that changes the source order, denies a later explicit action, or falsely treats the phases as one undifferentiated event.";
const SOURCE_TOPIC_RELATIONSHIP_RULE = "When one source sentence contains multiple topics linked by different verbs or a 'respecting', 'about', or similar clause, preserve each topic's relationship without changing its action, scope, causality, or ownership. A compact neutral preposition such as 'regarding' may summarize parallel source-supported topics when it does not say that one topic is a cause, property, or narrower qualifier of the other; do not reject that faithful paraphrase solely because the source uses 'respecting' or another preposition. Preserve contrast and conditional wording such as but, if, unless, would, contingent, or so that: do not convert a conditional or contrast into an unsupported before/after sequence, unconditional support, opposition, or completed outcome. Use parallel wording when needed, such as 'the source records X and separately identifies Y', and reject only a paraphrase that actually changes the relationship.";
const SEPARATE_REMARKS_SCOPE_RULE = "SEPARATE-REMARKS SCOPE RULE: a long transcript window may contain several independently labeled speaker blocks, questions, answers, and adjacent topics. Do not compress facts from separate blocks into one unified 'discussion regarding X' or one causal finding when the source presents them separately. Keep independent remarks in separate neutral clauses or sentences, or omit a detail whose relationship to the other topic is not explicit. A phrase such as 'the source recorded discussion about X' is neutral record framing when the source contains a connected exchange about X; it does not by itself assert a formal meeting action. Reject only a candidate that merges distinct topics, assigns one speaker's fact to another, or turns adjacency into a causal, institutional, or procedural relationship.";
const CAUSAL_RELATIONSHIP_AUDIT_RULE = "HIGH-PRIORITY CAUSAL-RELATIONSHIP RULE: a proposal, business case, recommendation, request, or solution may be followed or preceded by nearby benefits, consequences, costs, risks, or background topics without those details becoming its purpose, reason, motivation, or primary case. Treat adjacency, a list, and a later phrase such as 'this is the case for [subject]' as insufficient to pair the subject with a nearby benefit. Accept causal wording only when the same bounded source explicitly pairs the proposal with that cause or purpose. When that pairing is not explicit, a conservative summary may state the proposal or case and then state the separate benefit or consequence in an independent sentence, or omit the secondary detail. Do not use 'to', 'because', 'due to', 'in order to', 'so that', 'aimed at', or an equivalent purpose construction to reconnect the disputed relationship.";
const ORTHOGONALITY_SOURCE_WINDOW_CHARS = 3000;
const ORTHOGONALITY_SUMMARY_WINDOW_CHARS = 1800;
const MONTH_DATE_PATTERN = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,|\s)\s*(\d{4})\b/giu;
const NUMERIC_CONFLICT_OVERBROAD_SCOPE_PATTERN = /\b(?:specific|particular|various|several|multiple|different)\s+(?:departments?|items?|amounts?|budgets?|funds?|figures?|dates?|years?)\b/iu;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function causalPurposeConstructionDefect(text = "") {
  return /\b(?:proposal|proposed|case|business\s+case|solution|plan|request|initiative|recommendation|hiring|hire|adding)\b[^.!?]{0,240}\b(?:to|because(?:\s+of)?|due\s+to|in\s+order\s+to|so\s+that|aim(?:s|ed)?\s+to|for)\b[^.!?]{0,240}\b(?:improv\w*|reduc\w*|increas\w*|decreas\w*|cost|saving\w*|morale|burnout|efficien\w*|productiv\w*|response\s+time\w*|repair\w*|maintenance|compliance|service\s+quality|downtime|capacity|workload)\b/iu.test(String(text || ""));
}

function causalRelationshipConstructionDefect(text = "") {
  const evidence = String(text || "");
  return causalPurposeConstructionDefect(evidence)
    || /\b(?:because(?:\s+of)?|due\s+to|as\s+a\s+result\s+of|result(?:s|ed|ing)?\s+in|lead(?:s|ing)?\s+to|cause(?:s|d|ing)?|contribut(?:e|es|ed|ing)\s+to|driv(?:e|es|en|ing)\s+the)\b/iu.test(evidence)
    || /\b(?:increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing))\b(?:\s+\w+){1,5}\s+\b(?:usage|repair\w*|cost\w*|expense\w*|downtime|capacity|workload|maintenance|productiv\w*|efficien\w*|morale|burnout)\b/iu.test(evidence);
}

function sourceTopicRelationshipGroundingDefect(text = "") {
  const evidence = String(text || "");
  const disputedPairing = /\b(?:not\s+(?:explicitly\s+)?paired|does\s+not\s+(?:explicitly\s+)?pair|not\s+(?:explicitly\s+)?connected|does\s+not\s+(?:explicitly\s+)?connect|separate(?:ly)?\s+(?:states?|mentions?|discusses?)|adjacent|nearby|relationship|attaches?|connects?|merges?|combines?)\b/iu.test(evidence);
  const sourceComparison = /\b(?:source|transcript|candidate|summary|claim|output|excerpt)\b/iu.test(evidence);
  const topicTerms = /\b(?:recommend(?:ation|ed|s)?|proposal|merit|explore|platform|topic|action|subject|object|qualifier|modifier|phrase)\b/iu.test(evidence);
  return disputedPairing && sourceComparison && topicTerms;
}

function sourceTopicRelationshipConstructionDefect(text = "") {
  return /\b(?:recommendation|proposal)\s+(?:to|for)\s+[^.!?]{1,120}/iu.test(String(text || ""));
}

function conditionalDeferralRecommendationSource(text = "") {
  const evidence = String(text || "");
  return /\b(?:recommend(?:ation|ed|s)?|my\s+recommendation)\b[\s\S]{0,240}\b(?:could|would|may|might)\s+be\s+(?:defer|postpon|refer)\w*\b/iu.test(evidence)
    || /\b(?:could|would|may|might)\s+be\s+(?:defer|postpon|refer)\w*[\s\S]{0,240}\b(?:recommend(?:ation|ed|s)?|my\s+recommendation)\b/iu.test(evidence);
}

function collectiveActorGroundingDefect(text = "") {
  const evidence = String(text || "");
  return /\b(?:collective(?:ly)?|individual\s+remarks?|generic\s+staff|directors?|staff|group|team|plural)\b/iu.test(evidence)
    && /\b(?:only\s+records?|individual|not\s+(?:a\s+)?generic|source\s+identif(?:y|ies|ied)|unsupported|incorrect(?:ly)?|does\s+not|rather\s+than|no\s+formal|misattribut)/iu.test(evidence);
}

function institutionalActorGroundingDefect(text = "") {
  const evidence = String(text || "");
  const institutionalActor = /\b(?:committee|council|county|body|staff|office|department|director|manager)\b/iu;
  const institutionalAction = /\b(?:discuss(?:ed|es|ing)?|present(?:ed|s|ing)?|note(?:d|s|ing)?|direct(?:ed|s|ing)?|say(?:s|ing)?|recommend(?:ed|s|ing)?|read(?:s|ing)?|introduc(?:ed|es|ing)?)\b/iu;
  const candidateInstitutionalClaim = /\b(?:candidate|summary|output|claim|prose)\b[\s\S]{0,220}\b(?:claim(?:s|ed)?|say(?:s|ing)?|use(?:s|d)?|assign(?:s|ed)?|frame(?:s|d)?|state(?:s|d)?)\b[\s\S]{0,180}/iu.test(evidence);
  const sourceDisputesInstitutionalPairing = /\b(?:no\s+explicit|not\s+(?:explicitly\s+)?(?:state|record|supported|paired)|does\s+not\s+(?:state|record|support|pair)|unsupported|incorrect(?:ly)?|rather\s+than|as\s+an?\s+institution|institutional\s+(?:actor|subject)|only\s+(?:records?|identifies?)|handoff)\b/iu.test(evidence);
  return institutionalActor.test(evidence)
    && institutionalAction.test(evidence)
    && sourceDisputesInstitutionalPairing
    && (candidateInstitutionalClaim || /\b(?:source|audit|claim|summary|output|candidate|prose)\b/iu.test(evidence));
}

function genericPluralActorGroundingDefect(text = "") {
  const evidence = String(text || "");
  return /\b(?:generic\s+plural|plural\s+(?:actor|subject|speaker)|generic\s+(?:actor|speaker)|plural\s+['”']?(?:speakers?|participants?|members?))\b/iu.test(evidence)
    && /\b(?:unsupported|not\s+(?:supported|recorded|stated)|does\s+not|only\s+(?:identif|record)|one\s+speaker|single\s+speaker|attributes?|attribut|adds?\s+(?:people|speakers?))\b/iu.test(evidence);
}

function unsupportedQualifierGroundingDefect(text = "") {
  const evidence = String(text || "");
  return /\b(?:qualifier|descriptor|adjective|modifier|word|phrase|new|updated|current|redesigned|digital|expanded|improved)\b/iu.test(evidence)
    && /\b(?:does\s+not\s+(?:explicitly\s+)?(?:state|record|say|label|call)|not\s+explicitly\s+(?:state|record|said|labelled|labeled)|unsupported|adds?\s+(?:the\s+)?(?:qualifier|descriptor|modifier|word)|changes?\s+the\s+(?:claim|truth)|not\s+present|absent)\b/iu.test(evidence);
}

function fragmentedTranscriptGroundingDefect(text = "") {
  const evidence = String(text || "");
  return /\b(?:fragmented\s+(?:speech|source|transcript|lines?)|fragmentary\s+(?:speech|source|transcript|lines?)|transcript\s+fragments?|source\s+(?:fragment|ends?|is\s+truncated)|ASR\s+(?:fragment|line))\b/iu.test(evidence)
    && /\b(?:candidate|summary|claim|grounded|unsupported|source|not\s+supported|does\s+not)\b/iu.test(evidence);
}

function mergedDiscussionScopeGroundingDefect(text = "") {
  const evidence = String(text || "");
  return /\b(?:combines?|merged|conflat(?:es?|ed)|single\s+(?:discussion|event|claim)|combined\s+(?:discussion|claim|scope)|unified\s+(?:discussion|event|claim)|distinct\s+(?:remarks?|topics?|speakers?)|separate(?:ly)?\s+(?:from|remarks?|topics?)|different\s+(?:speakers?|remarks?|topics?)|not\s+(?:a\s+)?(?:single|combined|unified)|specific\s+(?:causal\s+)?link(?:age)?|causal\s+link(?:age)?|comprehensive\s+scope)\b/iu.test(evidence)
    && /\b(?:source|transcript|candidate|summary|claim|remarks?|speakers?|topics?|discussion|relationship|scope)\b/iu.test(evidence);
}

function referredAgendaScopeGroundingDefect(text = "") {
  const evidence = String(text || "");
  const referredItem = /\b(?:refer(?:red|ring)?\s+back|sent\s+back|carried\s+forward|brought\s+forward|from\s+(?:the\s+)?(?:prior|previous|earlier)\s+meeting|(?:prior|previous|earlier)\s+meeting)\b/iu.test(evidence);
  const currentScope = /\b(?:current\s+(?:committee|meeting|agenda|agenda\s+item)|new\s+(?:agenda\s+item|motion|decision|outcome)|current\s+agenda\s+item|current\s+committee(?:'s)?\s+agenda\s+items?)\b/iu.test(evidence);
  const rejected = /\b(?:incorrect(?:ly)?|wrong(?:ly)?|misattribut(?:e|ed|ion)|implies?|unsupported|does\s+not|not\s+(?:a\s+)?new|rather\s+than|should\s+not|fails?\s+to)\b/iu.test(evidence);
  const phaseReference = /\b(?:previous|prior|earlier|later|subsequent|future|next)\s+(?:meeting|session|committee|period|discussion)\b|\b(?:morning|afternoon|evening|lunch)\s+(?:meeting|session|period)\b|\b(?:over|during|from)\s+(?:the\s+)?(?:morning|afternoon|evening|lunch)\b/iu.test(evidence);
  const phaseScope = /\b(?:current|this|today(?:'s)?|same)\s+(?:meeting|session|committee|period|agenda|morning|afternoon|evening|lunch)\b/iu.test(evidence);
  const phaseConflict = /\b(?:not\s+necessarily|not\s+(?:the\s+)?same|not\s+(?:the\s+)?current|rather\s+than|does\s+not\s+(?:establish|support|show|mean)|incorrect(?:ly)?|wrong(?:ly)?|confus(?:e|es|ed|ing)|collaps(?:e|es|ed|ing)|merg(?:e|es|ed|ing)|unsupported|misattribut(?:e|ed|ion))\b/iu.test(evidence);
  const sourceComparison = /\b(?:source|transcript|candidate|summary|claim|output|excerpt)\b/iu.test(evidence);
  return (referredItem && currentScope && rejected)
    || (phaseReference && phaseScope && phaseConflict && sourceComparison);
}

const REFERRED_AGENDA_SCOPE_AUDIT_RULE = "REFERRED-AND-TEMPORAL-SCOPE FIDELITY: keep an earlier meeting's referral and every distinct source phase separate from the current meeting's discussion. If the literal source says matters were referred back from a prior meeting and then later source lines introduce, describe, question, or debate those same matters in the current bounded excerpt, accept a neutral summary that preserves both facts. Do not reject the current discussion merely because the source first states that the matters were referred for further discussion; read the complete bounded source in chronology before deciding whether that later discussion is present. Likewise, do not turn options mentioned for a lunch period, prior meeting, earlier session, or later phase into options already discussed in the current morning or other current phase. Preserve qualifiers such as 'would provide an overview', 'for consideration', 'mentioned previously', and 'not necessarily discussed' when they distinguish source phases. Conversely, a referral or future/earlier mention alone does not prove a later discussion, motion, decision, or outcome: if no later source lines develop the matter, retain only the referral or mention and omit the current action. Do not turn referred or phase-specific matters into new current agenda items or new motions, and do not demand that the source repeat the word 'discussed' when it explicitly records a report, explanation, question, or debate about the referred subject.";

function conflictingStructuredDateClaim(text = "", label = "") {
  const labelMatch = [...String(label || "").matchAll(MONTH_DATE_PATTERN)][0];
  if (!labelMatch) return "";
  const labelMonth = String(labelMatch[1] || "").toLowerCase();
  const labelDay = String(labelMatch[2] || "");
  const labelYear = String(labelMatch[3] || "");
  const candidateText = String(text || "");
  for (const match of candidateText.matchAll(MONTH_DATE_PATTERN)) {
    const month = String(match[1] || "").toLowerCase();
    const day = String(match[2] || "");
    const year = String(match[3] || "");
    if (month !== labelMonth || day !== labelDay || year === labelYear) continue;
    const start = Math.max(0, Number(match.index || 0) - 100);
    const context = candidateText.slice(start, Number(match.index || 0) + String(match[0] || "").length + 100);
    if (!/\b(?:agenda|meeting|minutes|session|held|dated)\b/iu.test(context)) continue;
    return `The generated prose uses ${match[0]}, but the authoritative agenda identity is ${labelMonth} ${labelDay}, ${labelYear}.`;
  }
  return "";
}

function structuredLabelDateAppears(text = "", label = "") {
  const labelMatch = [...String(label || "").matchAll(MONTH_DATE_PATTERN)][0];
  if (!labelMatch) return false;
  const month = String(labelMatch[1] || "");
  const day = String(labelMatch[2] || "");
  const year = String(labelMatch[3] || "");
  const pattern = new RegExp(`\\b${month}\\s+${day}(?:st|nd|rd|th)?(?:,|\\s)\\s*${year}\\b`, "iu");
  return pattern.test(String(text || ""));
}

function removeAllowedStructuredDateAuditClaims(audit = {}, { label = "", summary = "" } = {}) {
  if (!structuredLabelDateAppears(summary, label)) return audit;
  const dateClaim = (value = "") => /\b(?:date|year|ASR)\b|\b20\d{2}\b|\b(?:conflict|contradict)(?:ed|s|ory)?\b.*\b(?:date|year)\b|\b(?:date|year)\b.*\b(?:conflict|contradict)(?:ed|s|ory)?\b/iu.test(String(value));
  const unsupportedClaims = (Array.isArray(audit.unsupportedClaims) ? audit.unsupportedClaims : [])
    .filter((claim) => !dateClaim(claim));
  const notes = dateClaim(audit.notes) && unsupportedClaims.length === 0 ? "" : String(audit.notes || "");
  return {
    ...audit,
    grounded: unsupportedClaims.length === 0 ? true : audit.grounded,
    unsupportedClaims,
    notes,
  };
}

function stripTranscriptSpeakerIdentifiers(value = "") {
  return String(value || "").replace(/^\s*SPEAKER[_ ]?[0-9][0-9A-Z]*:\s*/gimu, "");
}

function maskNumericDetailForPrompt(value = "") {
  const withoutSpeakerIdentifiers = stripTranscriptSpeakerIdentifiers(value);
  const withoutArabicNumbers = withoutSpeakerIdentifiers.replace(
    /(?<![A-Za-z])[$€£]?\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th)?(?![A-Za-z])/giu,
    "",
  );
  return withoutArabicNumbers.replace(
    new RegExp(`\\b${NUMERIC_WORD_TOKEN}\\b`, "giu"),
    "",
  );
}

function resolveMeetingBodyLabel(transcriptDir = "") {
  const meetingJsonPath = path.join(path.dirname(String(transcriptDir || "")), "meeting.json");
  try {
    const meeting = JSON.parse(fs.readFileSync(meetingJsonPath, "utf8"));
    return normalizeText(meeting?.payload?.meeting_name || meeting?.payload?.meeting_type || "");
  } catch {
    return "";
  }
}

function abridgeUtf8(text = "", maxBytes = 6000) {
  const value = String(text || "");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  const limit = Math.max(0, Number(maxBytes) || 0);
  // Keep a bounded middle window as well as the opening and closing context.
  // Parent audits use this helper on already losslessly chunked source: a
  // head/tail-only view can hide the one literal passage that supports a
  // child summary while exposing unrelated later questions or handoffs.
  const headBytes = Math.floor(limit * 0.3);
  const middleBytes = Math.floor(limit * 0.4);
  const tailBytes = Math.max(0, limit - headBytes - middleBytes);
  let headEnd = headBytes;
  while (headEnd > 0 && (bytes[headEnd] & 0xc0) === 0x80) headEnd -= 1;
  let middleStart = Math.max(headEnd, Math.floor((bytes.length - middleBytes) / 2));
  while (middleStart < bytes.length && (bytes[middleStart] & 0xc0) === 0x80) middleStart += 1;
  let middleEnd = Math.min(bytes.length, middleStart + middleBytes);
  while (middleEnd > middleStart && (bytes[middleEnd] & 0xc0) === 0x80) middleEnd -= 1;
  let tailStart = Math.max(middleEnd, bytes.length - tailBytes);
  while (tailStart < bytes.length && (bytes[tailStart] & 0xc0) === 0x80) tailStart += 1;
  return [
    bytes.subarray(0, headEnd).toString("utf8"),
    bytes.subarray(middleStart, middleEnd).toString("utf8"),
    bytes.subarray(tailStart).toString("utf8"),
  ].join(" […] ");
}


function stripLeadingAgendaNumber(text = "") {
  return normalizeText(String(text || "").replace(/^\d+(?:\.[a-z0-9]+)*\s*/iu, ""));
}

function structuredIdentityPhrases(label = "") {
  const text = stripLeadingAgendaNumber(label);
  if (!text) return [];
  const phrases = [];
  const add = (value = "") => {
    const phrase = normalizeText(value);
    if (phrase.split(/\s+/u).filter(Boolean).length < 2) return;
    if (!phrases.includes(phrase)) phrases.push(phrase);
  };
  const namedBody = text.match(/\b(?:of|from)\s+(?:the\s+)?(.+?)(?:\s+meeting\b|\s+held\b|\s+re\b|$)/iu);
  if (namedBody) add(namedBody[1]);
  const beforeMeeting = text.match(/\b((?:[\p{L}\d][\p{L}\d'’-]*\s+){1,8}(?:committee|board|council|authority|department|administrator|manager))\b/iu);
  if (beforeMeeting) add(beforeMeeting[1]);
  return phrases.sort((a, b) => b.length - a.length);
}

const CONTAINER_HANDOFF_PATTERNS = [
  /\b(?:we|we\x27ll|we will|let\x27s|let us|the meeting)\s+(?:now\s+)?(?:jump|move|return|go back|proceed)\s+to\b/iu,
  /\b(?:jump|move|return|go back|proceed)\s+to\s+(?:the\s+)?(?:main agenda|committee minutes|minutes|the next item|the next agenda item|another agenda item)\b/iu,
];
const NEXT_AGENDA_HANDOFF_PATTERNS = [
  /\b(?:right\s+)?back to .* for the next (?:set|item|agenda item)\b/iu,
  /\b(?:move|moving|go|going|proceed|return)\s+(?:on\s+)?to\s+the next (?:set|item|agenda item)\b/iu,
  /\b(?:move|moving|go|going|proceed|return|continue)\s+(?:on\s+)?to\s+(?:number|item)\s+(?:\d+|[a-z]+(?:-[a-z]+)?)(?:\.[a-z0-9]+)?\b/iu,
  /\b(?:next|now)\s+(?:at|is)\s+(?:number|item)\s+(?:\d+|[a-z]+(?:-[a-z]+)?)(?:\.[a-z0-9]+)?\b/iu,
];

function firstContainerHandoffSource(rawSource = "") {
  const lines = String(rawSource || "")
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (CONTAINER_HANDOFF_PATTERNS.some((pattern) => pattern.test(lines[index]))) {
      return {
        source: lines[index],
        phrase: lines[index].trim(),
      };
    }
  }
  const normalized = normalizeText(rawSource);
  for (const pattern of CONTAINER_HANDOFF_PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const sentenceEnd = normalized.search(/[.!?](?:\s|$)/u, match.index);
    const end = sentenceEnd >= 0 ? sentenceEnd + 1 : normalized.length;
    return {
      source: normalized.slice(0, end).trim(),
      phrase: normalized.slice(match.index, end).trim(),
    };
  }
  return null;
}

function firstNextAgendaHandoffSource(rawSource = "") {
  const lines = String(rawSource || "")
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const handoffPattern = NEXT_AGENDA_HANDOFF_PATTERNS.find((pattern) => pattern.test(lines[index]));
    if (handoffPattern) {
      const match = handoffPattern.exec(lines[index]);
      const matchIndex = match?.index || 0;
      const sentenceOffset = lines[index].slice(matchIndex).search(/[.!?](?:\s|$)/u);
      const lineEnd = sentenceOffset >= 0
        ? lines[index].slice(0, matchIndex + sentenceOffset + 1)
        : lines[index];
      return {
        source: [...lines.slice(0, index), lineEnd].join(" "),
        phrase: lines[index].trim(),
      };
    }
  }
  return null;
}

export function scopeSourceAtStructuredHandoff(unit = {}, nextUnit = {}) {
  const rawSource = String(unit?.["source excerpt"] || "");
  const source = normalizeText(rawSource);
  if (!source) return { source, changed: false, phrase: "" };
  if (String(unit?.status || "").toLowerCase() === "container") {
    const containerHandoff = firstContainerHandoffSource(rawSource);
    if (containerHandoff && containerHandoff.source.length < source.length) {
      return { ...containerHandoff, changed: true };
    }
  }
  const nextAgendaHandoff = firstNextAgendaHandoffSource(rawSource);
  if (nextAgendaHandoff && nextAgendaHandoff.source.length < source.length) {
    return { ...nextAgendaHandoff, changed: true };
  }
  const nextPhrases = structuredIdentityPhrases(nextUnit?.label || "");
  const currentPhrases = new Set(structuredIdentityPhrases(unit?.label || ""));
  const sourceLower = source.toLowerCase();
  const currentIsMinutes = /\bminutes\b/iu.test(String(unit?.label || ""));
  for (const phrase of nextPhrases) {
    if ([...currentPhrases].some((currentPhrase) => currentPhrase.includes(phrase) || phrase.includes(currentPhrase))) continue;
    const index = sourceLower.indexOf(phrase.toLowerCase());
    if (index <= 0) continue;
    if (currentIsMinutes) {
      const context = source.slice(Math.max(0, index - 180), Math.min(source.length, index + phrase.length + 180));
      const isReferencedMinutesReport = /\b(?:received|presented|reported|discussed)\s+(?:a\s+)?(?:report|presentation|update)\s+from\b/iu.test(context)
        || /\breport\s+from\b/iu.test(context);
      if (isReferencedMinutesReport) continue;
    }
    return {
      source: source.slice(0, index).trim(),
      changed: true,
      phrase,
    };
  }
  return { source, changed: false, phrase: "" };
}

function countWords(text = "") {
  if (!String(text || "").trim()) return 0;
  return String(text || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function splitSentences(text = "") {
  const clean = normalizeText(text);
  if (!clean) return [];
  const abbreviationMarker = "\uE000";
  const protectedText = clean.replace(
    /\b(No|Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|vs|etc)\./giu,
    (_, abbreviation) => `${abbreviation}${abbreviationMarker}`,
  );
  const parts = protectedText
    .split(/(?<=[.!?])\s+/u)
    .map((x) => normalizeText(x).replaceAll(abbreviationMarker, "."))
    .filter(Boolean);
  if (parts.length) return parts;
  return [clean];
}

function seemsCompleteSentence(sentence = "") {
  const s = normalizeText(sentence);
  if (!s) return false;
  return /[.!?]["')\]]*$/u.test(s);
}

function isOutcomeSentence(sentence = "") {
  const s = String(sentence || "").toLowerCase();
  return /(approved|defeated|carried|voted|directed|passed|denied|adopted|rejected|motion|resolution)/u.test(s);
}

function chooseSentenceToDrop(sentences = []) {
  if (!sentences.length) return -1;
  if (sentences.length === 1) return 0;
  const outcomeIndexes = new Set();
  for (let i = 0; i < sentences.length; i += 1) {
    if (isOutcomeSentence(sentences[i])) outcomeIndexes.add(i);
  }
  // Prefer dropping the latest non-outcome sentence.
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (!outcomeIndexes.has(i)) return i;
  }
  // Fallback to dropping the last sentence.
  return sentences.length - 1;
}

function cleanupIncompleteTail(sentences = [], { allowOriginalEllipsis = false } = {}) {
  const out = sentences.slice();
  while (out.length) {
    const last = normalizeText(out[out.length - 1] || "");
    if (!last) {
      out.pop();
      continue;
    }
    if (last.endsWith("...") && !allowOriginalEllipsis) {
      out.pop();
      continue;
    }
    if (!seemsCompleteSentence(last)) {
      out.pop();
      continue;
    }
    if (/^(So you|And so|But then|I mean),?\s+/iu.test(last) || /\bSpeaker\s+\d+\s+Section\s+\d+\b/iu.test(last)) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

function isTranscriptScrapSentence(sentence = "") {
  const s = normalizeText(sentence);
  if (!s) return false;
  return /^(So you|So when|And so|But then|I mean),?\s+/iu.test(s)
    || /\bSpeaker\s+\d+\s+Section\s+\d+\b/iu.test(s);
}

function cleanupTranscriptScrapSentences(sentences = []) {
  return sentences.filter((s) => !isTranscriptScrapSentence(s));
}

function cleanupTranscriptScrapText(text = "") {
  return normalizeText(cleanupTranscriptScrapSentences(splitSentences(text)).join(" "));
}

function summaryHasMinimalCompleteness(summary = "") {
  const s = normalizeText(summary);
  if (!s) return false;
  const words = s.split(/\s+/u).filter(Boolean);
  if (words.length < 5) return false;
  // Requires at least one action/description cue.
  if (!/(is|was|were|has|had|have|approved|defeated|carried|voted|directed|passed|considered|reported|discussed|adopted|denied|rejected)/iu.test(s)) {
    return false;
  }
  return true;
}

function hasEmbeddedArtifactJson(text = "") {
  const s = String(text || "");
  return /\[\s*\{\s*"index"\s*:\s*\d+\s*,\s*"unit id"/u.test(s)
    || /"schema version"\s*:\s*"agenda_summary_v1"/u.test(s)
    || /"grounding status"\s*:\s*"grounded"/u.test(s);
}

function assertCleanStage3Text(text = "", where = "stage3 text") {
  const s = normalizeText(text);
  if (!s) return;
  if (hasEmbeddedArtifactJson(s)) {
    throw new Error(`${where} defective: embedded artifact json`);
  }
  if (/\[(?:number|amount|date|address|unknown)\]/iu.test(s)) {
    throw new Error(`${where} defective: unresolved generation placeholder`);
  }
}

const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const ORDINAL_WORD = "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth)";
const HYPHENATED_NUMBER_WORDS = new RegExp(`\\b${NUMBER_WORD}(?:-${NUMBER_WORD})+\\b`, "giu");
const SPELLED_STREET_ORDINAL = new RegExp(`\\b${ORDINAL_WORD}\\s+(?:Avenue|Street|Road|Highway|Boulevard|Drive|Lane|Line|Concession)\\b`, "giu");
const NUMERIC_WORD_TOKEN = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)";
const SPELLED_NUMBER_PHRASE = new RegExp(`\\b${NUMERIC_WORD_TOKEN}(?:[ -]+(?:and[ -]+)?${NUMERIC_WORD_TOKEN})*\\b`, "giu");
const MIXED_MAGNITUDE_NUMBER = new RegExp(`\\b\\d+\\s+(?:hundred|thousand)(?:\\s+and\\s+(?:\\d+|${NUMERIC_WORD_TOKEN}))?\\b`, "giu");

function numericFidelityDefects(text = "") {
  const value = String(text || "");
  const malformedHyphenatedNumbers = Array.from(value.matchAll(HYPHENATED_NUMBER_WORDS), (match) => match[0])
    // Repeated idioms such as "fifty-fifty" are ordinary prose, not a
    // speech-to-text rendering of a multi-digit number such as "twelve-eight".
    .filter((candidate) => {
      const parts = candidate.toLowerCase().split("-");
      return new Set(parts).size > 1;
    });
  const spelledNumberPhrases = Array.from(value.matchAll(SPELLED_NUMBER_PHRASE))
    // A standalone cardinal such as "twelve members" is valid prose. Reserve
    // hard notation repair for compound forms and numbered street ordinals;
    // factual support for every Arabic numeric token is enforced separately.
    .filter((match) => /[ -]/u.test(match[0]))
    .filter((match) => {
      if (!/^(?:hundred|thousand|million|billion)$/iu.test(match[0])) return true;
      return !/\d\s*$/u.test(value.slice(0, Number(match.index || 0)));
    })
    .filter((match) => {
      if (!/^one$/iu.test(match[0])) return true;
      const following = value.slice(Number(match.index || 0) + match[0].length);
      // "one of" selects a member and "one-time" is a lexical modifier.
      // Neither is malformed numeric notation, and forcing them through the
      // quantity mapper can turn valid civic prose into "1 of" or "1-time".
      return !/^(?:\s+of\b|-time\b)/iu.test(following);
    })
    .map((match) => match[0]);
  return [
    ...malformedHyphenatedNumbers,
    ...Array.from(value.matchAll(SPELLED_STREET_ORDINAL), (match) => match[0]),
    ...Array.from(value.matchAll(MIXED_MAGNITUDE_NUMBER), (match) => match[0]),
    ...spelledNumberPhrases,
  ];
}

function hasNumericClaim(text = "") {
  return /\d/u.test(String(text || "")) || numericFidelityDefects(text).length > 0;
}

export function numericAuditSourceExcerpt(sourceExcerpt = "") {
  const source = String(sourceExcerpt || "");
  const rows = source.includes("\n") ? source.split(/\n+/u) : splitSentences(source);
  const numericToken = new RegExp(`(?:\\d|\\b${NUMERIC_WORD_TOKEN}\\b)`, "iu");
  const selected = new Set();
  rows.forEach((row, index) => {
    const spokenText = row.replace(/^SPEAKER_[0-9A-Z]+:\s*/u, "");
    if (!numericToken.test(spokenText)) return;
    for (let contextIndex = Math.max(0, index - 1); contextIndex <= Math.min(rows.length - 1, index + 1); contextIndex += 1) {
      selected.add(contextIndex);
    }
  });
  return [...selected].sort((a, b) => a - b).map((index) => rows[index]).join("\n");
}

async function repairNumericFidelityLlmStrict({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  llmModel = "",
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  // Arabic digits already satisfy the notation contract. Avoid asking the
  // model to restate a source-heavy numeric audit when there is no malformed
  // phrase to repair; that audit can otherwise copy attachment text into the
  // auxiliary chapter field and truncate its JSON response.
  if (!numericFidelityDefects(`${currentSummary} ${currentChapterText}`).length) {
    return { summary: currentSummary, chapterText: currentChapterText };
  }
  // Numeric review only needs the nearby evidence for claims in the generated
  // fields. Keep source and auxiliary headline text bounded so the model does
  // not copy a whole attachment into a JSON field while auditing it.
  const numericSourceExcerpt = numericAuditSourceExcerpt(sourceExcerpt).slice(0, 6000);
  let lastAuditValid = false;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const defects = [
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ];
    if (attempt > 1 && lastAuditValid && !defects.length) break;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_NUMERIC_AUDIT_RESPONSE_FORMAT,
      system: "You correct numeric notation in generated civic summaries. Return strict JSON only.",
      prompt: [
        "Audit and correct only numeric notation in the generated fields using the grounded source.",
        "Return JSON with exactly: summary, chapter text, numeric valid.",
        "numeric valid must be true only when every number, year, date, quantity, percentage, currency amount, and numbered street in both generated fields is supported by the grounded source and uses Arabic digits.",
        "Keep all non-numeric wording and sentence structure unchanged.",
        "Use Arabic digits for every listed quantity and numbered street ordinal, even when the grounded source spells it in words.",
        "Also repair unlisted numeric discrepancies such as shortened years (225 instead of 2025), mixed digit-word years (two thousand and 27), dropped digits, or a number that disagrees with the grounded source.",
        `The output must not contain any of these exact malformed forms: ${defects.map((value) => JSON.stringify(value)).join(", ")}.`,
        "Examples: Sixth Street becomes 6th Street; Ninth Avenue becomes 9th Avenue; seventy-seven becomes 77.",
        "Do not invent, calculate, omit, or change any fact.",
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText.slice(0, 600)}`,
        `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || currentSummary);
    currentChapterText = normalizeText(parsed?.["chapter text"] || currentChapterText);
    lastAuditValid = parsed?.["numeric valid"] === true;
  }
  for (let mappingAttempt = 1; mappingAttempt <= 3; mappingAttempt += 1) {
    const remaining = [...new Set([
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ])];
    if (!remaining.length) break;
    for (const defect of remaining) {
      // Ask for one exact mapping at a time. In a batch, the model can
      // repeatedly omit short valid quantities while repairing a more complex
      // phrase, leaving an otherwise grounded substantive item unpublished.
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        maxOutputTokens: 128,
        format: STAGE3_NUMERIC_REPLACEMENT_RESPONSE_FORMAT,
        system: "You convert exact English numeric phrases to Arabic numeric notation. Return strict JSON only.",
        prompt: [
          "Return one replacement for the listed exact phrase as JSON: {\"replacements\":[{\"from\":\"Sixth Street\",\"to\":\"6th Street\"}]}",
          "The from value must be copied exactly from the list. The to value must contain an Arabic digit and preserve any non-numeric noun such as Street or Avenue.",
          "Return only the numeric equivalent, not surrounding words or prose, and do not omit the listed phrase.",
          `PHRASES: ${JSON.stringify([defect])}`,
          `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
        ].join("\n\n"),
      });
      const replacements = Array.isArray(parsed?.replacements) ? parsed.replacements : [];
      const replacement = replacements.find((entry) => String(entry?.from || "").toLowerCase() === defect.toLowerCase());
      const to = normalizeText(replacement?.to || "");
      if (!to || !/\d/u.test(to) || numericFidelityDefects(to).length) continue;
      currentSummary = currentSummary.replaceAll(defect, to);
      currentChapterText = currentChapterText.replaceAll(defect, to);
    }
  }
  for (let rewriteAttempt = 1; rewriteAttempt <= 3; rewriteAttempt += 1) {
    const remaining = [...new Set([
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ])];
    if (!remaining.length) break;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_TWO_FIELD_RESPONSE_FORMAT,
      system: "You resolve malformed numeric notation in grounded civic summaries. Return strict JSON only.",
      prompt: [
        "Rewrite both generated fields so none of the listed malformed numeric phrases remain.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        "If the grounded source unambiguously supplies the numeric value, render it with Arabic digits.",
        "If the spoken form is ambiguous, omit only the numeric claim while preserving the complete supported civic action or outcome as grammatical prose.",
        "Do not add, calculate, or substitute any quantity, date, time, address, percentage, currency amount, or other fact.",
        `MALFORMED_PHRASES: ${JSON.stringify(remaining)}`,
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText}`,
        `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || currentSummary);
    currentChapterText = normalizeText(parsed?.["chapter text"] || currentChapterText);
  }
  return {
    summary: normalizeText(normalizeUnambiguousSpokenNumbers(currentSummary)),
    chapterText: normalizeText(normalizeUnambiguousSpokenNumbers(currentChapterText)),
  };
}

export async function rewriteWithoutNumericClaimsLlm({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  llmModel = "",
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const freshFromSource = attempt >= 3;
    const rejectedNumericPhrases = [...new Set([
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ])];
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_TWO_FIELD_RESPONSE_FORMAT,
      system: "You write grounded civic summaries without numeric claims. Return strict JSON only.",
      prompt: [
        `Correction attempt ${attempt} of 6.`,
        "Rewrite the prior generated summary and chapter text qualitatively.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        "Preserve the supported civic action, discussion, decision, and outcome as complete grammatical prose.",
        "Do not write any digits, clock times, dates, quantities, percentages, currency amounts, numbered addresses, or spelled-out number phrases.",
        rejectedNumericPhrases.length
          ? `The previous draft contained these exact rejected numeric phrases; do not repeat them or any close variant: ${JSON.stringify(rejectedNumericPhrases)}.`
          : "",
        "When a sentence cannot be written without a numeric claim, replace that sentence with a qualitative description of the supported policy, financing approach, decision, or outcome.",
        attempt >= 3
          ? "Previous corrections still contained numeric language. Start both fields over as fresh qualitative civic prose; do not preserve comparisons, totals, dates, or amounts."
          : "",
        attempt >= 5
          ? "Focus only on the supported civic action and outcome. Omit every financial comparison and quantitative detail."
          : "",
        "Do not add facts. Do not mention processing, source text, or these instructions.",
        freshFromSource ? "Write fresh prose from the grounded source below. The rejected numeric draft is intentionally omitted so its malformed number phrases cannot be recopied." : `PRIOR_SUMMARY: ${currentSummary}`,
        freshFromSource ? "Omit contact information, roll-call details, addresses, dates, times, totals, amounts, and every other quantitative detail." : `PRIOR_CHAPTER_TEXT: ${currentChapterText}`,
        freshFromSource ? `GROUNDED_SOURCE: ${String(sourceExcerpt || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}` : "The grounded source is intentionally omitted during revision. Preserve only non-numeric facts already present in the prior generated fields.",
      ].join("\n\n"),
    });
    currentSummary = normalizeText(normalizeUnambiguousSpokenNumbers(parsed?.summary || ""));
    currentChapterText = normalizeText(normalizeUnambiguousSpokenNumbers(parsed?.["chapter text"] || ""));
    if (currentSummary
      && !/\d/u.test(`${currentSummary} ${currentChapterText}`)
      && !numericFidelityDefects(`${currentSummary} ${currentChapterText}`).length) {
      break;
    }
  }
  if (!currentSummary) {
    throw new Error("stage3 retryable: configured text model returned an empty qualitative summary");
  }
  return { summary: currentSummary, chapterText: currentChapterText };
}

export async function repairNumericFidelityLlm(options = {}) {
  try {
    return await repairNumericFidelityLlmStrict(options);
  } catch (error) {
    // A malformed numeric-audit response is a retryable model failure, not
    // permission to publish the rejected draft. Ask the configured local
    // model for a fresh qualitative rewrite so the civic action survives
    // while all quantitative claims are omitted safely.
    const qualitative = await rewriteWithoutNumericClaimsLlm(options);
    if (!normalizeText(qualitative?.summary || "")) throw error;
    return qualitative;
  }
}

export async function repairUnsupportedNumericClaimsLlm({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  unsupportedTokens = [],
  llmModel = "",
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  const repairGroundingSource = String(sourceExcerpt || "")
    .split(/\n/u)
    .map((line) => line.replace(/^\s*SPEAKER_[0-9A-Z]+:\s*/u, ""))
    .join("\n");
  let unsupported = [...new Set(unsupportedTokens.map((value) => normalizeText(value)).filter(Boolean))];
  for (let attempt = 1; attempt <= 4 && unsupported.length; attempt += 1) {
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      // Numeric repair only returns two bounded prose fields. A large output
      // allowance lets qwen continue explaining the repair until its JSON is
      // truncated or malformed on long source excerpts; keep the response
      // inside the downstream summary budget instead.
      maxOutputTokens: 720,
      format: STAGE3_TWO_FIELD_RESPONSE_FORMAT,
      system: "Remove unsupported numeric claims from generated civic summaries. Return strict JSON only.",
      prompt: [
        "Correct the generated summary and chapter text using only the grounded source.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        "Keep each field concise: at most two complete sentences and 120 words. Return no explanation outside the JSON object.",
        `These numeric tokens are unsupported and must not remain unless the grounded source supplies their exact value: ${unsupported.join(", ")}.`,
        "If the grounded source gives the correct value, use it. Otherwise omit the unsupported quantity while preserving a complete factual sentence.",
        "Transcript speaker identifiers are internal metadata, not people or facts. Never mention labels such as SPEAKER_072 or Speaker 072 in either generated field.",
        "Do not introduce a replacement number, date, address, percentage, or currency amount that is absent from the grounded source.",
        attempt >= 2
          ? "The prior correction introduced another unsupported number. Rewrite both fields without any numeric claims or spelled-out quantities; state the supported substance qualitatively."
          : "",
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText}`,
        `GROUNDED_SOURCE: ${repairGroundingSource.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || "");
    currentChapterText = normalizeText(parsed?.["chapter text"] || "");
    unsupported = unsupportedNumericTokens(
      `${currentSummary} ${currentChapterText}`,
      sourceExcerpt,
    );
  }
  return {
    summary: currentSummary,
    chapterText: currentChapterText,
    unsupportedTokens: unsupported,
  };
}

function looksProceduralLabel(label = "") {
  const lower = String(label || "").toLowerCase();
  return (
    lower.includes("call to order") ||
    lower.includes("adoption of agenda") ||
    lower.includes("declaration of interest") ||
    lower.includes("confirmation of minutes") ||
    lower.includes("minutes") ||
    lower.includes("correspondence") ||
    lower.includes("adjourn") ||
    lower.includes("opening remarks")
  );
}

function buildSummaryBudget(unit = {}) {
  const durationSeconds = Number(unit["duration seconds"] || 0);
  const sourceRows = Number(unit["source rows"] || 0);
  const excerpt = String(unit["source excerpt"] || "");
  const sourceChars = excerpt.length;
  const splitParts = Number(unit["part total"] || 1);
  const procedural = looksProceduralLabel(unit.label || unit["agenda item"] || "");

  const tiny = durationSeconds <= 75 || sourceRows <= 6 || sourceChars <= 350;
  const short = durationSeconds <= 180 && sourceRows <= 18 && sourceChars <= 1200;
  const medium = durationSeconds <= 780 && sourceRows <= 120;
  const long = durationSeconds <= 1800 && sourceRows <= 260;

  if (procedural && tiny) {
    return {
      tier: "tiny_procedural",
      maxSentences: 1,
      maxWords: 22,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (short || (procedural && durationSeconds <= 300 && sourceRows <= 30)) {
    return {
      tier: "short",
      maxSentences: procedural ? 1 : 2,
      maxWords: procedural ? 32 : 48,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (medium) {
    return {
      tier: "medium",
      maxSentences: 4,
      maxWords: 130,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (long) {
    return {
      tier: "long",
      maxSentences: 6,
      maxWords: 220,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  return {
    tier: "very_long",
    maxSentences: 8,
    maxWords: 320,
    minSentences: 2,
    paragraphCap: splitParts > 1 ? 1 : 2,
    procedural,
    durationSeconds,
    sourceRows,
    sourceChars,
    splitParts,
  };
}

function enforceSummaryBudget(rawSummary = "", budget = {}) {
  const before = normalizeText(rawSummary);
  if (!before) return "";
  const allowOriginalEllipsis = before.endsWith("...");
  const maxSentences = Number.isFinite(Number(budget.maxSentences)) ? Number(budget.maxSentences) : 0;
  const maxWords = Number.isFinite(Number(budget.maxWords)) ? Number(budget.maxWords) : 0;
  const minSentences = Math.max(1, Number.isFinite(Number(budget.minSentences)) ? Number(budget.minSentences) : 1);
  // A long span can inherit a procedural agenda label while containing
  // substantive material (for example, call to order followed immediately by
  // an audit presentation). Only compact genuinely short procedural spans.
  const compactProcedural = Boolean(budget.procedural)
    && ["tiny_procedural", "short"].includes(String(budget.tier || ""));

  let sentences = splitSentences(before);
  sentences = cleanupTranscriptScrapSentences(sentences);
  sentences = cleanupIncompleteTail(sentences, { allowOriginalEllipsis });
  if (!sentences.length) return "";
  const fullSentences = sentences.slice();

  // 1) Sentence-first clamp
  if (compactProcedural) {
    sentences = sentences.slice(0, 1);
  } else if (maxSentences > 0 && sentences.length > maxSentences) {
    sentences = sentences.slice(0, maxSentences);
  }

  // 2) If still over word budget, drop whole sentences (never mid-sentence).
  if (maxWords > 0) {
    while (sentences.length > minSentences && countWords(sentences.join(" ")) > maxWords) {
      const idx = chooseSentenceToDrop(sentences);
      if (idx < 0) break;
      sentences.splice(idx, 1);
    }
    // If one sentence is still over budget, keep it as-is to avoid fragmenting.
  }

  if (!compactProcedural && sentences.length < minSentences && fullSentences.length >= minSentences) {
    sentences = fullSentences.slice(0, minSentences);
    const hasOutcome = sentences.some((x) => isOutcomeSentence(x));
    if (!hasOutcome) {
      const outcome = fullSentences.find((x) => isOutcomeSentence(x));
      if (outcome && minSentences >= 2) sentences[minSentences - 1] = outcome;
    }
  }

  // 3) Completeness guard pass ("regenerate once" analog in post-gen enforcement):
  // do one stricter cleanup attempt, then drop incomplete tail.
  let summary = normalizeText(sentences.join(" "));
  if (!summaryHasMinimalCompleteness(summary)) {
    let strictSentences = splitSentences(summary);
    strictSentences = cleanupTranscriptScrapSentences(strictSentences);
    strictSentences = cleanupIncompleteTail(strictSentences, { allowOriginalEllipsis: false });
    if (strictSentences.length > Math.max(1, minSentences) && !summaryHasMinimalCompleteness(strictSentences.join(" "))) {
      strictSentences = strictSentences.slice(0, strictSentences.length - 1);
    }
    if (!compactProcedural && strictSentences.length < minSentences && fullSentences.length >= minSentences) {
      strictSentences = fullSentences.slice(0, minSentences);
    }
    summary = normalizeText(strictSentences.join(" "));
  }

  if ((budget.paragraphCap || 1) <= 1) {
    summary = normalizeText(summary.replace(/\n+/gu, " "));
  } else {
    summary = summary.replace(/\n{3,}/gu, "\n\n").trim();
  }

  // Never emit ellipsis artifacts unless present in original source summary.
  if (!allowOriginalEllipsis && summary.endsWith("...")) {
    const retry = cleanupIncompleteTail(splitSentences(summary), { allowOriginalEllipsis: false });
    summary = normalizeText(retry.join(" "));
  }
  summary = cleanupTranscriptScrapText(summary);
  return summary;
}

function wordsKey(text = "") {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isHeadingLikeChapterText(chapterText = "", heading = "") {
  const c = wordsKey(stripLeadingAgendaNumber(chapterText));
  const h = wordsKey(stripLeadingAgendaNumber(heading));
  if (!c || !h) return false;
  if (c === h) return true;
  if (c.length < 24 && (h.includes(c) || c.includes(h))) return true;
  if (h === "next meeting" && c === "next meeting") return true;
  return false;
}

function chapterFromSummary(summary = "") {
  const sentences = splitSentences(summary).filter(Boolean);
  const complete = sentences.find((s) => seemsCompleteSentence(s));
  if (complete) {
    const full = normalizeText(complete.replace(/[.,;:]+$/u, ""));
    const fullWords = full.split(/\s+/u).filter(Boolean).length;
    if (fullWords <= 24) return full;
  }
  const base = normalizeText(complete || sentences[0] || summary || "");
  if (!base) return "";
  let out = base.replace(/[.,;:]+$/u, "").trim();
  let words = out.split(/\s+/u).filter(Boolean);
  if (words.length > 18) words = words.slice(0, 18);
  while (words.length > 3) {
    const tail = String(words[words.length - 1] || "").toLowerCase();
    if (!new Set(["a", "an", "the", "to", "of", "for", "and", "or", "with", "by", "on", "in", "at", "from"]).has(tail)) break;
    words = words.slice(0, words.length - 1);
  }
  out = words.join(" ");
  return normalizeText(out);
}

const SPLIT_GENERIC_PREFIXES = [
  "adjournment",
  "next meeting",
  "appeals",
  "appeal",
  "call to order",
  "declarations of interest",
  "announcement by the chair",
];

function trimStopwordTail(words = []) {
  const stop = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "with", "by", "on", "in", "at", "from", "against", "about", "over", "under", "into", "onto", "across", "between", "among", "around", "during", "without", "within", "despite", "concerning", "regarding", "per"]);
  let out = words.slice();
  while (out.length > 3 && stop.has(String(out[out.length - 1] || "").toLowerCase())) out = out.slice(0, out.length - 1);
  return out;
}

function isLikelyFragmentEnding(words = []) {
  if (!Array.isArray(words) || !words.length) return false;
  const last = String(words[words.length - 1] || "").toLowerCase();
  const prev = String(words[words.length - 2] || "").toLowerCase();
  const fragmentLast = new Set(["other", "live", "following", "regarding", "including", "against", "lack", "prompting", "citing", "requiring", "mandating", "using", "based", "through", "disproportionate", "due", "relied", "submitted", "physical", "which", "unverified", "request", "procedural", "definition", "bug", "bed", "calling", "rising", "while", "will", "and", "or", "with", "despite", "arguing", "claiming", "proposing", "seeking", "requesting", "discussing", "considering", "reviewing", "raising", "explaining", "supporting", "opposing", "urging", "questioning", "noting", "warning", "targeting", "highlighting"]);
  const danglingPrev = new Set(["of", "for", "from", "with", "to", "by", "in", "on", "at", "under", "over", "despite", "including", "regarding", "due"]);
  if (fragmentLast.has(last)) return true;
  if (danglingPrev.has(last)) return true;
  if (danglingPrev.has(prev) && words.length >= 6) return true;
  return false;
}

function toTitleCaseWords(words = []) {
  return words.map((w, idx) => {
    const t = String(w || "").trim();
    if (!t) return "";
    if (/^[A-Z0-9-]{2,}$/u.test(t)) return t;
    const lower = t.toLowerCase();
    if (idx > 0 && /^(and|or|of|for|to|in|on|at|by|with|from|the|a|an)$/u.test(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).filter(Boolean);
}

function stripSplitHeadingPrefix(text = "", heading = "") {
  let out = normalizeText(text);
  const headingCore = stripLeadingAgendaNumber(heading).toLowerCase();
  if (headingCore) {
    const escaped = headingCore.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    out = out.replace(new RegExp(`^${escaped}\\s*[:\\-–—]\\s*`, "iu"), "");
    out = out.replace(new RegExp(`^${escaped}\\s+`, "iu"), "");
  }
  for (const pref of SPLIT_GENERIC_PREFIXES) {
    const escaped = pref.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    out = out.replace(new RegExp(`^${escaped}\\s*[:\\-–—]\\s*`, "iu"), "");
    if (wordsKey(out) === wordsKey(pref)) out = "";
  }
  return normalizeText(out);
}

function normalizeSplitChapterCandidate(text = "", heading = "") {
  const stripped = stripSplitHeadingPrefix(text, heading);
  if (!stripped) return "";
  let words = stripped.replace(/[.,;:!?]+$/u, "").split(/\s+/u).filter(Boolean);
  words = trimStopwordTail(words);
  while (words.length > 8 && /^(the|a|an)$/iu.test(String(words[0] || ""))) words = words.slice(1);
  if (words.length > 12) words = trimStopwordTail(words.slice(0, 12));
  while (words.length >= 6 && isLikelyFragmentEnding(words)) words = trimStopwordTail(words.slice(0, words.length - 1));
  if (words.length < 6) return "";
  words = toTitleCaseWords(words);
  return normalizeText(words.join(" "));
}

function buildSplitChapterCandidates({ llmText = "", summary = "", heading = "" }) {
  const candidates = [];
  const pushCandidate = (txt) => {
    const c = normalizeSplitChapterCandidate(txt, heading);
    if (c) candidates.push(c);
  };
  pushCandidate(llmText);
  const summarySentences = splitSentences(summary).filter(Boolean);
  for (const s of summarySentences) pushCandidate(s);
  pushCandidate(chapterFromSummary(summary));
  return candidates;
}

function leadingPhraseKey(text = "", size = 3) {
  const words = normalizeText(text).toLowerCase().split(/\s+/u).filter(Boolean);
  return words.slice(0, Math.min(size, words.length)).join(" ");
}

function pickSplitChapterText({ llmText = "", summary = "", heading = "", seenLeadPhrases = new Set() }) {
  const candidates = buildSplitChapterCandidates({ llmText, summary, heading });
  const hasForbidden = (cand) => SPLIT_GENERIC_PREFIXES.some((p) => wordsKey(cand).startsWith(wordsKey(p)));
  const parentWords = new Set(wordsKey(stripLeadingAgendaNumber(heading)).split(" ").filter(Boolean));
  for (const c of candidates) {
    if (hasForbidden(c)) continue;
    if (/^(the\s+discussion\s+addresses|the\s+presentation\s+addresses|the\s+section\s+addresses)\b/iu.test(c)) continue;
    if (/\bOwen Sound Police Service Re\b/iu.test(c) || /\bRe$/iu.test(c)) continue;
    const words = c.split(/\s+/u).filter(Boolean);
    if (words.length < 6 || words.length > 12) continue;
    if (isLikelyFragmentEnding(words)) continue;
    // A child heading that is almost entirely the parent agenda title is not
    // an additional topic and creates noisy duplicate TOC entries. Reject it
    // generically so the bounded title-repair prompt can choose a distinct
    // source-grounded subject instead.
    const parentOverlap = words.filter((word) => parentWords.has(String(word || "").toLowerCase())).length / Math.max(1, words.length);
    if (parentOverlap >= 0.75) continue;
    const lead = leadingPhraseKey(c);
    if (lead && seenLeadPhrases.has(lead)) continue;
    return c.replace(/[.,;:!?]+$/u, "");
  }
  return "";
}

function nextDistinctChapterFromSummary(summary = "", previousChapter = "") {
  const prevKey = wordsKey(previousChapter);
  const sentences = splitSentences(summary).filter(Boolean);
  for (const s of sentences) {
    const candidate = chapterFromSummary(s);
    if (!candidate) continue;
    if (wordsKey(candidate) !== prevKey) return candidate;
  }
  return chapterFromSummary(summary);
}

function finalizeChapterText({ chapterText, heading, summary, splitPart = false, previousChapter = "" }) {
  if (splitPart) {
    return "";
  }
  const fromLlm = normalizeText(chapterText);
  const fromSummary = chapterFromSummary(summary);
  let out = fromLlm || fromSummary || stripLeadingAgendaNumber(heading);
  if (splitPart && isHeadingLikeChapterText(out, heading)) {
    out = fromSummary || out;
  }
  if (splitPart && previousChapter && wordsKey(out) === wordsKey(previousChapter)) {
    out = nextDistinctChapterFromSummary(summary, previousChapter) || out;
  }
  out = normalizeText(out).replace(/[.,;:]+$/u, "");
  return out;
}

function assertExactGroundingRoot(filePath) {
  const lines = String(fs.readFileSync(filePath, "utf8")).split(/\r?\n/u);
  const first = String(lines[0] || "").trim();
  const expected = "su name agenda section grounding artifact be map def";
  if (first !== expected) {
    throw new Error(`stage3 defective: grounding root mismatch at ${filePath}`);
  }
}

function assertExactGroundingSchema(grounding = {}) {
  const version = String(grounding["schema version"] || "");
  const v1 = new Set(["schema version", "generated time", "transcript rows total", "grounded units"]);
  const v2 = new Set([
    "schema version",
    "generated time",
    "canonical source path",
    "canonical source type",
    "canonical fingerprint",
    "transcript rows total",
    "atomic units total",
    "grounded units",
  ]);
  const v3 = new Set([
    ...v2,
    "recording atomic units total",
    "meeting scope audit",
    "prefix scope audit",
  ]);
  const required = version === "agenda_section_grounding_v3"
    ? v3
    : (version === "agenda_section_grounding_v2" ? v2 : v1);
  const allowed = new Set([
    ...required,
    ...(version === "agenda_section_grounding_v3" ? ["boundary recovery version"] : []),
  ]);
  const keys = Object.keys(grounding || {});
  for (const k of keys) {
    if (!allowed.has(k)) throw new Error(`stage3 defective: unexpected grounding top-level field "${k}"`);
    if (/_/u.test(String(k || ""))) throw new Error(`stage3 defective: snake_case grounding field "${k}"`);
  }
  for (const req of required) {
    if (!Object.hasOwn(grounding, req)) {
      throw new Error(`stage3 defective: missing grounding field "${req}"`);
    }
  }
  if (!["agenda_section_grounding_v1", "agenda_section_grounding_v2", "agenda_section_grounding_v3"].includes(version)) {
    throw new Error("stage3 defective: invalid grounding schema version");
  }
  if (version === "agenda_section_grounding_v3") {
    if (Object.hasOwn(grounding, "boundary recovery version")
      && grounding["boundary recovery version"] !== "minutes_like_child_boundaries_v3") {
      throw new Error("stage3 defective: invalid boundary recovery version");
    }
    const recordingTotal = Number(grounding["recording atomic units total"] || 0);
    const scopedTotal = Number(grounding["atomic units total"] || 0);
    const meetingScope = grounding["meeting scope audit"];
    const prefixScope = grounding["prefix scope audit"];
    if (!Number.isInteger(recordingTotal) || recordingTotal < scopedTotal || scopedTotal < 1) {
      throw new Error("stage3 defective: invalid recording/scoped atomic-unit totals");
    }
    if (!meetingScope || typeof meetingScope !== "object" || !String(meetingScope["scope atomic start"] || "")) {
      throw new Error("stage3 defective: missing named-meeting scope audit");
    }
    if (!prefixScope || typeof prefixScope !== "object") {
      throw new Error("stage3 defective: missing in-scope prefix audit");
    }
  }
}

async function callOllamaJson({ ollamaUrl, llmModel, system, systemSuffix = "", appendUniversalContract = true, prompt, maxOutputTokens = 0, temperature = 0, seed = 0, format = "json" }) {
  // A scheduled report may briefly lose the LAN model while another request
  // unloads or reloads. Keep the substantive item retryable through a bounded
  // outage instead of abandoning all previously completed section work after
  // the former ~15-second retry window.
  const maxAttempts = Math.max(1, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS || "9"), 10) || 9);
  // Grounded whole-item audits can include several thousand transcript words.
  // Give the local model enough time to finish them instead of repeatedly
  // aborting healthy in-flight generations at the short-request threshold.
  const timeoutMs = Math.max(5_000, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_TIMEOUT_MS || "300000"), 10) || 300_000);
  const baseDelayMs = Math.max(1, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS || "1500"), 10) || 1500);

  let lastErr = null;
  let lastMalformedContent = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const retryJsonLine = attempt > 1
        ? [
          "\nRetry instruction: return one valid JSON object only. No markdown. Do not leave words unquoted. notes must be a string, not an array.",
          attempt % 2 === 0
            ? "Rebuild the object from scratch and quote every string value, including em-dash phrases. Do not copy malformed syntax."
            : "Repair the rejected shape while preserving the grounded content; use JSON escaping for punctuation and newlines.",
          attempt >= 3
            ? "Return the smallest complete object allowed by the schema. Do not emit reasoning, a preamble, or source text before the opening brace. Keep notes concise."
            : "",
          lastMalformedContent && lastMalformedContent.length <= 2000
            ? `Previous rejected response (do not repeat its syntax): ${lastMalformedContent}`
            : lastMalformedContent
              ? "The previous response was oversized or truncated. Discard it completely and regenerate a concise object from the grounded prompt; do not copy any source text into a field."
              : "",
        ].filter(Boolean).join("\n")
        : "";
      const payload = await requestManagedOllamaChat({
        model: llmModel,
        ollamaUrl,
        managerUrl: process.env.PYA_GPU_HOUSEKEEPER_URL || "",
        messages: [
          { role: "system", content: [system, appendUniversalContract ? UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE : "", systemSuffix].filter(Boolean).join("\n") },
          { role: "user", content: `${prompt}${retryJsonLine}` },
        ],
        format,
        think: false,
        keepAlive: 300,
        options: {
          temperature: Math.max(0, Math.min(1, attempt > 1
            ? Math.max(Number(temperature) || 0, Math.min(0.35, 0.05 * attempt))
            : (Number(temperature) || 0))),
          ...(attempt > 1 || Number(seed) > 0
            ? { seed: (Number(seed) > 0 ? Number(seed) : 0) + attempt }
            : {}),
          ...(Number(maxOutputTokens) > 0
            ? { num_predict: attempt > 1
              ? Math.min(1600, Math.max(Number(maxOutputTokens) + 160, Number(maxOutputTokens) * 2))
              : Number(maxOutputTokens) }
            : {}),
        },
        timeoutMs,
      });
      const content = String(payload?.message?.content || payload?.response || "").trim();
      try { return JSON.parse(content); } catch {}
      const m = content.match(/\{[\s\S]*\}/u);
      if (!m) {
        lastMalformedContent = content;
        throw new Error("unparseable-json");
      }
      lastMalformedContent = m[0];
      try {
        return JSON.parse(m[0]);
      } catch (error) {
        throw new Error(`malformed-json: ${String(error?.message || error)}`);
      }
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err).toLowerCase();
      const retryable = /fetch failed|network|socket|timeout|timed out|econnreset|enotfound|eai_again|unexpected token|json|unparseable|gpu-managed.*(?:failed|timed out)|status\s+(?:408|429|5\d\d)/u.test(msg);
      if (!retryable || attempt >= maxAttempts) break;
      const waitMs = baseDelayMs * attempt;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error("ollama fetch failed");
}

export async function auditCausalRelationshipLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 260,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Audit only causal and purpose relationships in civic-summary prose against literal source evidence. Return strict JSON only.",
    prompt: [
      "Inspect each proposal, business case, recommendation, request, or solution purpose/reason/motivation relationship in CANDIDATE_SUMMARY.",
      "Return grounded=true when every retained causal relationship is explicitly paired in the same bounded source sentence or an unmistakably paired source clause. Return grounded=true when the candidate contains no causal relationship to audit.",
      "Return grounded=false when a candidate joins a proposal to a nearby benefit, consequence, cost, risk, or background topic merely because the source lists or places them nearby. A phrase such as 'this is the case for [subject]' does not make an adjacent benefit the case's purpose. Do not infer a relationship from chronology, adjacency, a list, or a shared speaker label.",
      CAUSAL_RELATIONSHIP_AUDIT_RULE,
      "List only unsupported causal relationships. Do not reject a candidate for omitting a separate benefit or for using two independent source-supported sentences.",
      `AGENDA_LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

export async function auditGroundedSummaryLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
  governingBody = "",
  amendmentEvidence = null,
  speakerHandoffEvidence = null,
  documentSourceOnly = false,
  numericConflictRepairActive = false,
  deferralObjectRepairActive = false,
} = {}) {
  const auditSourceExcerpt = stripTranscriptSpeakerIdentifiers(sourceExcerpt);
  const parentAuditedChildEvidence = /\b(?:PARENT\s+SOURCE\s+EVIDENCE|AUDITED\s+CHILD\s+SUMMARY|CHILD\s+SUMMARY\s+COVERAGE)\b/iu.test(auditSourceExcerpt);
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 420,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Audit one generated civic summary against its bounded transcript source. Return strict JSON only.",
    prompt: [
      "Check every concrete claim in CANDIDATE_SUMMARY against the literal GROUNDED_SOURCE.",
      "Return grounded=true when every retained claim in the candidate's topics, actions, outcomes, institutional subject, timing, amounts, locations, and relationships is stated or clearly entailed by the grounded source. This is an included-claim audit, not a completeness test: omission of secondary context, a supporting qualifier, or one related source detail is acceptable when the retained claim remains true and does not imply a different fact.",
      LITERAL_SOURCE_CLAIM_CHECK_RULE,
      parentAuditedChildEvidence ? PARENT_AUDITED_CHILD_EVIDENCE_RULE : "",
      GENERIC_SPEAKER_QUESTION_RULE,
      EXPLICIT_PROPOSAL_PARAPHRASE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      QUALIFIED_SUPPORT_SPEECH_ACT_RULE,
      TENTATIVE_SPEECH_ACT_FIDELITY_RULE,
      CONDITIONAL_STATEMENT_FIDELITY_RULE,
      CONDITIONAL_RELATIONSHIP_AUDIT_RULE,
      DEFERRAL_PROPOSAL_STATUS_RULE,
      LITERAL_SOURCE_PHASE_PRIORITY_RULE,
      SOURCE_TOPIC_RELATIONSHIP_RULE,
      REFERRED_AGENDA_SCOPE_AUDIT_RULE,
      SEPARATE_REMARKS_SCOPE_RULE,
      GENERIC_SPEAKER_QUESTION_RULE,
      EXPLICIT_PROPOSAL_PARAPHRASE_RULE,
      CAUSAL_RELATIONSHIP_AUDIT_RULE,
      CONDITIONAL_RELATIONSHIP_AUDIT_RULE,
      INFORMAL_DISCUSSION_STATUS_RULE,
      EXPLICIT_NAMED_MOTION_ATTRIBUTION_RULE,
      PARENT_SPEECH_ACT_AND_ACTOR_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      SOURCE_TOPIC_RELATIONSHIP_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      "Accept faithful concise paraphrases and ordinary compression of two facts that are both stated in this same bounded source excerpt.",
      "Accept discussed, reviewed, or considered as ordinary paraphrases for source-recorded substantive discussion when they do not change the acting body or outcome.",
      "Accept discussion or discussed as neutral compression of multiple source remarks, questions, suggestions, or responses about one topic; those words do not assert a formal procedural event unless the candidate also claims a motion, vote, decision, direction, or institutional action.",
      "When a source says 'I would support it' but immediately qualifies that support with a request for more information or another condition, accept only qualified or conditional support; reject unconditional past-tense wording such as 'supported a proposal' when it removes that qualification.",
      "When a chair or clerk says a motion is 'now on the floor for discussion', accept only impersonal status wording such as 'the motion was on the floor for discussion'; reject wording that makes the mover or another participant place or bring the item onto the floor unless the source explicitly assigns that act to them.",
      "Never write the gerund construction 'placing the item on the floor for discussion' for a chair-announced status; rewrite it as 'the motion was on the floor for discussion' or omit the status.",
      "When the supplied bounded source ends mid-phrase or mid-sentence, do not complete the missing object, department, amount, outcome, or qualifier from sibling text, a broader meeting span, or inference; omit the incomplete modifier or use only the literal verified prefix.",
      "Keep an explicit motion subject separate from debate context: do not attach a topic introduced during discussion with 'regarding', 'about', or 'whether' to the motion's object unless the source explicitly states that topic as the motion subject. Report the motion first and put the debate topic in a separate neutral clause or omit it.",
      "Preserve literal actor spelling and identity. Do not normalize, phonetic-match, or infer a mover's or seconder's name from conflicting forms such as Greg, Gray, or Gregg; when the source identity is ambiguous, omit the personal name and use a generic mover or seconder. Do not call an expenditure 'specific' unless the bounded source specifies its object.",
      "Do not reject a true generic moved-and-seconded claim merely because the candidate omits a later 'on the floor for discussion' or similar status qualifier; omission of secondary status is acceptable when the candidate makes no conflicting vote, decision, or outcome claim.",
      "Accept a source-connected paraphrase when the source explicitly supplies the subject and its nearby fact, such as a named partnership followed by the statement that the installation cost is fully funded by that partnership.",
      "When one active motion is under discussion and the source then says that motion is carried, accept the concise motion outcome even if the vote line does not repeat the full motion wording.",
      "When the source explicitly records that a motion was moved and seconded, accept a generic paraphrase such as 'a motion was moved and seconded' without requiring mover or seconder names. Do not reject that conservative omission of names; reject only a wrong motion subject, disposition, or named attribution asserted by the candidate.",
      "High-priority conservative motion audit rule: source-listed mover and seconder names are optional detail. If the candidate says only that the explicitly recorded motion was moved and seconded, it is grounded even when the source names those people; do not treat omission of their names as an unsupported generic actor.",
      "Accept proposal-stage wording such as 'a motion to remove an expenditure was moved and seconded; it was on the floor for discussion' when the source records that motion and status. This wording reports introduction and discussion status only; it does not claim that the proposed removal, approval, or any other motion subject occurred, passed, or was completed. Do not reject it as a completed outcome unless the candidate separately says the subject was carried, approved, enacted, or completed.",
      "A chair's or clerk's procedural announcement such as 'it has been moved by ... and seconded by ...' is itself an explicit source record of the motion being moved and seconded; do not reject a generic moved-and-seconded paraphrase merely because the announcement is not spoken by the mover or because the full motion text is elsewhere in the bounded source.",
      "Treat an explicit announcement such as 'it's been moved by ... and seconded by ...' as direct evidence of motion introduction, not merely a report of floor status. Earlier remarks such as 'put a motion on the floor' do not cancel or weaken that later explicit moved-and-seconded record; retain the proposal-stage motion with no disposition unless the source records one.",
      "Preserve literal actor spelling and identity in named attributions. Do not normalize or phonetic-match conflicting mover names; if the bounded source has forms such as Greg, Gray, or Gregg without a single unambiguous spelling, omit the name and use a generic mover. Do not call an expenditure 'specific' unless the source specifies its object.",
      "Keep motion introduction/reporting separate from institutional disposition: a member who reports or moves a motion is not the actor who carries, approves, defeats, or adopts it unless the source explicitly says so; attribute those outcomes to the body or use a neutral passive construction.",
      "When the source explicitly records a speaker making a recommendation, accept 'a speaker recommended X' or 'a recommendation to X was raised' as the source speech act; do not treat that wording as an adopted, carried, or completed outcome unless the candidate asserts that stronger status.",
      "Accept a generic speech-act paraphrase such as 'a speaker recommended deferral until December 12th pending further information' when the bounded source literally records that recommendation and qualifier. This reports the speaker's recommendation, not a formal motion, vote, agreement, or completed deferral; do not reject it merely because the source does not record a later procedural disposition.",
      "When no formal motion is recorded and the source only says 'I would recommend' or 'I'm wondering if we can amend', prefer 'a speaker suggested' or 'a possible deferral/amendment was mentioned'; do not require or endorse 'a recommendation was raised/made' if that noun phrase could imply procedural completion.",
      "Treat a tentative first-person question such as 'I'm wondering if we can amend' as evidence of a proposed amendment or a speaker proposing an amendment, not evidence that the amendment was formally moved, seconded, voted on, or carried. Treat 'I would recommend a deferral' as evidence that a speaker recommended deferral, not evidence that the item was actually deferred.",
      "Accept neutral speech-act wording such as 'a possible amendment was discussed' or 'a proposed amendment was discussed' when the bounded source records a tentative amendment suggestion, and accept 'a speaker recommended deferral' when the source records that recommendation. The words discussed, proposed, and recommended do not assert that a formal motion was moved, seconded, voted on, carried, or completed unless the candidate separately claims that stronger procedural status.",
      "Preserve conditional relationships: if the source says 'if X, Y could/may happen', do not rewrite it as unconditional discussion or decision about X. Discussion of a possible consequence or future committee review is not discussion of whether to take the underlying action.",
      "Treat willingness or availability to take direction—such as 'happy to', 'open to', or 'can take direction'—as willingness only, not agreement, commitment, a promise to seek direction, or a completed next step.",
      "Treat a speaker's acknowledgment or tentative plan such as 'we'll look to the CAO' or 'we'll take direction' as consultation or willingness, not as a recommendation, direction, commitment, or institutional decision unless the source explicitly uses that stronger speech act.",
      COMPOSITE_MOTION_SCOPE_RULE,
      CONSENT_AGENDA_SCOPE_REPAIR_RULE,
      CATEGORY_ACTION_BINDING_RULE,
      AGENDA_CATEGORY_FRAGMENT_RULE,
      MOTION_AMENDMENT_DISPOSITION_RULE,
      AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      AMENDMENT_EVIDENCE_PRIORITY_RULE,
      amendmentEvidence
        ? `STRUCTURED AMENDMENT EVIDENCE: ${JSON.stringify(amendmentEvidence)}`
        : "",
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      speakerHandoffEvidence
        ? `STRUCTURED SPEAKER-HANDOFF EVIDENCE: ${JSON.stringify(speakerHandoffEvidence)}`
        : "",
      ORDINAL_MOTION_SEQUENCE_RULE,
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      MOTION_VOTE_OMISSION_RULE,
      GENERAL_CONSERVATIVE_OMISSION_AUDIT_RULE,
      LITERAL_NUMERIC_AND_DATE_PRIORITY_RULE,
      numericConflictRepairActive ? NUMERIC_CONFLICT_OMISSION_AUDIT_RULE : "",
      deferralObjectRepairActive ? DEFERRAL_OBJECT_OMISSION_AUDIT_RULE : "",
      PROCEDURAL_FLOOR_STATUS_AUDIT_RULE,
      PROCEDURAL_ABSENCE_AUDIT_RULE,
      REPEATED_SUBJECT_MOTION_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      CURRENT_MEETING_BODY_ATTRIBUTION_RULE,
      "Do not treat omission of a supported later outcome as a grounding defect unless the candidate denies or contradicts that outcome; omission is a coverage issue, not an unsupported claim.",
      "Reject only an unmistakably absent or contradicted fact, a wrong agenda item, a wrong institutional actor or outcome, or an unsupported causal, financial, quantitative, timing, location, or relationship claim.",
      "Do not mark a candidate false for a minor wording preference, a defensible paraphrase, or a detail that is explicitly present even if it is qualified or one of several contributing factors.",
      "Do not mark a candidate false for a conservative omission alone. Omitting a descriptive modifier, one member of a list, or a secondary detail is acceptable unless the candidate names or implies a different entity, action, outcome, or relationship.",
      "Scan the complete bounded source before rejecting a claim: when the source explicitly says a speaker is giving remarks at a special event, saying goodbye, or saying farewell to named members, a concise summary may use farewell presentation as event framing and retain those source-listed names. Do not infer that every named person spoke, delivered a farewell speech, or received a presentation unless the source explicitly pairs that role or event with the person.",
      "Treat equivalent absence statements as grounded: for example, a source saying none were seen supports a concise report that no such item was presented when the bounded agenda context is the same.",
      "Before returning grounded=false, verify that every listed unsupported claim is actually absent or contradicted. If your notes acknowledge that a claim is supported, equivalent, or semantically grounded, return grounded=true and leave unsupported claims empty.",
      "If the audit evidence is internally contradictory—for example, one note says the exact motion subject is absent while another note cites a broader or later motion—do not reject on the contradiction alone. Recheck the exact supplied bounded source; accept only the directly paired current-window claim, otherwise treat the disputed procedural clause as omitted/unsupported and do not import the broader or later motion.",
      "Keep the agenda heading's category separate from the transcript's category: when the source says no motions were given notice and separately lists correspondence, do not merge the correspondence into motions.",
      "The authoritative agenda label establishes the identity of the agenda item and may supply the item-owning committee, board, document, category, item code, report code, project name, or named location when the candidate uses those terms. That identity does not by itself prove that the body received, acknowledged, approved, or acted on the item.",
      "The candidate may repeat exact details from the authoritative label as document identity or title framing, including a report code, named coordinator role, report subject, or title wording such as budget amendment; do not treat that framing as evidence that the described action or outcome occurred.",
      "The agenda label's named presenter or organization identifies the agenda item, not necessarily the transcript speaker. Do not attribute speaking or presenting to that person or role unless the bounded source explicitly pairs the identity with the speech; use a generic presentation or remarks when attribution is not explicit.",
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      "People named in an agenda label are identity metadata only. Do not turn those names into speakers, participants, recipients, attendees, or acting persons unless the bounded source explicitly supports that role or event.",
      "Never copy a parent agenda title's parenthetical list of people into generated prose when those people are absent from this bounded source excerpt; omit the list and use a generic event or participant description instead.",
      "Preserve temporal direction exactly: past-tense history or completed achievements are retrospective, while goals, plans, forecasts, and intended actions require explicit future-oriented source language. Do not turn a retrospective period into future goals or plans.",
      "Preserve occupation and status exactly: a past-tense statement that someone played, worked, served, or participated in a role establishes history but does not by itself support 'former', 'retired', 'ex-', or an ended status. Add those status words only when the source explicitly says the role ended.",
      "When an event host explicitly says 'I'd like to invite', 'I'll invite', or 'I'll start with inviting' a named person and the same bounded source then records that person participating, speaking, or receiving the described presentation, accept concise event framing that the host invited that person; do not call an invitation completed when the source never records the person's participation.",
      "When several speakers or named people appear, keep every number, tenure, quote, role, and achievement attached to the person or speaker explicitly named with it. Do not transfer a nearby person's detail to another person, and do not call one subtopic the event's overall purpose unless the source explicitly frames it that way.",
      GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
      "Preserve the source speech act and status: a question and answer is not necessarily a discussion or decision, an ongoing discussion is not completed, and a recommendation, possibility, or future timeline is not an action or outcome unless the source records that change.",
      DOCUMENT_SOURCE_SPEECH_ACT_RULE,
      documentSourceOnly ? DOCUMENT_SOURCE_AUDIT_PRIORITY_RULE : "",
      PROCEDURAL_DECISION_SEQUENCE_RULE,
      REPORT_PROPOSAL_STATUS_RULE,
      REPORT_PROPOSAL_AUDIT_PRIORITY_RULE,
      PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
      REPORTED_PAST_ACTION_RULE,
      MOTION_AMENDMENT_DISPOSITION_RULE,
      AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      ORDINAL_MOTION_SEQUENCE_RULE,
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_VOTE_OMISSION_RULE,
      REPEATED_SUBJECT_MOTION_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      CURRENT_MEETING_BODY_ATTRIBUTION_RULE,
      CATEGORY_ACTION_BINDING_RULE,
      AGENDA_CATEGORY_FRAGMENT_RULE,
      "When the source explicitly records 'moved by myself' or a motion being moved and the bounded item is a council or committee action, accept a generic attribution such as 'a council member moved' without requiring an internal speaker ID or a named office; do not infer a specific person, title, or stronger actor.",
      "Treat ambiguous procedural remarks such as 'don't need to do that' as ambiguous. Do not infer that a motion was opposed, withdrawn, rejected, carried, or abandoned, and do not infer the speaker's reason; preserve only an explicit motion status or omit the ambiguity.",
      "When an ambiguous response is the only substantive evidence in a short procedural item and no explicit disposition is recorded, summarize the listed item neutrally and say that no explicit disposition is recorded; do not restate or paraphrase the ambiguous response as a reason or decision.",
      "When the source records an explicit procedural inquiry followed by a literal no-response observation, such as 'Anybody?' followed by 'Seeing none' or an inquiry about declarations followed by 'none', accept concise neutral wording that the listed item was addressed or recorded with none reported; do not demand a formal motion or stronger action unless the candidate claims one.",
      STRUCTURED_IDENTITY_BINDING_RULE,
      "The current agenda label is the binding scope. When trailing source lines announce or perform a different agenda item, keep that neighboring item out of the current summary even if the boundary context is inside the excerpt; never attach its motion, mover, seconder, question, answer, or outcome to the current label.",
      "The source excerpt may include trailing boundary context. Locate the first explicit sentence that announces a different report or agenda item and stop the current summary before that sentence; treat every later line as next-item boundary context, not evidence for this item.",
      COMPOSITE_MOTION_SCOPE_RULE,
      CONSENT_AGENDA_SCOPE_REPAIR_RULE,
      CONTAINER_HANDOFF_RULE,
      ORDINAL_MOTION_AUDIT_PRIORITY_RULE,
      "Exception for literal consent agendas: when one source-recorded consent-agenda motion explicitly lists multiple sibling agenda items and includes the current item, that range is one shared action. Preserve the exact listed range and explicit approval or carried outcome; do not call it neighboring contamination merely because the motion names sibling items.",
      PROCEDURAL_FRAGMENT_RULE,
      PROCEDURAL_SELF_REPORT_RULE,
      ADDITIONAL_BUSINESS_REMARKS_RULE,
      ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
      "For a short procedural span, use only literal headings, questions, answers, announcements, and explicit motion status. Do not turn a heading plus a brief response into stronger procedural action or attribution than the words support.",
      "Do not reject structural framing such as 'the item discussed', 'the committee minutes describe', or 'the report concerns' when the authoritative agenda label identifies that item; treat the framing as metadata, not as an additional action or outcome.",
      "For a public forum or other open testimony, call something a topic only when a speaker develops it as an issue, request, concern, question, or argument. Do not promote a passing mention of a place, object, personal background, or evidence collection into a forum-wide topic.",
      "When the source excerpt contains an explicit handoff to another agenda item, treat that handoff as the end of the current item. Do not attribute the following item's report, facts, or outcome to the current agenda label unless the current label explicitly resumes later.",
      "The authoritative agenda label may support identity-only details such as the item-owning committee or board, document, item code, report code, project name, and named location; it may not support an action, outcome, receipt, cause, or speaker role absent from the source excerpt.",
      "Reject facts imported from a neighboring agenda item, a different report, a different meeting, or a different governing body.",
      "Do not excuse an unsupported claim because it sounds plausible or because it appears in the candidate's chapter text.",
      "Do not infer a speaker's title, office, chair role, or institutional authority from a name alone. Reject a named role unless the same bounded source excerpt explicitly supplies it.",
      "Transcript speaker identifiers are internal metadata, not people or facts. Reject labels such as SPEAKER_072 or Speaker 072 as names, actors, or attribution.",
      "Inspect CANDIDATE_SUMMARY and its chapter text separately from GROUNDED_SOURCE: do not claim that candidate prose uses an internal speaker label merely because the source excerpt displays one. Reject this defect only when the exact internal label appears in the candidate fields.",
      "Do not require an internal transcript speaker identifier in the summary. A generic speaker, council, committee, or meeting subject is acceptable when the literal action is supported; omission of the internal ID is conservative, not an unsupported claim.",
      "Before returning, scan summary and chapter text for SPEAKER_ or Speaker_ labels and remove them by using a generic subject. Preserve qualified absences exactly: no notice or no notice given does not mean no motion or no item exists.",
      "If a personal name appears in the candidate, it is grounded only when this same source excerpt explicitly pairs that name with the claimed role or an essential event; otherwise reject the name and role together.",
      governingBody ? `The authoritative meeting body is ${governingBody}; reject a different acting-body label for an action, but do not reject the item-owning committee or board identity supplied by the authoritative agenda label.` : "",
      "If the candidate is conservative and omits detail, it may still be grounded=true.",
      "List each unsupported or contradicted claim briefly in unsupported claims. Do not rewrite the candidate.",
      `AGENDA LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `GROUNDED_SOURCE: ${auditSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

export async function adjudicateGroundedSummaryLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  priorAudit = {},
  llmModel,
  ollamaUrl,
  governingBody = "",
  amendmentEvidence = null,
  speakerHandoffEvidence = null,
  documentSourceOnly = false,
  numericConflictRepairActive = false,
  deferralObjectRepairActive = false,
} = {}) {
  const auditSourceExcerpt = stripTranscriptSpeakerIdentifiers(sourceExcerpt);
  const parentAuditedChildEvidence = /\b(?:PARENT\s+SOURCE\s+EVIDENCE|AUDITED\s+CHILD\s+SUMMARY|CHILD\s+SUMMARY\s+COVERAGE)\b/iu.test(auditSourceExcerpt);
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 420,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Adjudicate a disputed civic-summary grounding audit against literal source evidence. Return strict JSON only.",
    prompt: [
      "The prior audit is only an allegation and may be wrong. Recheck every alleged defect against the literal GROUNDED_SOURCE before discarding the candidate.",
      "Return grounded=true when the candidate is fully supported by the source, including faithful paraphrase, ordinary compression, or an authoritative agenda identity/category term that is also present in the label or source.",
      LITERAL_SOURCE_CLAIM_CHECK_RULE,
      REFERRED_AGENDA_SCOPE_AUDIT_RULE,
      parentAuditedChildEvidence ? PARENT_AUDITED_CHILD_EVIDENCE_RULE : "",
      GENERIC_SPEAKER_QUESTION_RULE,
      EXPLICIT_PROPOSAL_PARAPHRASE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      LITERAL_SOURCE_PHASE_PRIORITY_RULE,
      SOURCE_TOPIC_RELATIONSHIP_RULE,
      SEPARATE_REMARKS_SCOPE_RULE,
      CAUSAL_RELATIONSHIP_AUDIT_RULE,
      INFORMAL_DISCUSSION_STATUS_RULE,
      EXPLICIT_NAMED_MOTION_ATTRIBUTION_RULE,
      PARENT_SPEECH_ACT_AND_ACTOR_RULE,
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      MOTION_VOTE_OMISSION_RULE,
      "High-priority conservative motion audit rule: when the source explicitly records that a motion was moved and seconded, a candidate saying only 'a motion was moved and seconded' is grounded even when the source also names the mover and seconder. Do not reject omission of those names; names are optional detail, and conflicting or unnecessary identities should be omitted rather than demanded.",
      "High-priority floor-status audit rule: when the source records a chair or clerk announcing that a motion is on the floor for discussion, impersonal wording such as 'the motion was on the floor for discussion' is grounded. Do not require the mover's name or reject the candidate because it does not repeat the named movers.",
      "High-priority procedural-announcement rule: an explicit chair or clerk announcement that a motion 'has been moved by' one person and 'seconded by' another is direct evidence of those procedural acts. Do not downgrade it to a mere floor-status report because earlier speakers said they would put a motion on the floor, and do not reject the motion subject when the bounded source pairs that subject with the announcement.",
      "The authoritative agenda label may supply the identity of the agenda item and its item-owning committee, board, document, category, report code, project name, or named location. It may not prove an action, outcome, receipt, acknowledgement, cause, speaker role, or acting institutional actor that the source does not state.",
      "The candidate may repeat exact details from the authoritative label as document identity or title framing, including a report code, named coordinator role, report subject, or title wording such as budget amendment; do not treat that framing as evidence that the described action or outcome occurred.",
      "The agenda label's named presenter or organization identifies the agenda item, not necessarily the transcript speaker. Do not attribute speaking or presenting to that person or role unless the bounded source explicitly pairs the identity with the speech; use a generic presentation or remarks when attribution is not explicit.",
      "People named in an agenda label are identity metadata only. Do not turn those names into speakers, participants, recipients, attendees, or acting persons unless the bounded source explicitly supports that role or event.",
      "Never copy a parent agenda title's parenthetical list of people into generated prose when those people are absent from this bounded source excerpt; omit the list and use a generic event or participant description instead.",
      "Preserve temporal direction exactly: past-tense history or completed achievements are retrospective, while goals, plans, forecasts, and intended actions require explicit future-oriented source language. Do not turn a retrospective period into future goals or plans.",
      "Preserve occupation and status exactly: a past-tense statement that someone played, worked, served, or participated in a role establishes history but does not by itself support 'former', 'retired', 'ex-', or an ended status. Add those status words only when the source explicitly says the role ended.",
      "When an event host explicitly says 'I'd like to invite', 'I'll invite', or 'I'll start with inviting' a named person and the same bounded source then records that person participating, speaking, or receiving the described presentation, accept concise event framing that the host invited that person; do not call an invitation completed when the source never records the person's participation.",
      "When several speakers or named people appear, keep every number, tenure, quote, role, and achievement attached to the person or speaker explicitly named with it. Do not transfer a nearby person's detail to another person, and do not call one subtopic the event's overall purpose unless the source explicitly frames it that way.",
      GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
      "Preserve the source speech act and status: a question and answer is not necessarily a discussion or decision, an ongoing discussion is not completed, and a recommendation, possibility, or future timeline is not an action or outcome unless the source records that change.",
      DOCUMENT_SOURCE_SPEECH_ACT_RULE,
      documentSourceOnly ? DOCUMENT_SOURCE_AUDIT_PRIORITY_RULE : "",
      PROCEDURAL_DECISION_SEQUENCE_RULE,
      REPORT_PROPOSAL_STATUS_RULE,
      REPORT_PROPOSAL_AUDIT_PRIORITY_RULE,
      PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
      REPORTED_PAST_ACTION_RULE,
      MOTION_AMENDMENT_DISPOSITION_RULE,
      AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      CURRENT_MEETING_BODY_ATTRIBUTION_RULE,
      CATEGORY_ACTION_BINDING_RULE,
      AGENDA_CATEGORY_FRAGMENT_RULE,
      "When the source explicitly records 'moved by myself' or a motion being moved and the bounded item is a council or committee action, accept a generic attribution such as 'a council member moved' without requiring an internal speaker ID or a named office; do not infer a specific person, title, or stronger actor.",
      "Treat ambiguous procedural remarks such as 'don't need to do that' as ambiguous. Do not infer that a motion was opposed, withdrawn, rejected, carried, or abandoned, and do not infer the speaker's reason; preserve only an explicit motion status or omit the ambiguity.",
      "When an ambiguous response is the only substantive evidence in a short procedural item and no explicit disposition is recorded, summarize the listed item neutrally and say that no explicit disposition is recorded; do not restate or paraphrase the ambiguous response as a reason or decision.",
      "When the source records an explicit procedural inquiry followed by a literal no-response observation, such as 'Anybody?' followed by 'Seeing none' or an inquiry about declarations followed by 'none', accept concise neutral wording that the listed item was addressed or recorded with none reported; do not demand a formal motion or stronger action unless the candidate claims one.",
      STRUCTURED_IDENTITY_BINDING_RULE,
      "The current agenda label is the binding scope. When trailing source lines announce or perform a different agenda item, keep that neighboring item out of the current summary even if the boundary context is inside the excerpt; never attach its motion, mover, seconder, question, answer, or outcome to the current label.",
      "The source excerpt may include trailing boundary context. Locate the first explicit sentence that announces a different report or agenda item and stop the current summary before that sentence; treat every later line as next-item boundary context, not evidence for this item.",
      COMPOSITE_MOTION_SCOPE_RULE,
      CONSENT_AGENDA_SCOPE_REPAIR_RULE,
      CONTAINER_HANDOFF_RULE,
      ORDINAL_MOTION_AUDIT_PRIORITY_RULE,
      "Exception for literal consent agendas: when one source-recorded consent-agenda motion explicitly lists multiple sibling agenda items and includes the current item, that range is one shared action. Preserve the exact listed range and explicit approval or carried outcome; do not call it neighboring contamination merely because the motion names sibling items.",
      PROCEDURAL_FRAGMENT_RULE,
      PROCEDURAL_SELF_REPORT_RULE,
      ADDITIONAL_BUSINESS_REMARKS_RULE,
      ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
      "For a short procedural span, use only literal headings, questions, answers, announcements, and explicit motion status. Do not turn a heading plus a brief response into stronger procedural action or attribution than the words support.",
      "Transcript speaker identifiers are internal metadata, not people or facts. Reject labels such as SPEAKER_072 or Speaker 072 as names, actors, or attribution.",
      "Inspect CANDIDATE_SUMMARY and its chapter text separately from GROUNDED_SOURCE: do not claim that candidate prose uses an internal speaker label merely because the source excerpt displays one. Reject this defect only when the exact internal label appears in the candidate fields.",
      "Do not require an internal transcript speaker identifier in the summary. A generic speaker, council, committee, or meeting subject is acceptable when the literal action is supported; omission of the internal ID is conservative, not an unsupported claim.",
      "Before returning, scan summary and chapter text for SPEAKER_ or Speaker_ labels and remove them by using a generic subject. Preserve qualified absences exactly: no notice or no notice given does not mean no motion or no item exists.",
      "Do not reject structural framing such as 'the item discussed', 'the committee minutes describe', or 'the report concerns' when the authoritative agenda label identifies that item; treat the framing as metadata, not as an additional action or outcome.",
      "For a public forum or other open testimony, call something a topic only when a speaker develops it as an issue, request, concern, question, or argument. Do not promote a passing mention of a place, object, personal background, or evidence collection into a forum-wide topic.",
      "A phrase explicitly present in the source, including a spoken-number or punctuation variant, is not an unsupported claim merely because the prior audit missed it.",
      "Reject only a claim that is absent, contradicted, imported from a neighboring item, or changes the source's action, outcome, actor, timing, amount, location, or relationship.",
      "Do not treat omission of a supported later outcome as a grounding defect merely because the conservative summary omits a later motion outcome; reject only if it denies, contradicts, or misstates that outcome.",
      GENERAL_CONSERVATIVE_OMISSION_AUDIT_RULE,
      LITERAL_NUMERIC_AND_DATE_PRIORITY_RULE,
      numericConflictRepairActive ? NUMERIC_CONFLICT_OMISSION_AUDIT_RULE : "",
      deferralObjectRepairActive ? DEFERRAL_OBJECT_OMISSION_AUDIT_RULE : "",
      PROCEDURAL_FLOOR_STATUS_AUDIT_RULE,
      PROCEDURAL_ABSENCE_AUDIT_RULE,
      "A conservative omission is not a grounding defect. Omitting a descriptive modifier from an organization name, one member of a list, or a secondary detail is acceptable unless the candidate names or implies a different entity, action, outcome, or relationship. List only defects that remain after this literal evidence check.",
      "Scan the complete bounded source before rejecting a claim: when the source explicitly says a speaker is giving remarks at a special event, saying goodbye, or saying farewell to named members, a concise summary may use farewell presentation as event framing and retain those source-listed names. Do not infer that every named person spoke, delivered a farewell speech, or received a presentation unless the source explicitly pairs that role or event with the person.",
      governingBody ? `The authoritative meeting body is ${governingBody}; reject only a different acting-body label that the source does not support, not the item-owning committee or board identity supplied by the agenda label.` : "",
      "Return exactly one JSON object with grounded, unsupported claims, and notes.",
      `AGENDA_LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `PRIOR_AUDIT_UNSUPPORTED_CLAIMS: ${JSON.stringify(Array.isArray(priorAudit?.unsupportedClaims) ? priorAudit.unsupportedClaims : [])}`,
      `PRIOR_AUDIT_NOTES: ${String(priorAudit?.notes || "").trim() || "(none)"}`,
      `GROUNDED_SOURCE: ${auditSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

export async function confirmLiteralGroundingLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
  amendmentEvidence = null,
  speakerHandoffEvidence = null,
  documentSourceOnly = false,
  numericConflictRepairActive = false,
  deferralObjectRepairActive = false,
} = {}) {
  const parentAuditedChildEvidence = /\b(?:PARENT\s+SOURCE\s+EVIDENCE|AUDITED\s+CHILD\s+SUMMARY|CHILD\s+SUMMARY\s+COVERAGE)\b/iu.test(String(sourceExcerpt || ""));
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 260,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Perform one final literal-source claim check for a civic summary. Return strict JSON only.",
    prompt: [
      "Ignore all prior audit allegations and compare the complete CANDIDATE_SUMMARY directly with GROUNDED_SOURCE.",
      "Return grounded=true when every concrete claim in the candidate is explicitly stated or is an ordinary faithful paraphrase of the source. Exact names, list members, approvals, and source-stated alternatives are grounded when they appear in the source, even if they are near other actions.",
      "Return grounded=false only for a claim that is absent, contradicted, or changes the source's actor, action, outcome, timing, amount, location, or relationship. Do not reject a claim for style, generic framing, conservative omission, or because the source uses a different but equivalent grammatical subject.",
      LITERAL_SOURCE_PHASE_PRIORITY_RULE,
      REFERRED_AGENDA_SCOPE_AUDIT_RULE,
      parentAuditedChildEvidence ? PARENT_AUDITED_CHILD_EVIDENCE_RULE : "",
      SOURCE_TOPIC_RELATIONSHIP_RULE,
      SEPARATE_REMARKS_SCOPE_RULE,
      CAUSAL_RELATIONSHIP_AUDIT_RULE,
      GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      GENERAL_CONSERVATIVE_OMISSION_AUDIT_RULE,
      LITERAL_NUMERIC_AND_DATE_PRIORITY_RULE,
      numericConflictRepairActive ? NUMERIC_CONFLICT_OMISSION_AUDIT_RULE : "",
      deferralObjectRepairActive ? DEFERRAL_OBJECT_OMISSION_AUDIT_RULE : "",
      PROCEDURAL_FLOOR_STATUS_AUDIT_RULE,
      PROCEDURAL_ABSENCE_AUDIT_RULE,
      DOCUMENT_SOURCE_SPEECH_ACT_RULE,
      documentSourceOnly ? DOCUMENT_SOURCE_AUDIT_PRIORITY_RULE : "",
      ORDINAL_MOTION_SEQUENCE_RULE,
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      MOTION_VOTE_OMISSION_RULE,
      REPEATED_SUBJECT_MOTION_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      ORDINAL_MOTION_AUDIT_PRIORITY_RULE,
      REPORT_PROPOSAL_AUDIT_PRIORITY_RULE,
      PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
      MOTION_AMENDMENT_DISPOSITION_RULE,
      AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      AMENDMENT_EVIDENCE_PRIORITY_RULE,
      amendmentEvidence
        ? `STRUCTURED AMENDMENT EVIDENCE: ${JSON.stringify(amendmentEvidence)}`
        : "",
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      EXPLICIT_NAMED_MOTION_ATTRIBUTION_RULE,
      PARENT_SPEECH_ACT_AND_ACTOR_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      speakerHandoffEvidence
        ? `STRUCTURED SPEAKER-HANDOFF EVIDENCE: ${JSON.stringify(speakerHandoffEvidence)}`
        : "",
      ADDITIONAL_BUSINESS_REMARKS_RULE,
      ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
      "Check every sentence and list element before deciding. If the source contains the claim, do not report it as absent.",
      "Return exactly one JSON object with grounded, unsupported claims, and notes.",
      `AGENDA_LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

async function confirmOrdinalMotionSequenceLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
  governingBody = "",
  motionEvidence = null,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 360,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Perform a final literal check of a civic motion sequence. Return strict JSON only.",
    prompt: [
      "Check CANDIDATE_SUMMARY against the complete GROUNDED_SOURCE in chronological order. Use the literal source and the structured motion evidence only as a source-order checklist.",
      "An explicit source disposition such as 'that motion is defeated' or 'that motion is carried' controls the motion immediately under discussion. Never recalculate or override it from a spoken count, and never attach a later carried phrase to an earlier motion.",
      "A moved motion may be summarized by a direct consequence explicitly explained in the same source. Keep a later motion, a carried amendment, and the amended motion as separate steps. When an amendment removes a scope, the final amended scope excludes it.",
      REPEATED_SUBJECT_MOTION_RULE,
      "Omitting a vote count or a secondary motion detail is conservative and grounded; reject only a claim that reverses, merges, or misattributes an explicit motion subject, scope, or disposition. Do not reject the candidate merely because it does not repeat every source detail.",
      motionEvidence ? `STRUCTURED_MOTION_EVIDENCE: ${JSON.stringify(motionEvidence)}` : "",
      governingBody ? `The authoritative meeting body is ${governingBody}; reject only a different unsupported acting body.` : "",
      "Return grounded=true when the candidate preserves the source-supported procedural sequence. Return grounded=false only for an unmistakably wrong subject, scope, actor, or disposition.",
      `AGENDA_LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

async function extractOrdinalMotionEvidenceLlm({
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
  seed = 0,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 1400,
    temperature: 0,
    format: STAGE3_ORDINAL_MOTION_EVIDENCE_FORMAT,
    system: "Extract literal procedural motion facts from a transcript. Return strict JSON only.",
    prompt: [
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_VOTE_OMISSION_RULE,
      REPEATED_SUBJECT_MOTION_RULE,
      "Read the complete source in order and extract each distinct motion that is explicitly moved or explicitly described as the next motion.",
      "A listed or on-screen first option is not a moved first motion. Record it only if this bounded source explicitly says the first motion was moved or otherwise acted on. If an unnumbered motion is explicitly moved but has no ordinal, record it as unnumbered rather than promoting it to first; if it is then described as on the table, preserve that as its own status. An unnumbered phrase such as 'it is on the table' is ambiguous and must not create a numbered first-motion record or receive a disposition for a different motion. If the source begins after an earlier motion, leave that earlier ordinal absent rather than reconstructing it.",
      "Use empty strings for fields not explicitly recorded. Match each subject, scope, disposition, and vote only to its own motion. The vote field must contain only an explicit in-favour/opposed count; a generic phrase such as 'all in favour' without a count belongs in evidence but leaves vote empty. Do not merge motions or infer a pending status.",
      "Preserve exact source distinctions between carried and defeated. An explicit phrase such as 'that motion is defeated' controls the motion immediately under discussion; a preceding carried result for another motion does not transfer. When a later speaker explicitly clarifies that the motion on the floor is not about a previously discussed scope, remove that excluded scope from the later motion's subject. When the source returns to an amended motion and then says that motion is carried, record the carried disposition for the amended motion, separately from the amendment; do not require a second disposition for the unamended wording. Preserve the order of spoken in-favour and opposed counts. Quote short literal evidence phrases in evidence.",
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return exactly one JSON object with motions.",
    ].join("\n\n"),
  });
  const motions = Array.isArray(parsed?.motions)
    ? parsed.motions.map((motion) => ({
      ordinal: normalizeText(motion?.ordinal || ""),
      subject: normalizeText(motion?.subject || ""),
      scope: normalizeText(motion?.scope || ""),
      disposition: normalizeText(motion?.disposition || ""),
      vote: normalizeText(motion?.vote || ""),
      evidence: normalizeText(motion?.evidence || ""),
    })).slice(0, 12)
    : [];
  if (!motions.length) return motions;
  const verified = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 1400,
    temperature: 0,
    seed: seed + 9911,
    format: STAGE3_ORDINAL_MOTION_EVIDENCE_FORMAT,
    system: "Verify and correct structured procedural motion evidence against a transcript. Return strict JSON only.",
    prompt: [
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_VOTE_OMISSION_RULE,
      REPEATED_SUBJECT_MOTION_RULE,
      "Read the complete source in chronological order and correct only motion-ownership errors in CANDIDATE_MOTION_EVIDENCE.",
      "A later direct clarification about the motion on the floor controls an earlier paraphrase of that motion. If the source says the motion on the floor is not about a previously discussed scope, remove that excluded scope from the motion subject and scope.",
      "An explicitly moved motion without a spoken ordinal remains unnumbered; never promote it to first merely because later motions are called second and third. If it is followed by an on-the-table statement, preserve that status only for the unnumbered motion. Do not infer a missing first motion.",
      "Keep an explicitly carried second motion separate from a later third motion. Keep an amendment carried separate from the amended motion carried after the source returns to it. Preserve carried, defeated, amended, and on-the-table status exactly; do not infer pending or carried status.",
      "Return the corrected evidence structure only. Every evidence phrase must be directly supported by GROUNDED_SOURCE.",
      `CANDIDATE_MOTION_EVIDENCE: ${JSON.stringify({ motions })}`,
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
  });
  return Array.isArray(verified?.motions)
    ? verified.motions.map((motion) => ({
      ordinal: normalizeText(motion?.ordinal || ""),
      subject: normalizeText(motion?.subject || ""),
      scope: normalizeText(motion?.scope || ""),
      disposition: normalizeText(motion?.disposition || ""),
      vote: normalizeText(motion?.vote || ""),
      evidence: normalizeText(motion?.evidence || ""),
    })).slice(0, 12)
    : motions;
}

async function extractAmendmentEvidenceLlm({
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 720,
    temperature: 0,
    format: STAGE3_AMENDMENT_EVIDENCE_FORMAT,
    system: "Extract literal amendment layers from a civic transcript. Return strict JSON only.",
    prompt: [
      "Read the complete source in chronological order and distinguish amendments to a named document from amendments to the motion wording.",
      AMENDMENT_EVIDENCE_PRIORITY_RULE,
      "If the source explicitly says an original motion approves an amendment to a bylaw, policy, agreement, or other named document, record that exact document action. If a later speaker proposes adding or changing wording in the motion and the source says that motion amendment was not accepted or was not made, record that separately. If the source then says the motion on the screen was carried, record the original motion as carried.",
      "Use empty strings when a layer or later action is not explicit. Quote short literal evidence phrases. Do not infer a person, mover, office, vote count, or outcome that the source does not state.",
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return exactly one JSON object with document amendment, motion amendment, original motion disposition, later action, and evidence.",
    ].join("\n\n"),
  });
  const evidence = {
    "document amendment": normalizeText(parsed?.["document amendment"] || ""),
    "motion amendment": normalizeText(parsed?.["motion amendment"] || ""),
    "original motion disposition": normalizeText(parsed?.["original motion disposition"] || ""),
    "later action": normalizeText(parsed?.["later action"] || ""),
    evidence: Array.isArray(parsed?.evidence)
      ? parsed.evidence.map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
  };
  return Object.values(evidence).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    ? evidence
    : null;
}

async function extractSpeakerHandoffEvidenceLlm({
  sourceExcerpt = "",
  llmModel,
  ollamaUrl,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 520,
    temperature: 0,
    format: STAGE3_SPEAKER_HANDOFF_EVIDENCE_FORMAT,
    system: "Extract literal speaker-block handoffs from a civic transcript. Return strict JSON only.",
    prompt: [
      "Read the complete source in chronological order. Detect a standalone name or title callout at the end of one speaker's block immediately before a new speaker block.",
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      "Set handoff=true only when the source order supports that interpretation. Record the preceding speaker block, the exact standalone callout, and the following speaker block. Use empty strings and an empty evidence list when no handoff is explicit. This is structured evidence, not generated prose; do not infer a person's role or attach a preceding claim to the callout person.",
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return exactly one JSON object with handoff, preceding speaker, standalone callout, following speaker, and evidence.",
    ].join("\n\n"),
  });
  const evidence = {
    handoff: parsed?.handoff === true,
    "preceding speaker": normalizeText(parsed?.["preceding speaker"] || ""),
    "standalone callout": normalizeText(parsed?.["standalone callout"] || ""),
    "following speaker": normalizeText(parsed?.["following speaker"] || ""),
    evidence: Array.isArray(parsed?.evidence)
      ? parsed.evidence.map((value) => normalizeText(value)).filter(Boolean).slice(0, 6)
      : [],
  };
  return evidence.handoff && (evidence["standalone callout"] || evidence.evidence.length)
    ? evidence
    : null;
}

async function auditOrdinalMotionSequenceLlm({
  label = "",
  summary = "",
  sourceExcerpt = "",
  priorAudit = null,
  llmModel,
  ollamaUrl,
  governingBody = "",
  motionEvidence = null,
} = {}) {
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    maxOutputTokens: 420,
    temperature: 0,
    format: STAGE3_GROUNDING_AUDIT_RESPONSE_FORMAT,
    system: "Audit one civic summary against a bounded ordinal-motion transcript. Return strict JSON only.",
    prompt: [
      "Read GROUNDED_SOURCE in chronological order and check each CANDIDATE_SUMMARY sentence against the exact motion it describes.",
      motionEvidence
        ? `MOTION-EVIDENCE PRIORITY: The separate extraction records these source-linked motions: ${JSON.stringify(motionEvidence)}. If it records an explicitly numbered motion with disposition carried and the candidate uses that same ordinal and carried disposition, do not claim that the source has no disposition; verify and accept the carried result unless the candidate adds a different subject or outcome.`
        : "",
      "This is a minutes or motion sequence. Do not collapse separate motions or let a narrative statement about an earlier committee item replace a later current-meeting motion disposition.",
      ORDINAL_MOTION_SEQUENCE_RULE,
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      MOTION_VOTE_OMISSION_RULE,
      ORDINAL_MOTION_AUDIT_PRIORITY_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      "A source phrase that moves receipt of the current minutes and approval of their recommendations, followed by a carried vote, supports that carried receipt-and-approval action. A later source phrase that explicitly says the motion immediately under discussion is defeated supports that defeat. A spoken in-favour/opposed count immediately before that phrase is valid vote evidence when its counts are clear.",
      "If a later speaker explicitly clarifies that the motion on the floor is not about a previously discussed scope, do not require that excluded scope in the candidate. If the source returns to an amended motion and then says that motion is carried, accept the amended motion as carried after the amendment; do not require a separate disposition for the unamended wording.",
      "If the source explicitly says the changes relate only to the remaining scope or that the amendment leaves only that scope, accept that narrowed scope as literal source evidence even when the final carried sentence uses a shorter reference to the amended motion.",
      "Do not reject a candidate for calling an explicitly moved, unnumbered motion an unnumbered motion when the source places that motion on the table. That is faithful wording. Do not infer or demand the label first merely because later source lines say second and third.",
      "A question call followed by an all-in-favour response and the literal phrase 'that is carried' or 'that is carried' is an explicit carried disposition even without a numeric vote count. When it follows the return to the amended motion, attach it to the amended motion.",
      "When a motion is explicitly moved, the source then says to call the question, gives an all-in-favour response, and says that the motion is carried, treat that as an explicit disposition for that motion. Do not require the full motion wording or a numeric roll call to appear again at the disposition line.",
      "The carried line may follow intervening discussion. Scan forward from an explicitly moved motion until the next explicitly moved ordinal; if the question is called and the motion is carried before that next ordinal, attach the outcome to the current motion.",
      LITERAL_SOURCE_CLAIM_CHECK_RULE,
      GENERIC_SPEAKER_QUESTION_RULE,
      EXPLICIT_PROPOSAL_PARAPHRASE_RULE,
      INFORMAL_DISCUSSION_STATUS_RULE,
      "If the excerpt ends while later motions are only described as next steps or while participants ask whether another motion is needed, a candidate may say those later motions had no recorded disposition in this excerpt; do not demand a vote that the excerpt does not contain.",
      "Reject only an absent or contradicted claim. Do not reject a conservative summary, a generic current-minutes reference, a faithful compression of receipt plus approval, or a clear spoken vote count.",
      motionEvidence ? `A separate literal motion-sequence extraction is provided as evidence. Use it only to keep source order and subject/disposition ownership straight; the verbatim source remains authoritative: ${JSON.stringify(motionEvidence)}` : "",
      motionEvidence
        ? "Compare any vote wording in CANDIDATE_SUMMARY with the extracted vote fields. If an extracted motion has no vote count, reject candidate wording such as unanimously, all members in favour, or a numeric count for that motion. If a count is present, reject a different count or reversed in-favour/opposed labels. In a multi-motion chunk, omission of counts is acceptable."
        : "",
      priorAudit
        ? `A previous audit alleged these defects; recheck them literally and disregard any allegation contradicted by the source: ${JSON.stringify(priorAudit)}`
        : "No prior audit is authoritative; perform the literal check yourself.",
      governingBody ? `The authoritative meeting body is ${governingBody}; reject only a different acting body.` : "",
      "Return exactly one JSON object with grounded, unsupported claims, and notes.",
      `AGENDA LABEL: ${String(label || "").trim() || "(none)"}`,
      `CANDIDATE_SUMMARY: ${String(summary || "").trim()}`,
      `GROUNDED_SOURCE: ${stripTranscriptSpeakerIdentifiers(sourceExcerpt).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
  });
  return {
    grounded: parsed?.grounded === true,
    unsupportedClaims: Array.isArray(parsed?.["unsupported claims"])
      ? parsed["unsupported claims"].map((value) => normalizeText(value)).filter(Boolean).slice(0, 8)
      : [],
    notes: normalizeText(parsed?.notes || ""),
  };
}

async function auditAndAdjudicateGroundedSummary({
  label,
  summary,
  sourceExcerpt,
  llmModel,
  ollamaUrl,
  governingBody,
  motionEvidence = null,
  amendmentEvidence = null,
  speakerHandoffEvidence = null,
  documentSourceOnly = false,
  numericConflictRepairActive = false,
  deferralObjectRepairActive = false,
}) {
  const ordinalMotionSequence = /\b(?:first|second|third|fourth|fifth|next)\s+motion\b/iu.test(String(sourceExcerpt || ""))
    && /\b(?:defeat(?:ed)?|carried|approv(?:e|ed)|move(?:d)?|amend(?:ed|ment)?)\b/iu.test(String(sourceExcerpt || ""));
  const audit = ordinalMotionSequence
    ? await auditOrdinalMotionSequenceLlm({
      label,
      summary,
      sourceExcerpt,
      llmModel,
      ollamaUrl,
      governingBody,
      motionEvidence,
    })
    : await auditGroundedSummaryLlm({
    label,
    summary,
    sourceExcerpt,
    llmModel,
      ollamaUrl,
      governingBody,
      amendmentEvidence,
      speakerHandoffEvidence,
      documentSourceOnly,
      numericConflictRepairActive,
      deferralObjectRepairActive,
    });
  const normalizedAudit = removeAllowedStructuredDateAuditClaims(audit, { label, summary });
  if (normalizedAudit.grounded) return normalizedAudit;
  const adjudication = ordinalMotionSequence
    ? await auditOrdinalMotionSequenceLlm({
      label,
      summary,
      sourceExcerpt,
      priorAudit: normalizedAudit,
      llmModel,
      ollamaUrl,
      governingBody,
      motionEvidence,
    })
    : await adjudicateGroundedSummaryLlm({
    label,
    summary,
    sourceExcerpt,
    priorAudit: normalizedAudit,
    llmModel,
      ollamaUrl,
      governingBody,
      amendmentEvidence,
      speakerHandoffEvidence,
      documentSourceOnly,
      numericConflictRepairActive,
      deferralObjectRepairActive,
    });
  const normalizedAdjudication = removeAllowedStructuredDateAuditClaims(adjudication, { label, summary });
  if (normalizedAdjudication.grounded) {
    return {
      grounded: true,
      unsupportedClaims: [],
      notes: `literal-source adjudication accepted the prior allegation${normalizedAdjudication.notes ? `: ${normalizedAdjudication.notes}` : ""}`,
    };
  }
  const finalLiteralCheck = await confirmLiteralGroundingLlm({
    label,
    summary,
    sourceExcerpt,
    llmModel,
    ollamaUrl,
    amendmentEvidence,
    speakerHandoffEvidence,
    documentSourceOnly,
    numericConflictRepairActive,
    deferralObjectRepairActive,
  });
  if (finalLiteralCheck.grounded) {
    return {
      grounded: true,
      unsupportedClaims: [],
      notes: `minimal literal-source tie-breaker accepted the candidate${finalLiteralCheck.notes ? `: ${finalLiteralCheck.notes}` : ""}`,
    };
  }
  if (ordinalMotionSequence) {
    const ordinalTieBreaker = await confirmOrdinalMotionSequenceLlm({
      label,
      summary,
      sourceExcerpt,
      llmModel,
      ollamaUrl,
      governingBody,
      motionEvidence,
    });
    if (ordinalTieBreaker.grounded) {
      return {
        grounded: true,
        unsupportedClaims: [],
        notes: `motion-sequence literal tie-breaker accepted the candidate${ordinalTieBreaker.notes ? `: ${ordinalTieBreaker.notes}` : ""}`,
      };
    }
  }
  return {
    grounded: false,
    unsupportedClaims: [...new Set([
      ...normalizedAudit.unsupportedClaims,
      ...normalizedAdjudication.unsupportedClaims,
    ])].slice(0, 8),
    notes: [normalizedAudit.notes, normalizedAdjudication.notes].filter(Boolean).join("; "),
  };
}

export async function repairChapterTitleLlm({
  heading,
  summary,
  sourceExcerpt,
  auditNote,
  llmModel,
  ollamaUrl,
  seed = 0,
}) {
  let rejected = "";
  let rejection = normalizeText(auditNote);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 96,
      temperature: attempt === 1 ? 0.2 : 0.35,
      seed: seed > 0 ? seed + attempt - 1 : 0,
      system: "Return one strict JSON object containing a grounded civic chapter headline.",
      prompt: [
        `Headline repair attempt ${attempt} of 6.`,
        "Create exactly one complete headline of 6 to 12 words for this bounded transcript source chunk. Count the words before returning it; prefer 8 to 10 words when the evidence allows.",
        "Use only a distinct fact, action, finding, request, or outcome stated in the source excerpt.",
        "Every substantive claim in the headline must also be stated or clearly supported by CURRENT SUMMARY; never add a named agency, warning, location, number, or outcome that the summary does not contain.",
        "Headline the central subject of CURRENT SUMMARY, not a minor detail from the source excerpt; if the summary covers consultation broadly, use that broad subject rather than one isolated comment.",
        "Do not copy the parent agenda heading or another chapter's framing.",
        "Do not end with a comma, conjunction, preposition, or an unfinished -ing participle such as arguing, proposing, discussing, or considering.",
        "If the rejected headline was too long, rewrite it; never truncate it mid-phrase.",
        attempt >= 2 ? "Start a fresh headline from the source evidence and avoid the rejected shape." : "",
        attempt >= 4 ? "Use a short, direct subject-action-outcome headline: CURRENT SUMMARY is the primary evidence, and the title must contain exactly 7 to 9 plain words. Do not explain the repair, repeat the parent heading, or follow a minor source detail." : "",
        "Return exactly {\"title\":\"...\"} and no other keys.",
        `PARENT HEADING: ${normalizeText(heading)}`,
        `AUDIT FEEDBACK: ${rejection}`,
        rejected ? `REJECTED HEADLINE (do not repeat): ${rejected}` : "",
        `CURRENT SUMMARY: ${normalizeText(summary)}`,
        `SOURCE EXCERPT: ${normalizeText(sourceExcerpt).slice(0, attempt >= 4 ? 4500 : 9000)}`,
      ].filter(Boolean).join("\n\n"),
      format: STAGE3_TITLE_RESPONSE_FORMAT,
    });
    const raw = normalizeText(parsed?.title || parsed?.["chapter text"] || "");
    const title = normalizeSplitChapterCandidate(raw, heading);
    const wordCount = title.split(/\s+/u).filter(Boolean).length;
    if (title && wordCount >= 6 && wordCount <= 12) return title;
    rejected = raw || title;
    rejection = `Rejected headline was not a complete 6-12 word civic headline (received ${wordCount} words). Rewrite it from the source.`;
  }
  throw new Error("stage3 retryable: configured text model returned an invalid repaired child title after bounded varied retries");
}

export async function summarizeGroundedUnit({
  unit,
  focus,
  llmModel,
  ollamaUrl,
  isChild = false,
  siblingSummaries = [],
  temperature = 0,
  seed = 0,
  semanticGroundingAudit = false,
  governingBody = "",
}) {
  const budget = buildSummaryBudget(unit);
  const semanticGroundingSourceExcerpt = String(
    unit?.["semantic grounding source excerpt"] || unit?.["source excerpt"] || "",
  );
  const promptLabel = isChild
    ? String(unit?.["agenda item"] || "").trim() || "(current agenda item)"
    : String(unit?.label || unit?.["agenda item"] || "").trim() || "(none)";
  const sourceNamedSpeakerLabels = [...String(unit?.["source excerpt"] || "").matchAll(/^\s*(?!SPEAKER_[0-9A-Z]+:)([A-Z][^:\n]{1,80}):/gmu)]
    .map((match) => normalizeText(match[1] || ""))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 6);
  const parentOverviewGenerationContract = unit?.["parent overview"] === true
    ? PARENT_OVERVIEW_GROUNDING_RULE
    : "";
  const parentLiteralSourceExcerpt = String(
    unit?.["parent literal source excerpt"] || semanticGroundingSourceExcerpt,
  );
  const parentRepairSourceExcerpt = String(
    unit?.["parent repair source excerpt"] || parentLiteralSourceExcerpt,
  );
  const numericGroundingSource = [
    promptLabel,
    String(unit?.["agenda item"] || ""),
    String(unit?.["source excerpt"] || ""),
  ].join("\n");
  const hasChildChapters = Array.isArray(unit?.["child chapters"]) && unit["child chapters"].length > 0;
  const requiresExpandedOverview = !isChild
    && !hasChildChapters
    && (budget.tier === "long" || budget.tier === "very_long");
  const largeBoundedChild = isChild && String(unit?.["source excerpt"] || "").length >= 4000;
  const longOrderLine =
    requiresExpandedOverview
      ? "For long sections, prefer this order when applicable: item under discussion; main substance; decision/direction/outcome."
      : "";
  const longCoverageLine =
    requiresExpandedOverview
      ? "Long-tier requirement: produce at least 3 complete sentences covering item, substance, and outcome (if outcome exists in source)."
      : "";
  const sourceExcerptText = String(unit?.["source excerpt"] || "");
  const genericCategoryFollowup = /\b(?:all\s+in\s+favou?r|that['’]?s?\s+carried|carried)\b/iu.test(sourceExcerptText);
  const parallelCategoryList = (sourceExcerptText.match(/,/gu) || []).length >= 2
    && /\b(?:and|or)\b/iu.test(sourceExcerptText);
  const explicitMotionAction = /\b(?:moved\s+by|seconded\s+by|motion\s+to|the\s+motion\b|approv(?:e|ed|es)\s+(?:the|this)|adopt(?:ed|s)?\s+(?:the|this)|receiv(?:e|ed|es)\s+(?:the|this)|recommend(?:ed|s|ation)\b)\b/iu.test(sourceExcerptText);
  const shortCategoryFragment = sourceExcerptText.length <= 1000
    && !hasChildChapters
    && (
      unit?.substantive === false
      || (
        genericCategoryFollowup
        && parallelCategoryList
        && !explicitMotionAction
      )
    );
  const minutesHandoffOnly = budget.procedural
    && /\bminutes\b/iu.test(promptLabel)
    && /\b(?:pass|hand)\w*\s+(?:it\s+|them\s+)?back\s+to\b|\bback\s+to\s+you\b/iu.test(String(unit?.["source excerpt"] || ""))
    && !/\b(?:motion|moved|move|vote|carried|approved|adopt(?:ed)?|receiv(?:e|ed)|recommend(?:ed|s)?)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const minutesMotionScopeOnly = /\bminutes\b/iu.test(promptLabel)
    && /\b(?:back|pass|hand)\w*\s+(?:it\s+|them\s+)?(?:back\s+)?to\b[^.\n]{0,160}\bminutes\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:I['’]ll|I\s+will)\s+move\s+the\s+minutes\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:all\s+in\s+favour|that['’]?s\s+carried|carried)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const consentAgendaScopeOnly = /\bconsent\s+agenda\b/iu.test(`${promptLabel}\n${String(unit?.["source excerpt"] || "")}`)
    && /\b(?:receives?|approves?)\s+items?\s+[0-9]+[A-Z]?\s+to\s+[0-9]+[A-Z]?\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\bsave\s+and\s+(?:accept|except)\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:all\s+in\s+favour|that['’]?s\s+carried|carried)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const proceduralFragmentOnly = budget.procedural
    && String(unit?.["source excerpt"] || "").length <= 1000
    && !hasChildChapters
    && !/\b(?:motion|moved|move|vote|carried|approved|adopt(?:ed)?|receiv(?:e|ed)|recommend(?:ed|s)?)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const amendmentSequenceOnly = /\b(?:no\s+amendment|not\s+accepted|wasn['’]t\s+accepted)\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:carried|nominate\w*|acclamation)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const amendmentEvidence = amendmentSequenceOnly
    ? await extractAmendmentEvidenceLlm({
      sourceExcerpt: unit?.["source excerpt"] || "",
      llmModel,
      ollamaUrl,
    })
    : null;
  const speakerHandoffCandidate = /(?:^|\n)\s*SPEAKER_[0-9A-Z]+\s*:\s*(?:Mayor|Deputy\s+Mayor|Councillor|Councilor|Chair|Clerk|Director|Commissioner|Warden|Mr\.?|Ms\.?|Dr\.?)\s+[A-Z][^.?!\n]{1,80}\.\s*\n\s*SPEAKER_[0-9A-Z]+\s*:/imu.test(String(unit?.["source excerpt"] || ""));
  const speakerHandoffEvidence = speakerHandoffCandidate
    ? await extractSpeakerHandoffEvidenceLlm({
      sourceExcerpt: unit?.["source excerpt"] || "",
      llmModel,
      ollamaUrl,
    })
    : null;
  const reportIntroductionSource = [
    String(unit?.["source excerpt"] || ""),
    semanticGroundingSourceExcerpt,
  ].filter(Boolean).join("\n");
  const reportIntroductionAttributionCandidate = /\b(?:this\s+is|here\s+is|we\s+(?:received|heard|have)|let['’]s\s+(?:go|move)|the\s+report)\b[^.\n]{0,260}\b(?:report|presentation|delegation)\b[^.\n]{0,180}\b(?:from|by|being)\b/iu.test(reportIntroductionSource)
    && /\b(?:report|presentation|delegation)\b[^.\n]{0,180}\b(?:from|by|being)\b/iu.test(reportIntroductionSource);
  const additionalBusinessRemarksOnly = /\badditional\s+business\b/iu.test(`${promptLabel}\n${String(unit?.["source excerpt"] || "")}`)
    && /\bI\s+(?:just\s+)?have\s+(?:two|three|four|five|several|\d+)\s+matters\b/iu.test(String(unit?.["source excerpt"] || ""))
    && !/\b(?:I\s+(?:will|would|want\s+to)\s+move|I\s+propose|motion\s+to|moved\s+by)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const proceduralSelfReportOnly = /\b(?:I['’]ll|I\s+will|we['’]ll|we\s+will|we['’]re|we\s+are)\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:pass|return|hand|gavel|will\s+be|going\s+to|back\s+to)\b/iu.test(String(unit?.["source excerpt"] || ""))
    && !/\b(?:motion|moved|vote|carried|approved|adopted|defer|defeated)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const ordinalMotionSequenceOnly = /\b(?:first|second|third|fourth|next)\s+motion\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:amend\w*|carried|defeated|move\w*)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const ordinalMotionEvidence = ordinalMotionSequenceOnly
    ? await extractOrdinalMotionEvidenceLlm({
      sourceExcerpt: unit?.["source excerpt"] || "",
      llmModel,
      ollamaUrl,
      seed,
    })
    : null;
  const absenceListingSource = String(unit?.["source excerpt"] || "");
  const absenceListingOnly = /^(?:[A-Z0-9_ ]+:\s*)?(?:at\s+)?(?:number|item)\s+\d+(?:\.\w+)?\b[^.\n]{0,120}\bno\s+(?:correspondence|public\s+meetings?|declarations?|notices?)\b[^.\n]*\./iu.test(absenceListingSource)
    || (absenceListingSource.length <= 900
      && /\bno\s+(?:correspondence|public\s+meetings?|declarations?|notices?)\b/iu.test(absenceListingSource)
      && !/\b(?:motion|moved|vote|carried|approved|adopt(?:ed)?|receiv(?:e|ed))\b/iu.test(absenceListingSource));
  const decisionSequenceOnly = /\bmotion\s+to\s+reconsider\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\brecommendation\b/iu.test(String(unit?.["source excerpt"] || ""))
    && /\b(?:carried|approved|adopted)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const reportedActionSource = String(unit?.["source excerpt"] || "");
  const reportedActionSeparationOnly = /\bverbal\s+report\b/iu.test(`${promptLabel}\n${reportedActionSource}`)
    && /\breceiv\w*\b/iu.test(reportedActionSource)
    && /\b(?:approved|adopted|carried)\b[^.\n]{0,260}\b(?:agreement|funding|program|project)\b/iu.test(reportedActionSource);
  const reportProposalSource = `${promptLabel}\n${String(unit?.["source excerpt"] || "")}`;
  const proposalOptionScopeOnly = /\b(?:option|options|alternative|alternatives|proposed\s+changes?|looking\s+for\s+(?:further\s+)?direction|under\s+consideration)\b/iu.test(reportProposalSource)
    && /\b(?:motion|carried|passed|defeated|approved|recommend(?:ation|ed)?)\b/iu.test(reportProposalSource);
  const publicCommentPlanAmendmentOnly = /public\s+comments?/iu.test(reportProposalSource)
    && /official\s+plan\s+amendment/iu.test(reportProposalSource)
    && !/defeat(?:ed|s|ing)?/iu.test(reportProposalSource)
    && !/\bmotion\b/iu.test(reportProposalSource);
  const reportProposalScopeOnly = !/\bminutes\b/iu.test(reportProposalSource)
    && /\b(?:report|process|strategy)\b/iu.test(reportProposalSource)
    && /\b(?:propos(?:e|ed|al)|expressions?\s+of\s+interest|RFP)\b/iu.test(reportProposalSource)
    && /\b(?:defeat(?:ed)?|amend(?:ed|ment)?|motion)\b/iu.test(reportProposalSource);
  const multiBoundaryRelationshipOnly = /\b(?:north|south|east|west)\b[^.\n]{0,120}\b(?:or|and)\b[^.\n]{0,120}\b(?:north|south|east|west|street|avenue|highway|road|trail)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const sourceForSpeechActChecks = String(unit?.["source excerpt"] || "");
  const routineQuestionTransitionOnly = /\b(?:any|other|further)\s+questions?\b/iu.test(sourceForSpeechActChecks)
    && /\b(?:not\s+seeing\s+any|no\s+(?:further\s+)?questions?|none\s+(?:reported|raised)?|we['’]?re\s+good\s+to\s+proceed)\b/iu.test(sourceForSpeechActChecks);
  const questionAnswerOnly = routineQuestionTransitionOnly
    || (/\?/u.test(sourceForSpeechActChecks)
      && /\b(?:is\s+this|did|does|would|could|why|how|what|where|when)\b/iu.test(sourceForSpeechActChecks));
  const shortAgendaTransitionOnly = !proceduralSelfReportOnly
    && String(unit?.["source excerpt"] || "").length <= 400
    && /\b(?:through|we['’]?re\s+at|moving\s+(?:through|to)|back\s+to)\b/iu.test(String(unit?.["source excerpt"] || ""));
  const headingLikeProceduralFragment = proceduralFragmentOnly
    && /\b(?:at|number|item)\s+(?:number\s+)?\d+(?:\.\w+)?\b/iu.test(String(unit?.["source excerpt"] || ""));
  const categoryFragmentLine = shortCategoryFragment
    ? AGENDA_CATEGORY_FRAGMENT_RULE
    : "";
  const rawGroundedSource = [
    String(unit?.["source excerpt"] || ""),
    semanticGroundingSourceExcerpt,
    String(unit?.["attribution source excerpt"] || ""),
  ].filter(Boolean).join("\n\n");
  const documentSourceOnly = !/^\s*SPEAKER_[0-9A-Z]+\s*:/imu.test(rawGroundedSource)
    && (/(?:^|\n)\s*(?:Attachment|Document|Source)\s*:/imu.test(rawGroundedSource)
      || /(?:^|\n)\s*(?:Email\s+from|Received\s+email|Sent\s+email)\b/imu.test(rawGroundedSource)
      || /(?:^|\n)\s*(?:From|To|Subject)\s*:/imu.test(rawGroundedSource)
      || /\b(?:received|sent)\s+email\b/iu.test(rawGroundedSource)
      || /\b(?:external sender|customer service team)\b/iu.test(rawGroundedSource)
      || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(rawGroundedSource));
  const documentOnlyGenerationContract = documentSourceOnly
    ? "DOCUMENT-ONLY GENERATION CONTRACT: this grounded unit is static attachment, document, or correspondence content. Write only neutral document prose about what the record states, reports, requires, schedules, permits, or warns. Identify an explicit sender as a party, organization, email, or correspondence source; never call that sender 'the speaker'. Never describe a live question, answer, discussion, hearing action, or meeting decision unless the document explicitly records that event. If a first-person email statement has an unclear actor, preserve it as 'the email reported' or use neutral passive wording rather than assigning it to a meeting speaker. When reduced summaries and canonical document evidence differ, trust the canonical evidence and omit the disputed detail rather than copying it. Keep each date attached to the exact event or document date stated with it; never transfer a date from one notice, upload, deadline, or email to another. For a long attachment, prefer fewer clearly grounded document facts over a broad synthesis of uncertain details."
    : "";
  const canonicalDocumentEvidence = documentSourceOnly
    && semanticGroundingSourceExcerpt
    && semanticGroundingSourceExcerpt !== String(unit?.["source excerpt"] || "")
    ? [
      "CANONICAL DOCUMENT EVIDENCE: the following attachment or correspondence source is authoritative. Reduced child summaries are coverage aids only; correct any conflicting date, sender, action, request, or document type from this canonical evidence.",
      semanticGroundingSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
      "END OF CANONICAL DOCUMENT EVIDENCE.",
    ].join("\n")
    : "";
  const siblingContext = (Array.isArray(siblingSummaries) ? siblingSummaries : [])
    .map((value, index) => `Sibling ${index + 1}: ${normalizeText(value)}`)
    .filter((value) => !value.endsWith(":"))
    .join("\n")
    .slice(-6000);
  const prompt = [
    "You are stage3 of a strict agenda summary pipeline.",
    "Grounding is authoritative. Do not invent boundaries or facts.",
    SOURCE_QUALIFIER_FIDELITY_RULE,
    documentOnlyGenerationContract,
    categoryFragmentLine,
    "The authoritative agenda label and item code identify the source span and may supply the identity of the item-owning committee, board, document, category, report code, project name, or named location; they are not evidence that the governing body received, acknowledged, approved, adopted, or otherwise acted on the item.",
    "You may repeat exact report-label details as document identity or title framing, including a report code, named coordinator role, report subject, or title wording such as budget amendment; do not turn that framing into a claim that the described action or outcome occurred.",
    "The agenda label's named presenter or organization identifies the agenda item, not necessarily the transcript speaker. Do not attribute speaking or presenting to that person or role unless the bounded source explicitly pairs the identity with the speech; use a generic presentation or remarks when attribution is not explicit.",
    "People named in an agenda label are identity metadata only. Do not turn those names into speakers, participants, recipients, attendees, or acting persons unless the bounded source explicitly supports that role or event.",
    "Never copy a parent agenda title's parenthetical list of people into generated prose when those people are absent from this bounded source excerpt; omit the list and use a generic event or participant description instead.",
    "Preserve temporal direction exactly: past-tense history or completed achievements are retrospective, while goals, plans, forecasts, and intended actions require explicit future-oriented source language. Do not turn a retrospective period into future goals or plans.",
    "Preserve occupation and status exactly: a past-tense statement that someone played, worked, served, or participated in a role establishes history but does not by itself support 'former', 'retired', 'ex-', or an ended status. Add those status words only when the source explicitly says the role ended.",
    "When an event host explicitly says 'I'd like to invite', 'I'll invite', or 'I'll start with inviting' a named person and the same bounded source then records that person participating, speaking, or receiving the described presentation, use concise event framing that the host invited that person; do not call an invitation completed when the source never records the person's participation.",
    "When several speakers or named people appear, keep every number, tenure, quote, role, and achievement attached to the person or speaker explicitly named with it. Do not transfer a nearby person's detail to another person, and do not call one subtopic the event's overall purpose unless the source explicitly frames it that way.",
    SPEAKER_HANDOFF_ATTRIBUTION_RULE,
    SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
    ROLE_ATTRIBUTION_FIDELITY_RULE,
    REPORT_INTRODUCTION_ATTRIBUTION_RULE,
    REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
    speakerHandoffEvidence
      ? `STRUCTURED SPEAKER-HANDOFF EVIDENCE: ${JSON.stringify(speakerHandoffEvidence)}`
      : "",
    GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
    "Preserve the source speech act and status: a question and answer is not necessarily a discussion or decision, an ongoing discussion is not completed, and a recommendation, possibility, or future timeline is not an action or outcome unless the source records that change.",
    questionAnswerOnly ? QUESTION_ANSWER_REPAIR_RULE : "",
    INFORMAL_DISCUSSION_STATUS_RULE,
    DOCUMENT_SOURCE_SPEECH_ACT_RULE,
    PROCEDURAL_DECISION_SEQUENCE_RULE,
    MOTION_CONTEXT_SEPARATION_RULE,
    CAUSAL_RELATIONSHIP_AUDIT_RULE,
    CONDITIONAL_RELATIONSHIP_AUDIT_RULE,
    proposalOptionScopeOnly ? OPTION_MOTION_SCOPE_RULE : "",
    REPORT_PROPOSAL_STATUS_RULE,
    PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
    REPORTED_PAST_ACTION_RULE,
    MOTION_AMENDMENT_DISPOSITION_RULE,
    AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
    AMENDMENT_SEQUENCE_REPAIR_RULE,
    AMENDMENT_EVIDENCE_PRIORITY_RULE,
    amendmentEvidence
      ? `STRUCTURED AMENDMENT EVIDENCE: ${JSON.stringify(amendmentEvidence)}`
      : "",
      ordinalMotionEvidence
        ? `LITERAL MOTION-SEQUENCE EVIDENCE: ${JSON.stringify(ordinalMotionEvidence)}. Use this only to keep motion order and subject/disposition ownership straight; the grounded source remains authoritative.`
        : "",
      ordinalMotionEvidence
        ? "If the extraction contains no explicit first-motion record, do not mention a first motion or turn an unnumbered on-table phrase into one. Omit that ambiguity and continue with the explicitly numbered motion in this source span."
        : "",
    CURRENT_MEETING_MINUTES_ACTION_RULE,
    CURRENT_MEETING_BODY_ATTRIBUTION_RULE,
    CATEGORY_ACTION_BINDING_RULE,
    AGENDA_CATEGORY_FRAGMENT_RULE,
    "When the source explicitly records 'moved by myself' or a motion being moved and the bounded item is a council or committee action, use a generic attribution such as 'a council member moved' without outputting an internal speaker ID or a named office; do not infer a specific person, title, or stronger actor.",
    "Treat ambiguous procedural remarks such as 'don't need to do that' as ambiguous. Do not infer that a motion was opposed, withdrawn, rejected, carried, or abandoned, and do not infer the speaker's reason; preserve only an explicit motion status or omit the ambiguity.",
    "When an ambiguous response is the only substantive evidence in a short procedural item and no explicit disposition is recorded, summarize the listed item neutrally and say that no explicit disposition is recorded; do not restate or paraphrase the ambiguous response as a reason or decision.",
    "When the source records an explicit procedural inquiry followed by a literal no-response observation, such as 'Anybody?' followed by 'Seeing none' or an inquiry about declarations followed by 'none', use concise neutral wording that the listed item was addressed or recorded with none reported; do not add a formal motion or stronger action.",
    STRUCTURED_IDENTITY_BINDING_RULE,
    SOURCE_TOPIC_RELATIONSHIP_RULE,
    SEPARATE_REMARKS_SCOPE_RULE,
    SOURCE_QUALIFIER_FIDELITY_RULE,
    "The current agenda label is the binding scope. When trailing source lines announce or perform a different agenda item, keep that neighboring item out of the current summary even if the boundary context is inside the excerpt; never attach its motion, mover, seconder, question, answer, or outcome to the current label.",
    "The source excerpt may include trailing boundary context. Locate the first explicit sentence that announces a different report or agenda item and stop the current summary before that sentence; treat every later line as next-item boundary context, not evidence for this item.",
    COMPOSITE_MOTION_SCOPE_RULE,
    CONSENT_AGENDA_SCOPE_REPAIR_RULE,
    String(unit?.status || "").toLowerCase() === "container" ? CONTAINER_HANDOFF_RULE : "",
    "Exception for literal consent agendas: when one source-recorded consent-agenda motion explicitly lists multiple sibling agenda items and includes the current item, that range is one shared action. Preserve the exact listed range and explicit approval or carried outcome; do not call it neighboring contamination merely because the motion names sibling items.",
    PROCEDURAL_FRAGMENT_RULE,
    PROCEDURAL_SELF_REPORT_RULE,
    ADDITIONAL_BUSINESS_REMARKS_RULE,
    ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
    PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE,
    "For a short procedural span, use only literal headings, questions, answers, announcements, and explicit motion status. Do not turn a heading plus a brief response into stronger procedural action or attribution than the words support.",
    "You may use structural framing such as 'the item discussed', 'the committee minutes describe', or 'the report concerns' when the authoritative label identifies that item; this framing is metadata and is not an added action or outcome.",
    "When the source explicitly says a speaker is giving remarks at a special event, saying goodbye, or saying farewell to named members, you may use farewell presentation as event framing and retain those source-listed names. Do not infer that every named person spoke, delivered a farewell speech, or received a presentation unless the source explicitly pairs that role or event with the person.",
    "Use the grounded transcript excerpt as the sole evidence for every action, outcome, category, cause, and attribution in the generated prose.",
    "Do not promote a staff recommendation addressed to one body into that body's completed action. If the source records a different committee or board carrying the motion, preserve that actual actor and outcome.",
    governingBody ? `Authoritative meeting body identity: ${governingBody}. Use that exact body label when naming the acting body; do not substitute another committee, council, board, or paraphrased body name.` : "",
    "If a motion is only introduced or proposed and the source excerpt does not record that it passed, do not say the body received, approved, adopted, or carried it; state that the motion was proposed or omit the outcome.",
    "Do not infer a speaker's title, office, chair role, or institutional authority from a name alone. Use a generic speaker reference or omit the name unless the same bounded source excerpt explicitly supplies that role.",
    "Transcript speaker identifiers are internal metadata, not people or facts. Never mention labels such as SPEAKER_072 or Speaker 072 in generated summary or chapter text.",
    "Before returning, scan summary and chapter text for SPEAKER_ or Speaker_ labels and remove them by using a generic subject. Preserve qualified absences exactly: no notice or no notice given does not mean no motion or no item exists.",
    "Do not use received or acknowledged for a correspondence item unless the literal source excerpt explicitly uses that action; a correspondence heading or a verbal note is not proof of either action.",
    "For a procedural source span, report the explicit opportunity, announcement, or item listing; do not infer that a named speaker opened, closed, transitioned, or otherwise controlled the proceeding.",
    "For a public forum or other open testimony, call something a topic only when a speaker develops it as an issue, request, concern, question, or argument. Do not promote a passing mention of a place, object, personal background, or evidence collection into a forum-wide topic.",
      governingBody ? `The authoritative meeting body is ${governingBody}; reject a different acting-body label for an action, but do not reject the item-owning committee or board identity supplied by the authoritative agenda label.` : "",
    "Return one valid JSON object only. Do not return markdown.",
    "Required keys: summary, chapter text, confidence, notes.",
    "notes must be a short string, not an array.",
    "Example: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}",
    "summary: factual, source-aligned, proportional to section size, and written as complete grammatical sentences with an explicit subject and finite verb.",
    "Never copy a punctuation-free transcript fragment into summary; synthesize it into reporting prose.",
    "chapter text: exactly one 6-12 word chapter-ready headline on one line. If not split, still provide a useful headline.",
    "chapter text must accurately name the distinct main point stated in summary. Never copy the source excerpt, URLs, document headings, dates, or line breaks into chapter text.",
    "chapter text must be a complete, self-contained headline; do not end with a dangling conjunction, comma, preposition, or participle such as 'while', 'and', 'including', 'utilizing', or 'arguing'. Rewrite a long headline to 6-12 complete words; never truncate it mid-phrase.",
    "Use transcript-specific nouns, actions, concerns, and outcomes from the source excerpt. Do not use agenda-label prose as a substitute for what was said.",
    "Do not turn discussion of an alternative design or a future meeting into a deferral when the same source span later records that the active motion was carried; preserve the recorded motion outcome.",
    "When the source records a carried motion or other clear outcome within this bounded span, include that outcome when the summary budget allows; do not replace a decision with a claim that no decision occurred.",
    "If the bounded excerpt ends by handing off to another agenda item, summarize only the current item before that handoff; do not import the next item's report or facts merely because they appear in trailing boundary context.",
    "When the source is a resolution, correspondence, or recommendation, state the concrete requested actions or policy changes; do not reduce it to adoption, receipt, background costs, or a request for review.",
    "chapter text must use concrete keywords from the source. Do not start it with 'the discussion addresses', 'the presentation addresses', or an agenda label ending in 'Re'.",
    "Do not write filler such as 'the section also covers' or 'the section also details'.",
    isChild
      ? "This excerpt is one character-bounded source chunk. Summarize the substantive information in this chunk, not the parent agenda label or a generic introduction."
      : "",
    isChild
      ? "Partition guidance: lead with concrete actions, names, regions, figures, or list/table rows unique to this source chunk. For an appendix or membership table, summarize its entries instead of repeating the parent document's announcement."
      : "",
    isChild && siblingContext
      ? "Treat sibling summaries only as a do-not-repeat exclusion list. Use this source excerpt as the sole evidence, and report a more specific distinct detail from it rather than repeating a sibling's facts or framing."
      : "",
    isChild && siblingContext
      ? `FORBIDDEN ALREADY-COVERED CLAIMS: do not mention or paraphrase the substantive claims, outcomes, conditions, figures, locations, or framing in these sibling summaries. Select a distinct supported detail from this source window instead: ${siblingContext}`
      : "",
    siblingContext ? "Existing sibling summaries:" : "",
    siblingContext,
    `Summary budget tier: ${budget.tier}`,
    `Budget max sentences: ${budget.maxSentences}`,
    `Budget max words: ${budget.maxWords}`,
    `Procedural section: ${budget.procedural ? "yes" : "no"}`,
    longOrderLine,
    longCoverageLine,
    largeBoundedChild
      ? "Bounded-chunk guidance: use 1 to 4 complete sentences as needed to cover the distinct evidence, findings, or requests in this source chunk without padding."
      : "",
    "Do not mention names, figures, or decisions not present in the grounded source excerpt.",
    "Do not name a motion mover or seconder unless one source line explicitly pairs that person's name with moving or seconding the motion. A nearby name callout, speaker change, or conflict declaration is not mover evidence. When identity is unclear, describe what Council considered or approved without naming the mover.",
    "Preserve financial direction for each amount. Additional funding, budget increases, repair or project costs, allowances, contingencies, estimates, and reserve draws are requests or costs, not savings or reductions. Available funds or no immediate budget impact does not change that direction.",
    "Do not attach a staff-efficiency saving, cost avoidance, or other separate benefit to an amount unless the source explicitly connects that amount to the benefit. Keep requested costs and savings as separate source-faithful claims.",
    "Preserve numeric fidelity: write quantities and numbered street ordinals with Arabic digits exactly as shown in the source (for example, 24 and 15th Avenue), never spelled or hyphenated number words.",
    "",
    `Focus: ${focus || "newsworthy factual civic reporting"}`,
    parentOverviewGenerationContract,
    parentOverviewGenerationContract ? PARENT_SPEECH_ACT_AND_ACTOR_RULE : "",
    parentOverviewGenerationContract
      ? "Parent-overview role rule: literal source anchors outrank child-summary coverage aids. Preserve a named speaker, title, office, or staff role only when the same literal anchor explicitly pairs it with the claim; otherwise use generic or impersonal wording and omit the name-role pairing."
      : "",
    `Label: ${promptLabel}`,
    `Agenda item: ${unit["agenda item"] || ""}`,
    "Do not mention internal row numbers, source-chunk timing, or processing metadata.",
    documentOnlyGenerationContract,
    "Grounded source excerpt:",
    String(unit["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
    "END OF GROUNDED SOURCE.",
    canonicalDocumentEvidence,
    "Now return exactly one concise JSON object with only these keys: summary, chapter text, confidence, notes. Do not extract or enumerate the source document, and do not add keys such as document_type, title, date, status, or legislation.",
  ].join("\n");

  const queryParsed = async (extraLine = "", retryOptions = {}) => {
    const q = extraLine ? `${prompt}\n${extraLine}` : prompt;
    return callOllamaJson({
      ollamaUrl,
      llmModel,
      system: documentSourceOnly
        ? "Produce strict JSON only for grounded document summaries. Follow the document-only generation contract and never recast correspondence as meeting dialogue."
        : "Produce strict JSON only for grounded section summaries.",
      prompt: q,
      // Keep every repair/retry response bounded.  Without an explicit
      // output cap, a managed model can spend the whole request budget
      // elaborating a strict-JSON response and starve later agenda units.
      maxOutputTokens: 720,
      temperature: Object.hasOwn(retryOptions, "temperature") ? retryOptions.temperature : temperature,
      seed: Object.hasOwn(retryOptions, "seed") ? retryOptions.seed : seed,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
  };

  const structuredIdentityLabel = String(unit?.label || promptLabel || "");
  const authoritativeIdentityDate = [...structuredIdentityLabel.matchAll(MONTH_DATE_PATTERN)][0]?.[0] || "";
  const queryFreshGroundedRepair = async (rejectedClaims = "", attempt = 1, rejectedOutput = "") => {
    const finalFreshRepair = attempt >= 3;
    const repairStrategy = attempt === 1
      ? "Recheck the rejected claim against the literal source and restate the supported event with its source-supported action, timing, and status. Do not preserve a weaker or stronger paraphrase that caused the rejection."
      : attempt === 2
        ? "The prior repair did not resolve the audit allegation. Compare the rejected prose with the rejection reason, then write a materially different source-grounded sentence that states the source's explicit action and temporal relationship directly."
        : "Final fresh source-grounded prose repair: discard the rejected wording entirely and write only from the literal source excerpt. If any disputed detail remains unclear, omit that detail while retaining the supported civic action or outcome as a complete sentence.";
    const rejectedOutputLine = finalFreshRepair
      ? "Do not include or imitate any prior rejected output; write from the grounded source excerpt only."
      : `PRIOR_REJECTED_OUTPUT: ${String(rejectedOutput || "(none supplied)").slice(0, 3200)}`;
    const categoryFragmentRepairLine = shortCategoryFragment
      ? `Short non-substantive category-fragment repair: ${AGENDA_CATEGORY_FRAGMENT_RULE} Return only fresh neutral LLM prose; do not preserve any rejected staff-report, hierarchy, motion, or carried wording.`
      : "";
    const authoritativeDateRepairLine = /authoritative structured-identity date repair/iu.test(rejectedClaims)
      ? `Authoritative date override: the structured agenda label is ${structuredIdentityLabel}. Use the label date exactly as ${authoritativeIdentityDate || "structured identity"} or omit the date. The transcript/ASR date is conflicting evidence and must not appear in either field.`
      : "";
    const chairFloorRepairLine = /floor\s+for\s+discussion|placing\s+the\s+item|\b(?:placed|brought|put|moved)\b.{0,40}\bfloor|floor\s+(?:was|is)\s+(?:opened|put|placed)\s+for\s+consideration|discussion\s+(?:proceeded|occurred|took\s+place)\b/iu.test(`${rejectedClaims} ${rejectedOutput}`)
      ? "Procedural-floor repair: the source's chair-announced status must be impersonal. Never use 'placing', 'placed', 'brought', 'put', or 'moved' an item onto the floor for discussion when that makes a participant perform the chair's status announcement; write 'the motion was on the floor for discussion' or omit the status."
      : "";
    return callOllamaJson({
      ollamaUrl,
      llmModel,
      system: finalFreshRepair
        ? "Write fresh source-grounded civic prose from the literal source only. Return strict JSON only."
        : "Write source-grounded civic prose after a rejected grounding audit. Return strict JSON only.",
      prompt: [
      `Source-grounding repair attempt ${attempt} of 3.`,
      repairStrategy,
      PROCEDURAL_FLOOR_SEQUENCE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      authoritativeDateRepairLine,
      chairFloorRepairLine,
      categoryFragmentRepairLine,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      "Summary is required: return at least one complete factual sentence ending with sentence punctuation. Never return an empty summary after a grounding rejection.",
      "If a speaker identity or role is unclear, omit that identity but preserve the supported topic, request, concern, or outcome in a generic complete sentence.",
      "Conditional/contrast repair: preserve the source's logical relationship exactly. If the source uses but, if, unless, would, contingent, or so that, do not rewrite it as a before/after sequence or as unconditional support, opposition, causation, or completion. Use a neutral conditional formulation or omit the disputed relationship.",
      "Start over from the literal source excerpt below. Do not preserve any rejected unsupported claim. If the feedback identifies a narrowed or incomplete action, restore the complete scope that the source explicitly supports instead of omitting the affected items.",
      "Preserve temporal direction exactly: past-tense history or completed achievements are retrospective, while goals, plans, forecasts, and intended actions require explicit future-oriented source language. Do not turn a retrospective period into future goals or plans.",
      "Preserve occupation and status exactly: a past-tense statement that someone played, worked, served, or participated in a role establishes history but does not by itself support 'former', 'retired', 'ex-', or an ended status. Add those status words only when the source explicitly says the role ended.",
      "When an event host explicitly says 'I'd like to invite', 'I'll invite', or 'I'll start with inviting' a named person and the same bounded source then records that person participating, speaking, or receiving the described presentation, use concise event framing that the host invited that person; do not call an invitation completed when the source never records the person's participation.",
      "When several speakers or named people appear, keep every number, tenure, quote, role, and achievement attached to the person or speaker explicitly named with it. Do not transfer a nearby person's detail to another person, and do not call one subtopic the event's overall purpose unless the source explicitly frames it that way.",
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      speakerHandoffEvidence
        ? `STRUCTURED SPEAKER-HANDOFF EVIDENCE: ${JSON.stringify(speakerHandoffEvidence)}`
        : "",
      GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
      "Preserve the source speech act and status: a question and answer is not necessarily a discussion or decision, an ongoing discussion is not completed, and a recommendation, possibility, or future timeline is not an action or outcome unless the source records that change.",
      INFORMAL_DISCUSSION_STATUS_RULE,
      DOCUMENT_SOURCE_SPEECH_ACT_RULE,
      PROCEDURAL_DECISION_SEQUENCE_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      REPORT_PROPOSAL_STATUS_RULE,
      REPORTED_PAST_ACTION_RULE,
      MOTION_AMENDMENT_DISPOSITION_RULE,
      AMENDMENT_LAYER_AUDIT_PRIORITY_RULE,
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      CURRENT_MEETING_BODY_ATTRIBUTION_RULE,
      CATEGORY_ACTION_BINDING_RULE,
      AGENDA_CATEGORY_FRAGMENT_RULE,
      "When the source explicitly records 'moved by myself' or a motion being moved and the bounded item is a council or committee action, use a generic attribution such as 'a council member moved' without outputting an internal speaker ID or a named office; do not infer a specific person, title, or stronger actor.",
      "Treat ambiguous procedural remarks such as 'don't need to do that' as ambiguous. Do not infer that a motion was opposed, withdrawn, rejected, carried, or abandoned, and do not infer the speaker's reason; preserve only an explicit motion status or omit the ambiguity.",
      "When an ambiguous response is the only substantive evidence in a short procedural item and no explicit disposition is recorded, summarize the listed item neutrally and say that no explicit disposition is recorded; do not restate or paraphrase the ambiguous response as a reason or decision.",
      "When the source records an explicit procedural inquiry followed by a literal no-response observation, such as 'Anybody?' followed by 'Seeing none' or an inquiry about declarations followed by 'none', use concise neutral wording that the listed item was addressed or recorded with none reported; do not add a formal motion or stronger action.",
      "The current agenda label is the binding scope. When trailing source lines announce or perform a different agenda item, keep that neighboring item out of the current summary even if the boundary context is inside the excerpt; never attach its motion, mover, seconder, question, answer, or outcome to the current label.",
      COMPOSITE_MOTION_SCOPE_RULE,
      CONSENT_AGENDA_SCOPE_REPAIR_RULE,
      String(unit?.status || "").toLowerCase() === "container" ? CONTAINER_HANDOFF_RULE : "",
      "Exception for literal consent agendas: when one source-recorded consent-agenda motion explicitly lists multiple sibling agenda items and includes the current item, that range is one shared action. Preserve the exact listed range and explicit approval or carried outcome; do not call it neighboring contamination merely because the motion names sibling items.",
      PROCEDURAL_FRAGMENT_RULE,
      PROCEDURAL_SELF_REPORT_RULE,
      ADDITIONAL_BUSINESS_REMARKS_RULE,
      ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
      "For a short procedural span, use only literal headings, questions, answers, announcements, and explicit motion status. Do not turn a heading plus a brief response into stronger procedural action or attribution than the words support.",
      "The authoritative agenda identity may supply the identity of the item-owning committee, board, document, category, report code, project name, or named location, but it is not evidence for an action, outcome, receipt, acknowledgement, or speaker role.",
      "Use the authoritative agenda identity, including its item-owning committee or board, for identity terminology when needed, but do not use it as evidence for an action, outcome, cause, or speaker role.",
      "You may repeat exact report-label details as document identity or title framing, including a report code, named coordinator role, report subject, or title wording such as budget amendment; do not turn that framing into a claim that the described action or outcome occurred.",
      "The agenda label's named presenter or organization identifies the agenda item, not necessarily the transcript speaker. Do not attribute speaking or presenting to that person or role unless the bounded source explicitly pairs the identity with the speech; use a generic presentation or remarks when attribution is not explicit.",
      "People named in an agenda label are identity metadata only. Do not turn those names into speakers, participants, recipients, attendees, or acting persons unless the bounded source explicitly supports that role or event.",
      "Never copy a parent agenda title's parenthetical list of people into generated prose when those people are absent from this bounded source excerpt; omit the list and use a generic event or participant description instead.",
      "You may retain structural framing such as 'the item discussed', 'the committee minutes describe', or 'the report concerns' when the authoritative label identifies that item; this framing is metadata, not an added action or outcome.",
      "When the source explicitly says a speaker is giving remarks at a special event, saying goodbye, or saying farewell to named members, you may use farewell presentation as event framing and retain those source-listed names. Do not infer that every named person spoke, delivered a farewell speech, or received a presentation unless the source explicitly pairs that role or event with the person.",
      governingBody ? `Use the exact meeting body label only when the source explicitly records an action by that body: ${governingBody}.` : "",
      "If the source does not name the acting governing body in an action sentence, use a generic committee or meeting subject for that action; the agenda label may still identify the item-owning committee or board.",
      "Use generic institutional subjects and omit personal names or titles unless the source excerpt explicitly supplies them.",
      "Transcript speaker identifiers are internal metadata, not people or facts. Never mention labels such as SPEAKER_072 or Speaker 072 in generated summary or chapter text.",
      "Source speaker labels are evidence metadata. Check the generated summary and chapter text themselves before rejecting them; do not copy or mention a source label, but do not treat a source-only label as if it appeared in the candidate.",
      "Before returning, scan summary and chapter text for SPEAKER_ or Speaker_ labels and remove them by using a generic subject. Preserve qualified absences exactly: no notice or no notice given does not mean no motion or no item exists.",
      "For procedural opportunities or item listings, use only a generic subject such as the committee or the meeting; do not write Chair, member, councillor, or any personal name.",
      "For a public forum or other open testimony, call something a topic only when a speaker develops it as an issue, request, concern, question, or argument. Do not promote a passing mention of a place, object, personal background, or evidence collection into a forum-wide topic.",
      "If a motion is only proposed, do not call it received, approved, adopted, or carried. If a correspondence heading is not matched by a literal receipt action, describe only the source's verbal note or discussion.",
      "When the source records a carried motion or other clear outcome within this bounded span, include that outcome when the summary budget allows; do not replace a decision with a claim that no decision occurred.",
      "If the excerpt includes a handoff to another agenda item, stop the current item at that handoff and omit following-item facts.",
      "Locate the first explicit sentence that announces a different report or agenda item and stop the current summary before that sentence; treat every later line as next-item boundary context, not evidence for this item.",
      "Do not add relative order, immediacy, or transition language between agenda items unless the source explicitly states it.",
      "If a detail is uncertain, omit it while preserving the supported topic and action as complete prose.",
      STRUCTURED_IDENTITY_BINDING_RULE,
      SOURCE_TOPIC_RELATIONSHIP_RULE,
      SEPARATE_REMARKS_SCOPE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
      rejectedOutputLine,
      `AGENDA_IDENTITY_ONLY: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      ].filter(Boolean).join("\n\n"),
      maxOutputTokens: 720,
      temperature: finalFreshRepair ? 0.25 : (attempt === 2 ? 0.45 : 0.35),
      seed: seed + 7000 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  };
  const queryConservativeUnsupportedSpeechActRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    appendUniversalContract: false,
    system: "Write fresh source-grounded civic prose after an unsupported speech-act audit. Return strict JSON only.",
    systemSuffix: "HARD UNSUPPORTED-SPEECH-ACT OVERRIDE: the audit says the candidate asserted a support statement, proposal, recommendation, question, or other speech act that the bounded source does not explicitly record. Do not preserve, paraphrase, or infer that disputed speech act. Omit the absent claim and retain only separate source-supported discussion, review, concern, cost, topic, or outcome in neutral prose. Do not turn adjacent background into a speaker's support, proposal, recommendation, or request. Do not mention this audit or repair contract in either output field.",
    prompt: [
      `Unsupported speech-act repair attempt ${attempt} of 3.`,
      "Start over from GROUNDED_SOURCE only; the rejected candidate and audit are untrusted diagnostic context.",
      "Remove every claim that the source does not explicitly record, including inferred 'would support', 'supported', 'proposed', 'recommended', 'asked', or 'wanted to share' speech acts. Do not replace an absent speech act with another inferred actor or action.",
      "If the source explicitly records separate discussion, review, costs, concerns, or topics, retain those as neutral source-grounded prose without assigning a support, proposal, recommendation, or request. If no complete claim remains, use only the source-supported topic or omit the disputed clause while returning one complete sentence.",
      "Keep independent speakers and source blocks separate. Do not merge one speaker's review or question with another speaker's topic, and do not use a nearby name or role as evidence for the absent speech act.",
      SOURCE_QUALIFIER_FIDELITY_RULE,
      UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE,
      `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "the candidate contains a speech act not explicitly recorded in the source"}`,
      rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return one non-empty complete summary and chapter text as JSON. Do not copy rejected wording, audit fragments, or an unsupported speech act.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.1,
    seed: seed + 16060 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeGenericPluralActorRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose with faithful actor number. Return strict JSON only.",
        systemSuffix: [
          "HARD GENERIC-PLURAL-ACTOR OVERRIDE: the audit says the prior output used a plural generic actor for a claim paired with one source speaker. Replace that actor with the explicitly paired named speaker, singular 'a speaker', or impersonal source wording. Do not use 'speakers', 'participants', 'members', 'officials', or another plural generic actor for the disputed claim.",
          GENERIC_PLURAL_ACTOR_FIDELITY_RULE,
          "Preserve the source-supported action, proposal, figures, and speech act; this is an actor-number repair, not permission to omit the substantive claim or import a different actor. Keep adjacent remarks from other speaker blocks separate.",
          pass > 1
            ? "The preceding repair still used a plural generic actor. Discard it completely and regenerate with singular or impersonal wording while retaining the supported claim."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Generic-plural actor repair attempt ${attempt}.${pass} of 3.`,
          "Start over from GROUNDED_SOURCE only. The rejected candidate and audit are diagnostic context, not source evidence.",
          "The source may contain several people elsewhere in the window, but the retained action must keep the actor number and block pairing supported by the literal source. If one source speaker gives the figures or proposal, write 'a speaker' or the explicitly paired name, not 'speakers' or another plural subject.",
          "Do not merge a nearby question, response, or separate speaker block into the corrected claim. Do not broaden one speaker's statement into a collective discussion merely because the item contains multiple speakers.",
          `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "the prior output used an unsupported plural generic actor"}`,
          rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy the rejected plural actor or audit wording.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 17060 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!/\b(?:speakers|participants|members|officials)\b/iu.test(repairedText)) return repaired;
    }
    return repaired;
  };
  const queryConservativeUnsupportedQualifierRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose with faithful descriptive strength. Return strict JSON only.",
        systemSuffix: [
          "HARD UNSUPPORTED-QUALIFIER OVERRIDE: the audit identified a descriptive qualifier or modifier in the prior output that the bounded source does not explicitly support. Remove only that unsupported modifier and preserve the complete source-supported subject, action, presentation, figures, and speech act. Do not replace it with a stronger, newer, broader, or more specific synonym.",
          SOURCE_QUALIFIER_FIDELITY_RULE,
          pass > 1
            ? "The preceding repair retained an unsupported descriptor. Discard it completely and regenerate with literal source nouns and actions only; keep the substantive claim rather than dropping the whole supported topic."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Unsupported-qualifier repair attempt ${attempt}.${pass} of 3.`,
          "Start over from GROUNDED_SOURCE only. The rejected candidate and audit are diagnostic context, not source evidence.",
          "Identify the core source-supported event or topic, then remove any adjective, modifier, or evaluative descriptor that the source does not explicitly pair with it. For example, if the source describes a changed budget-book structure but does not call it new or digital, report the presentation or structure without those unsupported modifiers.",
          "Do not omit the complete supported presentation, report, proposal, action, or outcome merely because one modifier was rejected. Do not import a modifier from the agenda label, sibling chapter, or broader meeting context.",
          `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "the prior output used an unsupported descriptive qualifier"}`,
          rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy the rejected modifier or audit wording.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 18060 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!unsupportedQualifierGroundingDefect(repairedText)) return repaired;
    }
    return repaired;
  };
  const queryConservativeFragmentedSourceRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose from fragmented transcript lines. Return strict JSON only.",
        systemSuffix: [
          "HARD FRAGMENTED-TRANSCRIPT OVERRIDE: the audit disputed a claim because the bounded transcript is fragmented or ends on an incomplete line. Rebuild from the literal source only. Join adjacent source lines within the same speaker block when they jointly state a complete fact, but never complete a final mid-thought fragment or import a later/sibling sentence.",
          FRAGMENTED_TRANSCRIPT_GROUNDING_RULE,
          SOURCE_QUALIFIER_FIDELITY_RULE,
          pass > 1
            ? "The preceding repair still repeated an unsupported completion, evaluation, or scope. Discard it and retain only complete literal facts; omit the disputed clause rather than guessing."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Fragmented-source grounding repair attempt ${attempt}.${pass} of 3.`,
          "The rejected candidate and audit are diagnostic context, not source evidence.",
          FRAGMENTED_TRANSCRIPT_GROUNDING_RULE,
          "Preserve every complete topic, action, amount, relationship, and speech act that is stated across adjacent lines in this bounded source. Remove only an unsupported completion, adjective, evaluative description, actor, outcome, or scope. A shorter summary is correct when that is the only way to avoid completing an unfinished fragment.",
          `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "the audit identified a claim that was not safely grounded in fragmented source lines"}`,
          rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy audit wording or a rejected completion.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 19060 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!fragmentedTranscriptGroundingDefect(repairedText)) return repaired;
    }
    return repaired;
  };
  const queryConservativeSeparateDiscussionRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose that keeps separate transcript remarks separate. Return strict JSON only.",
        systemSuffix: [
          "HARD SEPARATE-REMARKS OVERRIDE: the audit says the draft merged distinct speaker blocks, questions, answers, or topics into one discussion or causal claim. Rebuild from the literal bounded source only.",
          SEPARATE_REMARKS_SCOPE_RULE,
          "Use separate neutral clauses or sentences for independently sourced remarks. Do not write a single 'discussion regarding' sentence that makes separate topics one unified event, and do not use driven by, caused by, impacted, led to, or another causal connector unless the same source block explicitly states that relationship.",
          pass > 1
            ? "Discard the preceding repair completely. Keep only source-connected claims from one exchange at a time; omit any topic whose relationship to another speaker's remark is not explicit."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Separate-remarks grounding repair attempt ${attempt}.${pass} of 3.`,
          "The rejected candidate and audit are diagnostic context, not source evidence.",
          SEPARATE_REMARKS_SCOPE_RULE,
          "Preserve complete factual content from the bounded source, but keep each speaker block's topic and speech act separate. If the source contains a connected question-and-answer exchange, it may be summarized as one exchange; do not merge that exchange with an adjacent speaker's independent explanation, cause, trend, or outcome.",
          "A shorter summary is correct when the source does not support a safe relationship between topics. Do not add a formal meeting action, institutional actor, cause, impact, or outcome.",
          `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "the audit identified merged or over-broad discussion scope"}`,
          rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy audit wording or the rejected merged claim.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 19120 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      const repeatedMergedDiscussion = /\b(?:single|combined|unified)\s+(?:discussion|event|claim)|\bdiscussion\s+regarding\b[^.!?]{0,180}\b(?:driven\s+by|caused\s+by|impact(?:s|ed|ing)?|link(?:ed)?\s+to)\b/iu.test(repairedText);
      if (!repeatedMergedDiscussion) return repaired;
    }
    return repaired;
  };
  const queryConservativeReferredAgendaScopeRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    appendUniversalContract: false,
    system: "Write one source-grounded civic summary that preserves referred-back and phase-specific agenda chronology. Return strict JSON only.",
    systemSuffix: [
      "HARD REFERRED-AND-TEMPORAL-SCOPE OVERRIDE: preserve every temporal distinction in the source. If the source refers one or more matters back from an earlier meeting into this meeting, describe them as previously referred items, not as new current agenda items, new motions, or new decisions unless the literal source explicitly records those current actions. If the source distinguishes a morning session, lunch period, afternoon or later phase, prior meeting, or future consideration, do not collapse one phase into another.",
      "Keep the current meeting's actual discussion, questions, recommendations, motions, and outcomes separate from the earlier meeting's referred matters. Do not erase the referred topics, invent a disposition for them, or treat the earlier meeting as the current meeting.",
      "Keep source-stated qualifiers such as 'would provide an overview', 'for consideration', 'mentioned previously', and 'not necessarily discussed'. If a source line says options were discussed over lunch or at a previous meeting, do not call them options discussed in the current morning session merely because the same bounded excerpt mentions both phases. If the bounded source only records that matters were referred or mentioned for future consideration, write only that referral or mention. If it later records a report, explanation, question, or debate about a referred matter, describe that later source content neutrally without saying that the committee as an institution discussed it unless the same source explicitly pairs that body with the action.",
    ].join(" "),
    prompt: [
      `Referred-or-temporal-agenda-scope repair attempt ${attempt} of 3.`,
      "Start over from GROUNDED_SOURCE only. The rejected candidate and audit are untrusted diagnostic context and must not be copied.",
      "If the source says matters were referred back from a prior meeting, state that they were referred from that earlier meeting and were discussed or presented in the current meeting only when later source lines support that current action. If the source distinguishes morning, lunch, afternoon, earlier, later, or future phases, preserve those distinctions instead of merging them. Preserve the source's complete list of referred topics and any source-supported current speaker or report context.",
      "Do not describe the referred matters as new agenda items, new motions, or current decisions merely because they were discussed after the meeting reconvened. Preserve a later explicit current motion or outcome only when the source pairs it with that motion or outcome.",
      "Prefer impersonal wording such as 'the source records items referred back from the previous meeting and later records discussion of the Social Pinpoint matter' when that is what the bounded source supports. Do not write 'the committee reconvened to discuss' or 'a speaker discussed' unless the literal source explicitly supports that exact current action in the supplied span.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION: ${String(rejectedClaims).slice(0, 3200)}` : "",
      rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return exactly one non-empty complete summary and chapter text as JSON. Do not include audit language, transcript speaker identifiers, or unsupported motions and outcomes.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.1,
    seed: seed + 19240 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryProceduralFloorRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    const procedureOnlyGroundingDefect = /\b(?:does\s+not\s+record|no\s+(?:explicit\s+)?(?:second|vote|disposition)|only\s+(?:states?|says?)\b.{0,80}\bfloor\s+for\s+discussion|not\s+(?:a\s+)?formal|formal\s+(?:pairing|procedural)|put\s+to\s+a\s+vote)\b/iu.test(`${rejectedClaims} ${rejectedOutput}`);
    return callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Write one conservative source-grounded civic summary for a chair-announced procedural-floor status. Never attribute floor placement to a mover or participant. Return strict JSON only.",
      appendUniversalContract: false,
      systemSuffix: [
        "HARD PROCEDURAL-FLOOR OVERRIDE: in this repair, never output the words 'seconded' or 'seconder' in either JSON text field. Omit that optional procedural detail even when the general contract says a generic moved-and-seconded paraphrase can be faithful.",
        procedureOnlyGroundingDefect
          ? "HARD PROCEDURAL-PAIRING OVERRIDE: the audit says this bounded span records only floor discussion or lacks an explicit second, vote, disposition, or formal pairing. In this repair never output the procedural words 'motion', 'moved', 'seconded', 'vote', 'carried', 'defeated', or 'floor'; use neutral discussion wording and omit the formal clause."
          : "",
      ].filter(Boolean).join(" "),
      prompt: [
        `Procedural-floor repair attempt ${attempt} of 3.`,
        "Start over from GROUNDED_SOURCE only; the rejected candidate and audit are untrusted repair context.",
        PROCEDURAL_FLOOR_SEQUENCE_RULE,
        "If the source says a chair or clerk announced that a motion is now on the floor for discussion, use exactly the impersonal status 'the motion was on the floor for discussion' or omit that status. Never output placing, placed, bringing, brought, putting, put, or moving an item onto the floor for discussion, and never make the mover or another participant perform that status announcement.",
        "If the source records a motion being moved but no disposition, describe only a proposal-stage motion and say no disposition was recorded. In this conservative floor-status repair, omit the optional word 'seconded' and all seconder metadata even when the source appears to record it; do not make the output depend on resolving a mover-name correction. Do not claim the proposed subject happened or was completed. If the source records a carried or defeated outcome, retain that outcome without a personal mover name.",
        "When mover spellings conflict, output no personal mover or seconder name. Use impersonal motion wording or omit the actor clause. Preserve qualified staff speech or omit the disputed staff clause.",
        "If the rejection or source evidence disputes whether the seconding phrase is explicitly paired, or shows a mover-name correction, do not resolve that conflict. Omit the word seconded and any actor clause; a conservative omission is correct. Retain only a source-supported motion introduction and impersonal floor status, or omit the motion clause entirely if its subject is also disputed.",
        procedureOnlyGroundingDefect
          ? "The audit identifies only procedural floor discussion without a complete formal pairing. Use neutral discussion wording and omit the formal motion clause entirely."
          : "",
        MOTION_CONTEXT_SEPARATION_RULE,
        ROLE_ATTRIBUTION_FIDELITY_RULE,
        `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
        rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
        `AGENDA_LABEL: ${promptLabel}`,
        `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
        "FINAL SYSTEM-CONSISTENT CHECK: return grammatical civic prose with no actor-attributed floor placement, no conflicting personal mover/seconder name, and no use of 'seconded' or 'seconder' in this conservative floor-status repair. Use impersonal floor status or omit it.",
      ].filter(Boolean).join("\n\n"),
      maxOutputTokens: 720,
      temperature: attempt >= 3 ? 0 : 0.1,
      seed: seed + 10020 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    const draft = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Write fresh source-grounded civic prose after a combined grounding audit rejection. Return strict JSON only.",
      prompt: [
        `Procedural-floor attribution repair attempt ${attempt} of 3.`,
        "The rejected candidate used 'placing the item on the floor for discussion' or equivalent wording that makes the mover or another participant perform the chair's status announcement, and the same repair may contain other independently rejected claims.",
        PROCEDURAL_FLOOR_SEQUENCE_RULE,
        "Start over from the literal bounded source and the rejection evidence. If the source says the chair announced that a motion is now on the floor for discussion, use only the impersonal wording 'the motion was on the floor for discussion' or omit that status entirely. Never use 'placing', 'placed', 'brought', 'put', or 'moved' the item onto the floor for discussion, or another actor-attributing equivalent.",
        "Preserve only claims that survive the rejection evidence. If a clause is disputed, ambiguous, or requires a name, role, qualifier, or procedural label that is not unambiguous in this source window, omit that clause instead of guessing. A shorter summary is correct when it is fully grounded.",
        "Preserve the motion's explicit subject and moved/seconded record only when independently paired in this source window; keep any debate topic separate and do not import a disposition.",
        "When the source records a motion being moved and seconded but only says it is on the floor for discussion, describe it as 'a motion to [literal subject] was moved and seconded; no disposition was recorded' or omit the motion clause. Do not phrase the sentence as though the proposed subject itself happened, was removed, was approved, or was completed.",
        "If the bounded evidence or audit disputes the seconding phrase or contains a mover-name correction, omit 'seconded' rather than choosing a name or arguing with the audit. Keep only the literal source-supported motion introduction, or omit the motion clause if pairing remains uncertain.",
        "For this conservative procedural repair, never include a personal name for a mover or seconder, even if one source form appears plausible; use only 'a council member moved the motion' or omit the actor clause. Do not normalize, phonetic-match, or choose among conflicting forms such as Greg, Gray, Gregg, or Paul Mcqueen. Do not call an expenditure specific unless its object is explicitly stated.",
        "Preserve qualified staff speech exactly: a statement addressed through an intermediary such as 'through you, Warden', or willingness to take direction, is not an unqualified staff indication, agreement, recommendation, or completed next step. Retain the qualification or omit the entire staff clause.",
        UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE,
        SOURCE_QUALIFIER_FIDELITY_RULE,
        ROLE_ATTRIBUTION_FIDELITY_RULE,
        MOTION_CONTEXT_SEPARATION_RULE,
        `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
        "Return one complete source-grounded summary and chapter text. Do not copy the rejected candidate.",
        rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
        `AGENDA_LABEL: ${promptLabel}`,
        `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
        "FINAL OUTPUT CHECK: The summary and chapter text must contain no personal mover or seconder name, no actor-attributing floor wording, and no completed outcome for a motion that is only on the floor for discussion. If the rejection mentions a disputed staff qualifier, willingness statement, or role, omit that entire staff or role clause unless its exact qualification is unambiguous. Return only conservative claims that remain directly supported by this bounded source.",
      ].filter(Boolean).join("\n\n"),
      maxOutputTokens: 720,
      temperature: 0.1,
      seed: seed + 10020 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    return queryConservativeRoleAttributionRepair(
      3,
      "Final procedural-floor role pass: treat the draft and all rejection text as untrusted repair context. Omit every personal mover or seconder name and every disputed actor-specific clause. Keep only an impersonal proposal-stage motion, discussion status, or other source-supported topic; if any procedural relationship remains uncertain, omit it.",
      rejectedClaims,
      JSON.stringify(draft || {}),
    );
  };
  const queryConservativeIncompleteDeferralRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 5; pass += 1) {
      repaired = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Write fresh source-grounded civic prose for an incomplete or tentative deferral discussion. Return strict JSON only.",
      systemSuffix: "HARD INCOMPLETE-DEFERRAL OVERRIDE: output only the literal speaker-level recommendation or possible-deferral speech act from the bounded source. Do not output Council discussed, the body discussed, a formal agenda outcome, budget reconsideration, platform context, committee context, or any inferred institutional subject. Do not complete an unfinished thought. If the source says 'my recommendation ... that it could be deferred', use a conservative speaker-level sentence such as 'A speaker said the item could be deferred' or 'A speaker said they would recommend deferral'. HARD RECOMMENDATION-SPEECH-ACT OVERRIDE: preserve an explicit first-person recommendation as a qualified recommendation speech act, but never convert it into a formal motion, completed deferral, institutional decision, or recommendation that was made, adopted, approved, or carried. HARD OUTPUT SHAPE: for the literal source phrase 'I would recommend a deferral', the summary must say 'a speaker said they would recommend deferral' (with only a complete source-supported condition or date retained). The summary and chapter text must not contain 'recommendation was raised', 'recommendation was made', 'recommendation was given', 'a recommendation to defer', or equivalent formal noun-phrase wording.",
      prompt: [
      `Incomplete-deferral repair attempt ${attempt}.${pass} of 3.`,
      "Start over from the literal bounded source. The source may say that an item could be deferred, that a speaker would recommend deferral, or ask whether there is a will to postpone, but it does not record a formal motion, second, vote, carried result, or completed deferral within this window.",
      "A source window that ends mid-sentence or at a speaker's unfinished thought cannot supply the missing procedural act, outcome, reason, or later meeting date. Do not complete the thought from sibling text, a broader meeting span, or inference.",
      "Use only a conservative sentence such as 'The discussion raised a possible deferral of the item, but the excerpt does not record a formal motion or disposition.' when that wording is directly supported, or omit the deferral clause entirely. Never write 'a motion to defer was recorded', 'the item was deferred', 'the decision was deferred', 'the body agreed to postpone', or a specific future meeting date unless this bounded source explicitly records that completed act.",
      "If the bounded source literally says 'I would recommend a deferral' or otherwise records a speaker making that recommendation, prefer the exact qualified speech-act form 'a speaker said they would recommend deferral' and preserve every complete source qualifier, such as pending further information. 'A speaker recommended deferral' is also allowed only when it remains clearly a recommendation rather than a completed action; never write that the item was deferred. Use the possible-deferral form only when the source says a deferral could/may happen or asks about postponement without an explicit recommendation. Keep amendment/referral discussion in a separate clause or omit it.",
      "When this bounded source contains both amendment/referral discussion and an explicit deferral recommendation, keep them as separate speech acts: use 'a possible amendment was raised' or 'a speaker considered proposing an amendment' for the tentative amendment, then a separate 'a speaker said they would recommend deferral' clause with its literal qualifier. Never combine them into 'a possible deferral was raised'.",
      "Preserve the speaker's uncertainty and recommendation as speech acts, not institutional action. Do not name a speaker or role unless the same source line unambiguously pairs it with the statement.",
      pass > 1
        ? "The preceding repair still used formal recommendation wording or omitted the qualification. Discard it and use the exact conservative speech-act shape 'a speaker said they would recommend deferral' (or an equally literal qualified form), retaining a complete source date or condition only when the same bounded source supplies it. Do not write that a recommendation was raised, made, given, adopted, approved, carried, or agreed.": "",
      "Do not aggregate distinct speaker blocks into 'Council discussed', 'the body discussed', or another institutional discussion claim when the bounded source only records individual remarks. Preserve the literal speaker-level speech act or omit that surrounding topic. When the source says 'my recommendation ... could be deferred' and the excerpt ends before a formal motion or disposition, use a conservative form such as 'a speaker said the item could be deferred' or 'a speaker said they would recommend deferral', retaining any complete condition and omitting the unfinished continuation.",
      "Do not say that a recommendation was made to defer a decision, that a decision was deferred, or that the body discussed deferral unless the source explicitly supports that exact speech act. Keep a conditional recommendation separate from questions about the motion and from unrelated platform or committee discussion.",
      "The summary must omit every unrelated question, platform, budget, committee, or institutional-discussion clause. Use at most the one complete speaker-level deferral recommendation supported by the source; the chapter text must be a generic deferral-recommendation headline and must not add an inferred subject.",
      UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      TENTATIVE_SPEECH_ACT_FIDELITY_RULE,
      DEFERRAL_PROPOSAL_STATUS_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
      rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
      "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected candidate.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL OUTPUT CHECK: omit any formal deferral, motion, outcome, missing continuation, or future date that is not explicitly complete in this bounded source. Preserve an explicit speaker recommendation as a recommendation speech act and do not merge it with a separate amendment or referral. If both appear, output separate grammatical clauses and never the conflated phrase 'a possible deferral was raised'.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
      temperature: pass >= 3 ? 0 : 0.1,
      seed: seed + 10040 + attempt * 10 + pass,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      const repeatedFormalDeferral = /\b(?:recommendation\s+(?:to\s+[^.?!]{0,120}\s+)?(?:was\s+)?(?:raised|made|given)|made\s+a\s+recommendation|(?:recommendation|deferral)\s+(?:was\s+)?(?:adopted|approved|carried)|(?:council|committee|body|meeting)\s+(?:discussed|agreed|decided|recommended)|formal\s+(?:motion|recommendation))\b/iu.test(repairedText);
      if (!repeatedFormalDeferral) return repaired;
    }
    return repaired;
  };
  const queryConservativeIncompleteProposalRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write fresh source-grounded civic prose for an incomplete or tentative amendment/proposal. Return strict JSON only.",
    prompt: [
      `Incomplete-proposal repair attempt ${attempt} of 3.`,
      "Start over from the literal bounded source. The source may record a speaker wondering whether an amendment could be made or proposing a referral, but the supplied window may end before the amendment's object, formal motion, second, vote, or disposition is complete.",
      "When the source ends mid-sentence or the audit says an object is not explicitly supported, do not complete the missing referral target, committee, audience, reason, outcome, or other noun phrase from sibling text, later context, or inference.",
      "Use only a conservative sentence such as 'A possible amendment was raised or discussed, but the excerpt does not complete its object or record a formal disposition.' when supported, or omit the incomplete amendment entirely. Do not call it a motion to amend, moved, seconded, carried, approved, or completed unless the bounded source explicitly records that act.",
      "For an incomplete amendment, do not include any object, referral target, committee, audience, reason, or continuation from the unfinished phrase. The only safe form is an object-free statement that a possible or proposed amendment was raised/discussed and that no formal disposition is recorded, or omission of the amendment entirely. Do not use 'suggested amending' when that wording would promote the unfinished question into a completed proposal.",
      "Preserve the tentative speech act and omit any unfinished object. Do not name a speaker or role unless the same source line unambiguously pairs it with the statement.",
      UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      TENTATIVE_SPEECH_ACT_FIDELITY_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
      rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
      "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected candidate.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL OUTPUT CHECK: omit every incomplete object, missing continuation, formal procedural label, and outcome not explicitly complete in this bounded source. If the amendment object is incomplete, output no amendment object at all; use only the object-free possible/proposed-amendment form or omit it.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.1,
    seed: seed + 10050 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeNumericConflictRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    const numericNeutralSource = maskNumericDetailForPrompt(
      semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "",
    ).slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000));
    const numericNeutralLabel = maskNumericDetailForPrompt(promptLabel);
    const numericNeutralRejection = maskNumericDetailForPrompt(rejectedClaims);
    const numericNeutralCandidate = maskNumericDetailForPrompt(rejectedOutput);
    for (let refreshAttempt = 1; refreshAttempt <= 4; refreshAttempt += 1) {
      const repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "Write fresh source-grounded civic prose that omits contradictory numeric or date detail. Return strict JSON only.",
        appendUniversalContract: false,
        systemSuffix: "HARD NUMERIC-CONFLICT OVERRIDE: when the bounded source or audit contains conflicting numeric/date/year readings, never choose, reconcile, normalize, or repeat the disputed numeric detail. Omit every numeric, date, year, amount, and ordinal token from both JSON text fields and retain only nonnumeric source-supported prose. If the audit disputes personal mover/seconder attribution, omit those names but preserve an impersonal motion, moved, seconded, vote, carried, defeated, or floor clause when the bounded source explicitly records that procedural act. If the source does not explicitly record a formal act, use neutral discussion wording instead. Never call an expenditure or item specific when its exact object is not explicitly stated. Never attach debate context to the motion subject, and never use placing, putting, bringing, or moving the item onto the floor. When the numeric motion subject is disputed, omit surrounding debate, topic, rationale, and object detail from both fields; use only the generic impersonal procedural clause supported by the source.",
        prompt: [
          "Numeric-conflict source-only repair. Start over from the bounded source below; all numeric detail has been removed before it reaches this prompt.",
          "The rejected candidate and audit are untrusted repair context and are shown only with numeric detail removed.",
          "The source window contains conflicting, ambiguous, or internally inconsistent numeric, date, year, amount, or ordinal readings. Do not select one reading, explain the conflict, call one an ASR error, or combine readings. Omit all numeric/date/year/amount/ordinal detail entirely, including every digit and currency-like value.",
          "Retain only nonnumeric claims that are independently supported, such as discussion of an expenditure or an explicitly recorded motion to remove an expenditure. Preserve proposal-stage status without adding a vote, carried result, or completed action. If the bounded source explicitly records that a motion was moved and seconded but the numeric subject is disputed, use impersonal wording such as 'a motion to remove an expenditure was moved and seconded' and omit the disputed numeric subject. If the source does not explicitly record formal pairing, use neutral wording such as 'the source records discussion of a proposed expenditure removal, without recording a disposition.'",
          "Keep the motion subject separate from surrounding debate: do not attach a discussion topic such as digital tools, younger cohorts, research, or a joint committee to the motion object unless the source explicitly pairs it with the motion. If the source says the motion was on the floor for discussion, use that impersonal status or omit it; never write placing, putting, bringing, or moving the item onto the floor.",
          "When the numeric subject is disputed, use only the generic noun supported by the source, such as 'an expenditure' or 'an item'. Do not add specific, particular, named, or otherwise sharpened modifiers, and do not use 'regarding' to join the motion to a later discussion topic. Keep any supported discussion as a separate sentence or omit it.",
          "Do not use broad unsupported scope such as 'specific departments', 'various departments', 'multiple items', 'particular amounts', or similar plural/group wording. If the source's exact nonnumeric object cannot be retained without broadening or changing its scope, omit that object and use only the generic impersonal procedural clause.",
          "For this repair, omit surrounding debate entirely rather than risking a subject merge. The summary may contain only the source-supported generic motion and procedural status, such as 'A motion was moved and seconded to remove an expenditure; the motion was on the floor for discussion.' The chapter text must be an equally generic headline and must not mention digital tools, younger cohorts, research, a committee, a rationale, or any disputed numeric detail.",
          "An authoritative agenda label may identify the current item, but it does not resolve contradictory transcript numbers for a generated action. The agenda label is also masked here; do not restore any masked year, amount, date, or code in generated prose.",
          "Do not include mover or seconder names, and omit disputed procedural details rather than choosing among source variants. Keep conditional or future discussion conditional.",
          MOTION_CONTEXT_SEPARATION_RULE,
          SOURCE_QUALIFIER_FIDELITY_RULE,
          refreshAttempt === 1
            ? `REJECTION_REASON: ${numericNeutralRejection.trim() || "(none supplied; write conservatively)"}`
            : "Fresh retry: discard every prior candidate and audit phrase and regenerate from the numeric-neutral source only.",
          refreshAttempt === 1 && numericNeutralCandidate ? `REJECTED_CANDIDATE: ${numericNeutralCandidate.slice(0, 3200)}` : "",
          "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected candidate or audit prose.",
          `AGENDA_LABEL: ${numericNeutralLabel}`,
          `GROUNDED_SOURCE_WITH_NUMERIC_DETAIL_MASKED: ${numericNeutralSource}`,
          "FINAL OUTPUT CHECK: no digits, numeric words tied to disputed readings, currency, dates, years, ordinals, ASR diagnosis, invented reconciliation, disputed formal motion wording, conflicting actor name, completed outcome, or audit fragments.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 10055 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!/\d/iu.test(repairedText)
        && !/\b(?:19|20)\d{2}\b/iu.test(repairedText)
        && !NUMERIC_CONFLICT_OVERBROAD_SCOPE_PATTERN.test(repairedText)) return repaired;
    }
    throw new Error(`stage3 retryable: numeric-conflict repair returned disputed numeric detail for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
  };
  const queryConservativeNumericSpecificityRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    const sourceWithNumericDetail = String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "")
      .slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000));
    for (let refreshAttempt = 1; refreshAttempt <= 4; refreshAttempt += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose that preserves explicit numeric detail without overstating or inventing it. Return strict JSON only.",
        systemSuffix: "HARD EXPLICIT-NUMERIC-SPECIFICITY OVERRIDE: the audit says the source explicitly supplies a numeric amount, date, year, or quantity that the candidate incorrectly called unspecified, unknown, or not provided. Do not describe that supported detail as unspecified, unknown, unclear, or not given. Either preserve the exact source-supported value in Arabic digits or omit the numeric claim entirely; never invent, calculate, reconcile, or replace it with another value. Do not mention this audit or repair contract in either output field.",
        prompt: [
          `Explicit-numeric-specificity repair attempt ${refreshAttempt} after grounding attempt ${attempt}.`,
          "Discard the rejected candidate and rebuild from GROUNDED_SOURCE only.",
          "The source contains explicit numeric detail, while the rejected candidate incorrectly labels one or more supported amounts, dates, years, or quantities as unspecified or unknown. Preserve the exact value when the source pairing is clear, using Arabic digits, or omit that numeric claim while retaining the surrounding source-supported topic. Never call a source-supported value unspecified, unknown, unclear, or not given.",
          "Do not infer or calculate any value from nearby figures. Keep separate amounts attached to their source-supported subjects, and keep separate questions, responses, and report details as separate clauses. Do not merge a generic question or response with a financial figure unless the source explicitly pairs them.",
          SOURCE_QUALIFIER_FIDELITY_RULE,
          UNIVERSAL_BOUNDED_SOURCE_PROSE_RULE,
          refreshAttempt === 1
            ? `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`
            : "Fresh retry: discard every prior candidate and audit wording; regenerate from the literal source only.",
          refreshAttempt === 1 && rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
          "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected candidate, audit prose, or words such as unspecified or unknown.",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${sourceWithNumericDetail}`,
          "FINAL OUTPUT CHECK: every retained amount, date, year, and quantity must be copied from its explicit source pairing in Arabic digits; otherwise omit it. Do not output unspecified, unknown, unclear, or not given for a detail explicitly present in GROUNDED_SOURCE.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 10065 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!/\b(?:unspecified|unknown|unclear|not\s+(?:specified|given|provided))\b/iu.test(repairedText)) return repaired;
    }
    throw new Error(`stage3 retryable: numeric-specificity repair retained an unsupported unspecified claim for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
  };
  const queryUnsupportedSecondingRepair = async (attempt = 1) => {
    let repaired = null;
    for (let refreshAttempt = 1; refreshAttempt <= 4; refreshAttempt += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose from the bounded source. Return strict JSON only.",
        systemSuffix: "HARD OPTIONAL-PROCEDURE-DETAIL OVERRIDE: include only the explicit mover or action and explicit vote or disposition. Omit every optional participant, supporter, or procedural-partner detail that is not literally stated in the bounded source. Use impersonal wording when the participant detail is not explicit.",
        prompt: [
          `Source-only procedural repair attempt ${refreshAttempt} after grounding attempt ${attempt}.`,
          "Discard all prior prose, audit wording, and participant details. Regenerate from GROUNDED_SOURCE only.",
          "Preserve the source's exact motion subject, action, scope, vote, and carried or defeated outcome when explicit. Do not add any optional participant detail, even if a generic civic summary would normally include it.",
          "If a formal procedural detail is not explicit in GROUNDED_SOURCE, omit that detail rather than guessing. Return one complete non-empty summary and chapter text.",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one JSON object with summary, chapter text, confidence, and notes. Do not copy audit fragments or rejected wording.",
        ].join("\n\n"),
        maxOutputTokens: 620,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 13060 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!/\b(?:seconded|seconder)\b/iu.test(repairedText)) return repaired;
    }
    return repaired;
  };
  const queryUnsupportedDeferralSubjectRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let refreshAttempt = 1; refreshAttempt <= 4; refreshAttempt += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose for an explicit postponement motion. Return strict JSON only.",
        systemSuffix: "HARD DEFERRAL-OBJECT OVERRIDE: preserve only the explicit procedural object and disposition stated in the bounded source. Keep the postponed action or matter distinct from the surrounding conversation about it. Do not substitute a discussion, meeting, or topic for the source-stated postponed matter. When the source first identifies a main motion and then records a separate motion to defer or refer that main motion, attach the moved, seconded, carried, or defeated outcome to the deferral/referral motion, not to the underlying action described by the main motion. If that separate deferral/referral motion is explicitly carried or passed in this source window, state that the deferral/referral motion was carried or passed; do not omit its disposition and do not say the underlying main motion was carried. When the main motion's subject is disputed or would be imported into the deferral motion, omit that underlying subject entirely and use only the generic deferral/referral object. Omit every condition, destination, pending-information phrase, meeting reference, and nearby debate topic; do not attach any qualifier to the carried motion. Never write that the matter or item itself was deferred; write only that the deferral/referral motion was carried or passed. In this repair, the generated summary and chapter text must not contain the underlying removal subject, the word budget, the connector regarding, floor-status wording, or any personal mover/seconder name or role; use only impersonal generic deferral motion wording and its carried disposition.",
        prompt: [
          `Source-only deferral-object repair attempt ${refreshAttempt} after grounding attempt ${attempt}.`,
          "Discard all prior prose, audit wording, and inferred subject framing. Regenerate from GROUNDED_SOURCE only.",
          "If the source explicitly states a motion to postpone an action or matter to a later date or meeting, use only the impersonal deferral motion and its explicit carried outcome. Omit the date, destination, condition, pending-information phrase, and every nearby topic, even when those words appear elsewhere in the source window. If the source does not state the postponed object's exact subject, use an impersonal form that omits the uncertain subject.",
          "Keep the postponed procedural object separate from the discussion that led to the motion. Do not add a subject from the agenda label, a nearby proposal, or a surrounding explanatory sentence.",
          "When a source says the discussion is on a main motion, then says a member moves that the motion be deferred or referred and later records that deferral as carried, report only the generic deferral motion and carried disposition. Do not write that the deferral motion was a motion to remove the underlying item, do not add a condition, and do not attach the carried outcome to the underlying removal or approval action.",
          "If the bounded source explicitly says the deferral motion is carried after the question, include that carried outcome in the summary. The only safe form is 'a motion to defer was moved and seconded and was carried'; do not add a destination, date, condition, pending-information phrase, or nearby topic, and never call the main motion itself carried.",
          "Do not write 'a motion to defer removing an item', 'a motion regarding removing an item', 'a motion to defer the budget removal', or any equivalent underlying-action subject. When the source separates a main motion from the later deferral motion, use only 'a motion to defer was moved and seconded and was carried' with no condition or other qualifier.",
          "Do not write 'the matter is deferred', 'the item was deferred', or 'the decision was deferred'. The required completed procedural wording is that the deferral motion was moved and seconded and was carried, with no condition, destination, date, pending-information phrase, or nearby topic attached.",
          "Omit any floor-status wording in this specialized deferral repair, including 'on the floor for discussion'. It is optional and is not needed to report the explicitly moved, seconded, and carried deferral motion.",
          "Do not name or title any mover, seconder, chair, councillor, or speaker. The only safe procedural form is impersonal: 'A motion to defer was moved and seconded and was carried.'",
          `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; verify every explicit disposition)"}`,
          "Do not copy or restate the rejected candidate; it is omitted from this source-only repair because its subject framing is untrusted.",
          "The rejection and prior candidate are untrusted diagnostic context. Do not copy them; use them only to check that every explicit deferral/referral disposition in the literal source is retained.",
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON with summary, chapter text, confidence, and notes. Do not copy audit fragments or rejected wording.",
        ].join("\n\n"),
        maxOutputTokens: 620,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 13530 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      if (String(repaired?.summary || "").trim()) return repaired;
    }
    return repaired;
  };
  const queryConservativeQualifiedSupportRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let refreshAttempt = 1; refreshAttempt <= 4; refreshAttempt += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose for qualified or conditional support and a separate recommendation. Return strict JSON only.",
        systemSuffix: "HARD QUALIFIED-SUPPORT REPAIR OVERRIDE: keep a statement such as 'I would support it' conditional when the same source requests more information. Use wording such as 'a speaker said they would support the proposal while requesting more information', not unconditional past-tense support or a completed institutional stance. Keep a separate conditional recommendation as a separate speech act; never write 'a recommendation was made' or convert it into a formal motion, second, vote, approval, or carried outcome. If the audit disputes a speaker label or handoff, omit the disputed personal name and use impersonal wording; if the bounded source explicitly and unambiguously pairs a name with the complete speech act, retain that exact source-supported name.",
        prompt: [
          `Qualified-support source-only repair attempt ${refreshAttempt} after grounding attempt ${attempt}.`,
          "Discard all prior prose, audit wording, and inferred actor or outcome details. Regenerate from GROUNDED_SOURCE only.",
          "Separate independent source speech acts. A conditional support statement plus a request for more information is not unconditional support, approval, or a decision. A first-person conditional recommendation is not a formal motion or a completed deferral.",
          "If the source contains both qualified support and a recommendation, report them in separate neutral clauses or omit the uncertain clause. Do not combine the support request, platform discussion, and recommendation into one completed institutional action.",
          "When speaker labels conflict, are handoffs, or are not explicitly paired with the complete claim, omit personal names rather than selecting or normalizing one. Preserve the qualified speech act without a named actor.",
          refreshAttempt === 1
            ? `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`
            : "This is a fresh source-only retry. Do not copy any prior recommendation wording, audit wording, or candidate phrasing.",
          refreshAttempt === 1 && rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy rejected wording or audit fragments. Do not use 'supported' as a completed past-tense action when the source says 'would support'.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 13570 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!/\b(?:a|the|separate)\s+recommendation\s+was\s+made\b/iu.test(repairedText)
        && !/\b(?:supported|expressed\s+support)\b[\s\S]{0,100}\b(?:contingent|pending|more\s+information)\b/iu.test(repairedText)) {
        return repaired;
      }
    }
    return repaired;
  };
  const queryConservativeSourceTopicRelationshipRepair = async (attempt = 1, rejectedClaims = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write fresh source-grounded civic prose that keeps separately stated source topics separate. Return strict JSON only.",
        systemSuffix: [
          "HARD SOURCE-TOPIC-RELATIONSHIP OVERRIDE: the independent audit found that the prior output attached a recommendation or proposal to a nearby source phrase that the literal source does not explicitly pair with it.",
          "HARD SOURCE-TOPIC-PAIRING BAN: do not write 'recommendation to ...' or 'proposal to ...' for the disputed action or topic in either JSON text field. State the source's recommendation or proposal as one neutral fact and the nearby merit, possibility, exploration, or topic as a separate neutral fact, or omit the nearby fact.",
          SOURCE_TOPIC_RELATIONSHIP_RULE,
          SOURCE_QUALIFIER_FIDELITY_RULE,
          pass > 1
            ? "The preceding draft repeated the disputed direct pairing. Discard it completely and regenerate from the literal source with two separate clauses or conservative omission."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Source-topic relationship repair attempt ${attempt}.${pass} of 3.`,
          "Start over from GROUNDED_SOURCE only. The rejection is diagnostic context, not source evidence; do not copy rejected prose.",
          "Preserve the source's complete chronology and topic coverage, but do not merge a recommendation, proposal, action, or subject with a nearby phrase unless the same source wording explicitly pairs them. A safe structure is: 'The source records the matter as a recommendation. It separately notes merit in exploring the platform.' Use the literal source nouns and omit any disputed object rather than attaching it.",
          `INDEPENDENT_AUDIT_REJECTION: ${String(rejectedClaims || "").slice(0, 3200)}`,
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not include audit language or the rejected direct pairing.",
        ].join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 13780 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      if (!sourceTopicRelationshipConstructionDefect(repairedText)) return repaired;
    }
    return repaired;
  };
  const queryConservativeCausalRelationshipRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    const sourceTopicRepairActive = sourceTopicRelationshipGroundingDefect(`${rejectedClaims} ${rejectedOutput}`);
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "Write fresh source-grounded civic prose that keeps a proposal separate from nearby benefits and consequences. Return strict JSON only.",
        appendUniversalContract: false,
        systemSuffix: [
          "HARD CAUSAL-SEPARATION OVERRIDE: the independent audit rejected a causal or purpose relationship in the prior output. Do not repeat or paraphrase that relationship.",
          "HARD SOURCE-TOPIC-RELATIONSHIP OVERRIDE: if the audit says a recommendation, proposal, action, subject, or qualifier is not explicitly paired with a nearby source phrase, keep those source facts in separate neutral clauses or omit the disputed attachment. Do not turn a separately stated merit, possibility, or topic into the recommendation's object merely because the wording is adjacent.",
          CAUSAL_RELATIONSHIP_AUDIT_RULE,
          "When a proposal, business case, recommendation, request, or solution and a benefit or consequence occur in the same bounded source, first state the proposal or case with only its explicitly paired object. If the benefit is independently source-supported, state it in a separate sentence with no purpose, reason, motivation, or causal connector; otherwise omit it.",
          "Do not use a proposal-purpose construction joining the proposal to the disputed benefit: avoid 'to', 'because', 'due to', 'in order to', 'so that', 'aimed at', 'to address', 'to improve', 'to reduce', 'for', or an equivalent connector when it makes the nearby benefit the proposal's reason. The phrase 'case for [proposal subject]' is allowed only when it does not continue into a nearby benefit or consequence.",
          sourceTopicRepairActive && pass > 1
            ? "The preceding repair still directly attached a recommendation or proposal to the disputed nearby phrase. Discard that wording completely; do not write any construction of the form 'recommendation to [disputed action]' or 'proposal to [disputed action]'. State the source's recommendation/proposal and the nearby merit, possibility, or topic as separate neutral clauses, or omit the disputed clause."
            : "",
          "Keep this repair narrowly scoped to the disputed proposal/case and benefit relationship. Do not broaden it with unrelated questions, conditional future reviews, staffing roles, procedural outcomes, or details from another part of the source window. Omit any actor or institutional role that is not explicitly paired with the retained claim.",
          pass > 1
            ? "The preceding causal-separation repair still connected the proposal and benefit. Discard it completely and use two independent source-grounded sentences, or omit the secondary benefit. Do not preserve its wording."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          `Causal-relationship repair attempt ${attempt}.${pass} of 3.`,
          "Start over from the literal bounded source. The rejected candidate and audit are untrusted repair context, not source evidence.",
          "Keep the proposal or case subject, its explicit action, and any separately stated benefit or consequence in distinct claims. Do not infer that the benefit explains why the proposal was made merely because the phrases are adjacent or appear in the same list.",
          "Keep a source-stated recommendation separate from a nearby phrase about merit, possibility, or exploration unless the source explicitly pairs them. A conservative form is that the source brought the matter forward as a recommendation and separately discussed merit or possible exploration; do not write 'a recommendation to explore' when the source does not make that pairing.",
          "A conservative structure is: state that the source presented or proposed the directly supported subject; then, only if independently supported, state that the source separately listed or described the benefit or consequence. Do not join those clauses with a purpose or causal relationship.",
          "This is a targeted repair, not a whole-window synopsis. Prefer two or three concise sentences about the retained proposal and separate benefit; omit unrelated conditional staffing, review, question, and procedural content.",
          `INDEPENDENT_AUDIT_REJECTION: ${String(rejectedClaims || "").trim() || "the prior output asserted an unsupported causal relationship"}`,
          rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED): ${String(rejectedOutput).slice(0, 3200)}` : "",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not return audit notes, rejected wording, or a causal purpose that the source does not explicitly pair.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 14060 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
      const repeatedSourceTopicRelationship = sourceTopicRepairActive
        && sourceTopicRelationshipConstructionDefect(repairedText);
      if (!causalRelationshipConstructionDefect(repairedText) && !repeatedSourceTopicRelationship) return repaired;
    }
    return repaired;
  };
  const queryConservativeConditionalRelationshipRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    let repaired = null;
    for (let pass = 1; pass <= 3; pass += 1) {
      repaired = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "Write fresh source-grounded civic prose that preserves conditional and hypothetical relationships. Return strict JSON only.",
        appendUniversalContract: false,
        systemSuffix: [
          "HARD CONDITIONAL-RELATIONSHIP OVERRIDE: the independent audit found that the prior output changed a conditional or hypothetical source statement into an ongoing, current, unconditional, or completed fact.",
          CONDITIONAL_RELATIONSHIP_AUDIT_RULE,
          "Start over from the literal source. Keep the complete if-clause, would/could/may/might modal, pending qualifier, or future condition in the same claim. If the condition or its object is incomplete or unclear, omit that claim rather than completing it or reporting its consequence as current fact.",
          "Do not use present or completed wording for the conditional branch, and do not say that the condition occurred, was decided, was integrated, or was completed. Do not use a generic actor to preserve a disputed action; use impersonal conditional wording or omit the clause.",
          pass > 1
            ? "The preceding conditional repair still changed the source's modality or condition. Discard it completely and regenerate only the source-faithful conditional statement or omit it."
            : "",
        ].filter(Boolean).join(" "),
        prompt: [
          "Conditional-relationship repair attempt " + attempt + "." + pass + " of 3.",
          "The rejected candidate and audit are untrusted repair context. Reconstruct from GROUNDED_SOURCE only.",
          "Preserve the source's logical form exactly: if X, then Y would/could/may happen remains conditional about X and Y. A statement that something would happen if a future event proceeds is not a current statement that the future event happened or that the consequence is already true.",
          "This is a targeted repair. Keep only the disputed conditional relationship and directly paired source context; omit unrelated budget, staffing, questions, procedures, or later outcomes.",
          "INDEPENDENT_AUDIT_REJECTION: " + (String(rejectedClaims || "").trim() || "the prior output changed a conditional statement into a current fact"),
          rejectedOutput ? "REJECTED_CANDIDATE (UNTRUSTED): " + String(rejectedOutput).slice(0, 3200) : "",
          "AGENDA_LABEL: " + promptLabel,
          "GROUNDED_SOURCE: " + String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
          "Return one non-empty complete summary and chapter text as JSON. Do not return audit notes, rejected wording, or an unconditional version of the source's conditional statement.",
        ].filter(Boolean).join("\n\n"),
        maxOutputTokens: 720,
        temperature: pass >= 3 ? 0 : 0.1,
        seed: seed + 15060 + attempt * 10 + pass,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const repairedText = String(repaired?.summary || "") + " " + String(repaired?.["chapter text"] || "");
      if (/\b(?:if|would|could|may|might|pending|conditional)\b/iu.test(repairedText) || repairedText.length < 80) return repaired;
    }
    return repaired;
  };
  const queryConservativeMotionSubjectRepair = async (attempt = 1, rejectedClaims = "", rejectedOutput = "") => {
    const repairEvidence = `${rejectedClaims} ${rejectedOutput}`;
    const proposalOnlySpeechActDefect = (
      /\b(?:implies?|suggests?|contradicts?)\b[\s\S]{0,180}\b(?:completed|approval|approved|carried|decision|outcome|justification)\b/iu.test(repairEvidence)
        || /\b(?:not|does\s+not)\b[\s\S]{0,160}\b(?:completed|approval|approved|justification)\b/iu.test(repairEvidence)
        || /\b(?:not|does\s+not)\s+record(?:ed)?\b[\s\S]{0,160}\b(?:motion|outcome)\b/iu.test(repairEvidence)
    ) && /\b(?:proposal|proposed|question|discussion|not\s+(?:recorded|approved)|only)\b/iu.test(repairEvidence);
    const procedureOnlyGroundingDefect = /\b(?:does\s+not\s+record|no\s+(?:explicit\s+)?(?:second|vote|disposition)|only\s+(?:states?|says?)\b.{0,80}\bfloor\s+for\s+discussion|not\s+(?:a\s+)?formal|formal\s+(?:pairing|procedural)|put\s+to\s+a\s+vote)\b/iu.test(repairEvidence)
      || (/\b(?:implies?|suggests?|contradicts?)\b[\s\S]{0,180}\b(?:completed|approval|approved|carried|decision|outcome|justification)\b/iu.test(repairEvidence)
        && /\b(?:proposal|proposed|question|discussion|not\s+(?:recorded|approved)|only)\b/iu.test(repairEvidence));
    const futureExpectationDefect = /\b(?:expect(?:ed|s|ation)?|next\s+report|future\s+(?:content|action|step))\b/iu.test(repairEvidence)
      && /\b(?:rather\s+than|not|does\s+not|instead|unsupported)\b[\s\S]{0,220}\b(?:recommend(?:ation)?|motion|formally|propos(?:ed|al))\b/iu.test(repairEvidence);
    const sourceConditionalRecommendation = conditionalDeferralRecommendationSource(semanticGroundingSourceExcerpt)
      || (/\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt)
        && /\b(?:deferr|postpon|refer|recommend|action|matter)\w*/iu.test(semanticGroundingSourceExcerpt));
    const candidateUpgradesRecommendation = /\b(?:recommendation\s+was\s+made|made\s+a\s+recommendation|recommend(?:ed|ation)?\s+(?:was\s+)?(?:adopted|approved|carried)|recommend(?:ed|s)?\s+(?:a\s+)?(?:deferral|postponement|referral)|(?:motion|deferral)\s+(?:was\s+)?(?:made|carried|approved))\b/iu.test(repairEvidence);
    const candidateGenericRecommendation = /\b(?:a|the)\s+speaker\s+(?:recommended|would\s+recommend)\b/iu.test(repairEvidence);
    const recommendationSpeechActDefect = (
      /\b(?:would|could)\s+recommend\b/iu.test(repairEvidence)
        && /\b(?:does\s+not\s+imply|not\s+(?:a\s+)?formal|not\s+(?:a\s+)?(?:motion|second|carried|approved)|conditional|first[-\s]?person|speech\s+act)\b/iu.test(repairEvidence)
    ) || (sourceConditionalRecommendation && (candidateUpgradesRecommendation || candidateGenericRecommendation))
      || (/\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt)
        && /\b(?:recommendation|recommend(?:ed|s)?)\b/iu.test(repairEvidence));
    const tentativeMotionDefect = /\b(?:do\s+i\s+have\s+a\s+mover|asks?\s+for\s+a\s+mover|question(?:s|ed)?[\s\S]{0,40}\bmover\b|think(?:s)?\s+(?:she|he|they|i)\s+(?:will|might|may)\s+move|(?:will|might|may)\s+move|on\s+the\s+floor)\b/iu.test(repairEvidence)
      && /\b(?:does\s+not\s+(?:explicitly\s+)?record|does\s+not\s+(?:explicitly\s+)?state|only\s+records?|bounded\s+excerpt|truncat(?:ed|ion)|transcript\s+ends?|source\s+(?:text\s+)?ends?|ends?\s+(?:immediately|before)|before\s+(?:recording|an\s+explicit|a\s+formal)|end\s+of\s+(?:the\s+)?source\s+window|source\s+window)\b/iu.test(repairEvidence)
      && /\b(?:motion|moved|carried|seconded|disposition|mover)\b/iu.test(repairEvidence);
    const sourceExplicitlyRecordsSeconding = /\b(?:seconded|seconder)\b/iu.test(semanticGroundingSourceExcerpt);
    const candidateClaimsSecondingWithoutSource = /\b(?:seconded|seconder)\b/iu.test(rejectedOutput)
      && !sourceExplicitlyRecordsSeconding;
    const unsupportedSecondingDefect = (
      /\b(?:does\s+not|doesn't|never|no)\b[\s\S]{0,180}\b(?:seconded|seconder|second)\b/iu.test(repairEvidence)
        && /\b(?:seconded|seconder)\b/iu.test(repairEvidence)
    ) || candidateClaimsSecondingWithoutSource;
    const separateMotionOutcomeDefect = (
      /\b(?:separate|distinct|unrelated|different)\b[\s\S]{0,320}\b(?:motion|outcome|carried|disposition)\b/iu.test(repairEvidence)
      || /\b(?:motion|outcome|carried|disposition)\b[\s\S]{0,320}\b(?:separate|distinct|unrelated|different)\b/iu.test(repairEvidence)
    ) && /\b(?:no|not|does\s+not|incorrect(?:ly|)|wrong(?:ly)?|following|after|later|subsequent)\b/iu.test(repairEvidence);
    const causalRelationshipDefect = /\b(?:causal\s+link|causal(?:ity)?|reason|motivation|purpose|primary\s+(?:reason|motivation|case))\b/iu.test(repairEvidence)
      && /\b(?:not\s+(?:explicitly\s+)?stated|does\s+not\s+state|unsupported|implies?|inferred|incorrect(?:ly)?|not\s+the)\b/iu.test(repairEvidence);
    const roleFidelityGroundingDefect = /\b(?:attribut(?:e|ion)|speaker|actor|name|stated|expressed|recommended|claim)\b/iu.test(repairEvidence)
      && /\b(?:not\s+explicit|unsupported|does\s+not|conflict|inaccurate|embedded|standalone|source\s+records|not\s+the\s+speaker)\b/iu.test(repairEvidence);
    const repaired = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Write fresh source-grounded civic prose that separates a formal motion from procedural or debate context. Treat quoted phrases such as 'motion not on the floor' as discussion language, not as an identified motion. Return strict JSON only.",
      appendUniversalContract: false,
      systemSuffix: [
        "HARD MOTION-CONTEXT OVERRIDE: when the repair evidence disputes seconding or contains a mover-name correction, never output the words 'seconded' or 'seconder' in either JSON text field. Omit that optional detail and do not resolve the contradiction.",
        (procedureOnlyGroundingDefect || proposalOnlySpeechActDefect)
          ? "HARD PROCEDURAL-PAIRING OVERRIDE: the audit says this bounded span records only floor discussion or lacks an explicit second, vote, disposition, or formal pairing. In this repair never output the procedural words 'motion', 'moved', 'seconded', 'vote', 'carried', 'defeated', or 'floor'; use neutral discussion wording and omit the formal clause."
          : "",
        roleFidelityGroundingDefect
          ? "HARD ROLE-FIDELITY OVERRIDE: do not attribute an embedded phrase, procedural status, handoff, addressee, or conditional statement to a named speaker unless the same source block explicitly pairs that actor with the complete claim. If the audit disputes the actor, omit the actor-specific clause and retain only impersonal source-supported content; do not substitute a generic speaker. Preserve separate independent speech acts rather than combining them."
          : "",
        futureExpectationDefect
          ? "HARD FUTURE-EXPECTATION OVERRIDE: an expectation about what a future or next report should set out is not a recommendation, motion, formal proposal, or current decision. Preserve the expectation as future or conditional source language, or omit it; never attach a later generic carried phrase to that expectation."
          : "",
        recommendationSpeechActDefect
          ? "HARD RECOMMENDATION-SPEECH-ACT OVERRIDE: a first-person or conditional statement such as 'I would recommend a deferral' is a recommendation or suggestion, not proof that a formal motion was made, seconded, carried, or approved. Preserve recommendation wording as a source-recorded speech act; when GROUNDED_SOURCE explicitly pairs the recommendation with a named speaker, retain that exact source-supported name and role, and otherwise use impersonal wording such as 'the source records a recommendation'. Never write 'a recommendation was made', 'a separate recommendation was made', 'a recommendation was adopted', 'a recommendation was carried', or any other wording that upgrades the speech act to a completed formal action."
          : "",
        tentativeMotionDefect
          ? "HARD TENTATIVE-MOTION OVERRIDE: a question asking for a mover, a statement that someone thinks or will move an item, or an on-the-floor status without an explicit procedural announcement is not proof that a motion was moved, seconded, carried, or completed. Use neutral tentative discussion wording or omit the formal motion and outcome; never attach a generic carried phrase to it."
          : "",
        unsupportedSecondingDefect
          ? "HARD UNSUPPORTED-SECONDING OVERRIDE: the audit says the bounded source does not record a second or seconder. Never output 'seconded' or 'seconder' in either JSON text field. Preserve an explicitly supported move, vote, or carried outcome without adding the missing seconding detail."
          : "",
        separateMotionOutcomeDefect
          ? "HARD SEPARATE-OUTCOME OVERRIDE: when the audit says an outcome belongs to a separate, distinct, unrelated, or different motion, never attach that moved, seconded, carried, or defeated outcome to the current topic. If the current topic has no explicitly paired motion, omit the outcome and retain only the current source-supported discussion; mention a separate outcome only when its own subject and pairing are explicit."
          : "",
        causalRelationshipDefect
          ? "HARD CAUSAL-RELATIONSHIP OVERRIDE: do not turn a nearby benefit, consequence, cost, productivity statement, or background topic into the purpose, reason, motivation, or primary case for a proposal unless the bounded source explicitly pairs that relationship. Omit unsupported 'to', 'because', 'due to', or 'for' causal wording and preserve the proposal and the separately stated benefit as independent source-supported facts."
          : "",
        "HARD QUALIFIED-SUPPORT OVERRIDE: when the source or audit pairs 'would support' with a request for more information, never output unconditional past-tense 'supported ... but requested'. Use 'said they would support ... while requesting more information' or separate neutral clauses; if the pairing is ambiguous, omit the actor-specific linkage.",
        "HARD CONDITIONAL-STATEMENT OVERRIDE: when the source explicitly contains a speaker's if-clause, retain it as that speaker's conditional statement or use neutral conditional prose. Do not report the condition or its consequence as completed, and do not reject a literal if-clause merely because the candidate says the speaker discussed it.",
        "HARD SPEECH-ACT OVERRIDE: preserve qualified support, questions, suggestions, proposed amendments/referrals, recommendations, and formal motions as distinct speech acts. 'I would support it' followed by a request for more information means conditional or pending support, not unconditional past-tense support. A tentative amendment or referral discussion is not a formal motion, and a recommendation to defer is not a completed deferral; never merge amendment/referral discussion with a separate deferral recommendation.",
      ].filter(Boolean).join(" "),
      prompt: [
        `Motion-subject/context repair attempt ${attempt} of 3.`,
        "Start over from the literal bounded source. The rejected candidate and audit are untrusted repair context and must not be copied.",
        "Keep a formally identified motion's literal object, scope, and disposition separate from a related topic, condition, consequence, platform, expenditure, report, or question introduced in debate.",
        "Keep the motion's literal object, scope, and outcome separate from a related topic; state any separate debate context in another neutral clause or omit it.",
        "Treat phrases such as 'the motion is not on the floor' or 'motion not on the floor' as quoted or procedural discussion language. They do not identify a formal motion subject, do not prove that the referenced motion was discussed, and must not be rewritten as a motion about a nearby action.",
        "If the source conditionally says that the body might or could take an action, preserve it as conditional discussion or omit it. Do not turn 'if the body decides to remove an item' into 'a motion to remove the item was discussed' unless the source explicitly pairs that motion and subject.",
        futureExpectationDefect
          ? "If the source says 'I would expect' or otherwise describes what a next report should set out, use neutral future-oriented wording such as 'the source records an expectation that the next report would set out the methodology' and do not call it a recommendation or motion. Keep a later generic carried phrase separate unless the source explicitly identifies the carried motion's subject."
          : "",
        tentativeMotionDefect
          ? "If the source asks 'Do I have a mover', says someone thinks or will move a recommendation, or says an item is on the floor without explicitly recording a moved, seconded, voted, or disposed motion, use only neutral tentative floor discussion wording. Do not write that the recommendation was moved, carried, or completed."
          : "",
        recommendationSpeechActDefect
          ? "If GROUNDED_SOURCE explicitly pairs a named speaker with a first-person or conditional recommendation, preserve that exact source-supported speaker name and role while keeping the wording as 'said they would recommend' or 'recommended' only when that speech-act wording is source-supported. Do not replace an explicit pairing with 'a speaker', do not write 'a recommendation was made', and do not upgrade the recommendation to a formal motion, second, vote, approval, or carried outcome."
          : "",
        separateMotionOutcomeDefect
          ? "If the audit says a later carried motion is separate from the current discussion, do not combine them. Keep the current question, response, or report discussion without that outcome; do not infer a motion for the current topic from a generic later carry."
          : "",
        causalRelationshipDefect
          ? "If the source separately mentions a proposal and a benefit such as improved morale, reduced burnout, cost savings, or productivity, report the proposal without assigning that benefit as its purpose unless the source explicitly says so. Use parallel or separate neutral clauses, or omit the benefit; never write that the proposal was for, to, because of, or due to the nearby benefit when the audit disputes that relationship."
          : "",
        "Use only the source's literal action terms. Never replace remove, defer, return, bring back, or a possible future discussion with 'reconsider' or 'reconsidered' unless that exact procedural term appears in the bounded source.",
        "Do not strengthen a conditional future possibility into an unrestricted or completed action. If the source says 'if Council decides' or that a committee could discuss and bring suggestions back, retain the condition and possibility; never add 'without restriction' unless that exact qualification is source-supported.",
        "Keep information requests separate from the speech act they follow. Do not make a speaker's conditional support, question, or request for more information into a completed institutional recommendation or decision. If the source has multiple speakers or blocks, do not combine their statements into one speaker's action; omit the disputed linkage or use impersonal prose.",
        QUALIFIED_SUPPORT_SPEECH_ACT_RULE,
        CONDITIONAL_STATEMENT_FIDELITY_RULE,
        DEFERRAL_PROPOSAL_STATUS_RULE,
        "When the source says a speaker suggested referring an item to a joint committee and separately records a recommendation to defer the main matter, keep those as separate clauses or omit the uncertain clause. Do not call the referral a formal amendment or call the recommendation an adopted deferral.",
        "If the bounded source does not explicitly pair a motion with its subject and procedural act, omit the formal motion clause and retain only neutral source-supported procedural discussion. If it does explicitly record a moved, seconded, carried, or defeated motion, retain only that literal subject and outcome in impersonal wording.",
        "Do not include personal mover or seconder names when the audit reports conflicting forms. Do not output audit notes, extracted fragments, vertical bars, list markers, or repeated source labels.",
        "When the audit or source evidence disputes whether seconding is explicitly paired, or contains a mover-name correction, omit the word 'seconded' and all seconder metadata from this repair. Do not resolve that contradiction; conservative omission is correct even if a nearby announcement appears to mention a seconder.",
        ROLE_ATTRIBUTION_FIDELITY_RULE,
        SOURCE_TOPIC_RELATIONSHIP_RULE,
        SEPARATE_REMARKS_SCOPE_RULE,
        (procedureOnlyGroundingDefect || proposalOnlySpeechActDefect)
          ? "The audit identifies only procedural floor discussion without a complete formal pairing. Use neutral discussion wording and omit the formal motion clause entirely."
          : "",
        "Return ordinary grammatical prose, not audit notes or extracted fragments. Do not use vertical bars, pipe-separated fragments, list markers, or repeated source labels.",
        MOTION_CONTEXT_SEPARATION_RULE,
        SOURCE_QUALIFIER_FIDELITY_RULE,
        `REJECTION_REASON: ${String(rejectedClaims || "").trim() || "(none supplied; write conservatively)"}`,
        rejectedOutput ? `REJECTED_CANDIDATE: ${String(rejectedOutput).slice(0, 3200)}` : "",
        "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected candidate.",
        `AGENDA_LABEL: ${promptLabel}`,
        `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
        "FINAL OUTPUT CHECK: no formal motion clause unless the bounded source explicitly pairs the motion with its subject and procedural act; no conversion of 'motion not on the floor' into a substantive motion; no conditional action rewritten as completed discussion or decision; no 'seconded' or 'seconder' wording when the audit raises a pairing or name correction; no conflicting personal mover or seconder name; no audit-style fragments.",
      ].filter(Boolean).join("\n\n"),
      maxOutputTokens: 720,
      temperature: attempt >= 3 ? 0 : 0.1,
      seed: seed + 10060 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
    const tentativeCompletedProcedure = /\b(?:moved|carried|seconded|defeated|approved|adopted|voted)\b/iu.test(repairedText)
      || /\b(?:motion\s+(?:was|is|has\s+been)\s+(?:proposed|introduced)|(?:proposed|introduced)\s+motion|formally\s+(?:proposed|introduced))\b/iu.test(repairedText);
    const repeatedUnsupportedSeconding = unsupportedSecondingDefect && /\b(?:seconded|seconder)\b/iu.test(repairedText);
    if ((!tentativeMotionDefect || !tentativeCompletedProcedure) && !repeatedUnsupportedSeconding) return repaired;
    const strictRepair = await callOllamaJson({
      ollamaUrl,
      llmModel,
      appendUniversalContract: false,
      system: "Write one neutral source-grounded civic summary for an incomplete procedural exchange. Return strict JSON only.",
      systemSuffix: tentativeMotionDefect
        ? "HARD TENTATIVE-PROCEDURE OUTPUT BAN: the bounded source ends before a formal motion, second, vote, or disposition, or explicitly says the described motion is not on the floor. Both summary and chapter text must omit the words moved, carried, seconded, defeated, approved, adopted, voted, proposed motion, and introduced motion. Do not use motion or recommendation as a completed procedural action. Preserve only the source-supported recommendation/topic and tentative discussion, or omit the procedural clause entirely. This is an LLM rewrite requirement, not a request to copy the rejected draft."
        : "HARD UNSUPPORTED-SECONDING OUTPUT BAN: the bounded source supports the motion and its outcome but does not record a second or seconder. Both summary and chapter text must omit the words seconded and seconder. Preserve the explicitly supported move and carried or vote outcome without inventing a seconding detail. This is an LLM rewrite requirement, not a request to copy the rejected draft.",
      prompt: [
        `Fresh tentative-procedure repair attempt ${attempt} of 3.`,
        "The previous repair still asserted a completed procedural act. Discard it completely and regenerate from the bounded source below.",
        tentativeMotionDefect
          ? "The source asks for a mover or records that someone may or will move an item, then ends before an explicit formal motion, second, vote, or disposition. Write only neutral discussion prose such as an expectation, recommendation for consideration, or tentative floor discussion without a completed procedural act; if that cannot be stated safely, omit the procedural clause and summarize only the source-supported topic."
          : "The source explicitly records a move and outcome but does not record a second or seconder. Preserve the move and outcome in neutral wording and omit all seconding language.",
        `INDEPENDENT_AUDIT_REJECTION: ${String(rejectedClaims || "").trim() || "the source ends before a formal procedural act"}`,
        `AGENDA_LABEL: ${promptLabel}`,
        `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
        "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected wording or audit fragments.",
      ].join("\n\n"),
      maxOutputTokens: 520,
      temperature: 0.1,
      seed: seed + 11060 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    const strictRepairText = `${String(strictRepair?.summary || "")} ${String(strictRepair?.["chapter text"] || "")}`;
    // The strict rewrite is a fresh model response and can reintroduce the
    // rejected term even when the first conservative repair omitted it.
    // Guard the response being returned, not only the response that led to
    // this strict pass.
    const strictTentativeProcedure = tentativeMotionDefect && (
      /\b(?:moved|carried|seconded|defeated|approved|adopted|voted)\b/iu.test(strictRepairText)
        || /\b(?:motion\s+(?:was|is|has\s+been)\s+(?:proposed|introduced)|(?:proposed|introduced)\s+motion|formally\s+(?:proposed|introduced))\b/iu.test(strictRepairText)
    );
    const strictUnsupportedSeconding = unsupportedSecondingDefect && /\b(?:seconded|seconder)\b/iu.test(strictRepairText);
    if (!strictTentativeProcedure && !strictUnsupportedSeconding) return strictRepair;
    let refreshed = strictRepair;
    for (let refreshAttempt = 1; refreshAttempt <= 3; refreshAttempt += 1) {
      refreshed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: tentativeMotionDefect
          ? "Write one neutral source-grounded civic summary without an unsupported formal motion. Return strict JSON only."
          : "Write one source-grounded civic summary with no unsupported seconding. Return strict JSON only.",
        systemSuffix: tentativeMotionDefect
          ? "HARD TENTATIVE-PROCEDURE OUTPUT BAN: the bounded source ends before a formal motion, second, vote, or disposition, or explicitly says the described motion is not on the floor. Omit moved, carried, seconded, defeated, approved, adopted, voted, proposed motion, and introduced motion from both JSON text fields. Preserve only neutral source-supported discussion or recommendation-for-consideration wording."
          : "HARD UNSUPPORTED-SECONDING OUTPUT BAN: the bounded source supports the motion and its outcome but does not record a second or seconder. Omit the words seconded and seconder from both JSON text fields. Preserve only the source-supported motion, vote, or carried outcome.",
        prompt: [
          `Fresh ${tentativeMotionDefect ? "tentative-procedure" : "unsupported-seconding"} repair attempt ${refreshAttempt} of 3.`,
          "Discard the prior repair completely and regenerate from GROUNDED_SOURCE only.",
          tentativeMotionDefect
            ? "The source does not establish a completed formal motion. If it describes what a motion not on the floor would do, report only the underlying discussion or conditional topic without calling it a proposed, introduced, moved, seconded, or carried motion."
            : "Use only the mover/action and explicit vote or carried outcome that appear in GROUNDED_SOURCE. Omit any optional participant detail that is not stated in the source, and preserve the supported motion without adding procedural detail.",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete source-grounded summary and chapter text. Do not copy rejected wording or audit fragments.",
        ].join("\n\n"),
        maxOutputTokens: 620,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 12060 + attempt + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const refreshedText = `${String(refreshed?.summary || "")} ${String(refreshed?.["chapter text"] || "")}`;
      const refreshedTentativeProcedure = tentativeMotionDefect && (
        /\b(?:moved|carried|seconded|defeated|approved|adopted|voted)\b/iu.test(refreshedText)
          || /\b(?:motion\s+(?:was|is|has\s+been)\s+(?:proposed|introduced)|(?:proposed|introduced)\s+motion|formally\s+(?:proposed|introduced))\b/iu.test(refreshedText)
      );
      const refreshedUnsupportedSeconding = unsupportedSecondingDefect && /\b(?:seconded|seconder)\b/iu.test(refreshedText);
      if (!refreshedTentativeProcedure && !refreshedUnsupportedSeconding) return refreshed;
    }
    return refreshed;
  };
  const queryConservativeMinutesHandoffRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one minimal source-grounded civic transition. Return strict JSON only.",
    prompt: [
      `Conservative minutes-handoff repair attempt ${attempt} of 3.`,
      "The prior output overclaimed a minutes action. Start over from the literal source excerpt.",
      "This bounded source is only a transition or handoff involving minutes, not a completed report, presentation, receipt, approval, adoption, vote, or physical transfer.",
      "Use one neutral complete sentence describing only the source-visible handoff, such as 'The excerpt records a handoff to the Service Review minutes, without recording their presentation or approval.' Omit dates and handoff qualifiers such as part numbers, portions, or meeting segments, and do not use return, back, pass, or hand verbs. Do not name a recipient or infer that anyone received, reported, presented, handed back, approved, or carried the minutes.",
      "Hard constraint for a handoff-only span: do not copy any date from AGENDA_LABEL or GROUNDED_SOURCE into either output field, even when the agenda label date is authoritative. If the model is uncertain, return the neutral form 'The excerpt records a handoff to the Service Review minutes, without recording their presentation or approval.' with no date, part number, recipient, or completed action.",
      "Do not use the words reported, reported back, presented, received, approved, adopted, carried, or handed back unless the source explicitly records that completed action.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. If the source has only an internal label, omit the actor and retain the literal transition.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `EXPLICIT_SOURCE_NAMED_SPEAKER_LABELS: ${sourceNamedSpeakerLabels.join(" | ") || "(none)"}`,
      `GROUNDED_SOURCE: ${String(parentLiteralSourceExcerpt || parentRepairSourceExcerpt || semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9000 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeMinutesMotionScopeRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one conservative source-grounded civic summary for a minutes item with a generic move-and-vote phrase. Return strict JSON only.",
    prompt: [
      `Conservative minutes-motion-scope repair attempt ${attempt} of 3.`,
      "The prior output assigned a later minutes item or an unsupported receipt action to the current labeled minutes item. Start over from the literal source excerpt.",
      MINUTES_MOTION_SCOPE_REPAIR_RULE,
      "Use the authoritative agenda label only to identify the current minutes committee. If a later named committee appears after a generic move-and-vote phrase and the current committee is not repeated with that motion, use the handoff-only form: 'The excerpt records a handoff to the [current committee] minutes without explicitly recording their presentation or approval.' Otherwise, a safe form is: 'The discussion returned to the [current committee] minutes, and a motion to move the minutes was carried.' Do not use received, approved, adopted, presented, or reported back unless the source explicitly pairs that word with the current labeled minutes.",
      "If the source includes a later named committee and a later motion to receive its minutes, stop before that later committee and omit its content, motion, and outcome.",
      "Never copy transcript speaker labels or infer a named mover, seconder, recipient, or chair.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 520,
    temperature: 0.2,
    seed: seed + 9500 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeConsentAgendaScopeRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one conservative source-grounded civic summary for a consent-agenda scope sequence. Return strict JSON only.",
    prompt: [
      `Conservative consent-agenda-scope repair attempt ${attempt} of 3.`,
      "The prior output changed the item ranges or merged a later pulled-item discussion into the composite consent motion. Start over from the literal source excerpt.",
      CONSENT_AGENDA_SCOPE_REPAIR_RULE,
      "Use the exact source ranges and exceptions. A safe form is: 'The carried consent-agenda motion received items [receive range], except [exceptions], and approved the recommendations in items [approval range], except [exceptions].' Replace the bracketed fields only with literal source-supported ranges and exceptions; do not invent or normalize the ranges.",
      "Do not use a later pulled item's motion, deferral, defeat, or vote as the outcome of the parent consent agenda. Do not copy transcript speaker labels or infer a named mover.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 520,
    temperature: 0.2,
    seed: seed + 9600 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeAmendmentSequenceRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that separates amendment layers and later procedural actions. Return strict JSON only.",
    prompt: [
      `Conservative amendment-sequence repair attempt ${attempt} of 3.`,
      "The prior output merged a proposed amendment to a motion with the original motion and a later nomination. Start over from the literal source excerpt.",
      AMENDMENT_SEQUENCE_REPAIR_RULE,
      AMENDMENT_EVIDENCE_PRIORITY_RULE,
      amendmentEvidence
        ? `STRUCTURED AMENDMENT EVIDENCE: ${JSON.stringify(amendmentEvidence)}`
        : "",
      "Name the document when describing a substantive document amendment, and explicitly say that the proposed amendment to the motion was not accepted or was not made when the source says so. Do not call the rejected motion amendment approved, carried, or adopted.",
      "Keep a later nomination, appointment, or acclamation as a separate action with its own source-supported disposition. Do not merge the amendment and nomination into one outcome.",
      "Audit-completeness requirement: if the source's original motion explicitly joins a document amendment with an appointment or nomination, include both source-supported actions in the repaired summary, even if the audit rejected a candidate that mentioned only one of them.",
      "Audit-conservatism requirement: do not repeat an audit-rejected causal purpose or inferred relationship. If the audit says a phrase such as 'to replace the head of council' is unsupported, remove that purpose and state only that another member was appointed or nominated.",
      "Hard rejection rule: when AUDIT_REJECTED_CLAIMS contains an unsupported causal relationship, do not use that relationship or its synonyms in either output field unless the literal source explicitly states it.",
      "For mover and amendment attribution, use only a name explicitly paired with the action in the same source sentence. Never use a mayor, councillor, deputy mayor, or agenda-label person as the mover or as the person who declined an amendment merely because that identity appears elsewhere.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      `AUDIT_REJECTED_CLAIMS: ${String(extraInstruction || "").trim() || "(none supplied)"}`,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `EXPLICIT_SOURCE_NAMED_SPEAKER_LABELS: ${sourceNamedSpeakerLabels.join(" | ") || "(none)"}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9800 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeOrdinalMotionSequenceRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that keeps ordinal motions separate. Return strict JSON only.",
    prompt: [
      `Conservative ordinal-motion-sequence repair attempt ${attempt} of 3.`,
      "The prior output assigned a detail or outcome to the wrong numbered motion. Start over from the literal source excerpt.",
      "Use a conservative sequence shape: omit an unnumbered on-the-table action when naming it could invite a false first-motion label; state the explicitly numbered second motion's supported outcome generically; then use separate sentences for a carried amendment motion and the carried amended motion. Fill the subjects and remaining scope only from the source.",
      "A safe source-grounded form, with source terms substituted, is: 'The explicitly numbered second motion concerning the remaining recommendations was carried. The motion to amend the later motion by removing the named scope was carried. The amended motion, limited to the remaining scope, was then carried.' Do not write that an initial or first motion was placed on the table, and do not compress the last two sentences into 'the motion was amended and carried.'",
      ORDINAL_MOTION_SEQUENCE_RULE,
      ORDINAL_MOTION_OWNERSHIP_RULE,
      ORDINAL_MOTION_SUBJECT_PARAPHRASE_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      "A question asking for clarification about a third motion is not itself the third motion's final subject or outcome. If the source then explicitly moves a second motion and later a third motion, keep those actions separate and preserve the source's own wording.",
      "If the bounded excerpt ends after an explicit disposition for one motion and only describes later motions as subsequent steps or asks whether another motion is needed, do not label those later motions pending or assign them an outcome. Use neutral wording that later motions were described or omit them.",
      "In a minutes excerpt, keep an earlier carried receipt or approval of the current minutes separate from narrative that an earlier committee item was postponed. If a later current motion is explicitly described as defeated, preserve that defeat; do not substitute the earlier postponement. If the source's later motion sequence is not fully disposed in this bounded chunk, a safe form is that later motions were described as subsequent steps without a recorded disposition.",
      "When the source explicitly pairs receipt of the current minutes and approval of their recommendations with a carried vote, preserve that carried action as a separate first clause; do not replace it with the later postponed or defeated status of another referenced item.",
      "Keep each motion's source scope intact: do not attach a later removal zone, exception, or policy change to the earlier motion that would retain the existing rules. If the roll call says people were in favour first and opposed second, preserve that direction in the prose.",
      "If an earlier minutes motion is simply said to be carried without a spoken roll call, omit a vote count for that motion. Attach a later in-favour/opposed count only to the later motion whose call and disposition immediately surround it.",
      "When more than one motion appears in this bounded chunk, omit all vote counts unless the source pairs the count unmistakably with the same motion subject and disposition. Never place one motion's count in another motion's sentence; outcomes without counts are safer and fully grounded.",
      "Do not describe one motion's vote as a split between retaining and removing alternatives when only the first motion was voted on. State the first motion's own no-change or status-quo subject, then describe later removal alternatives only as later steps if their disposition is outside this chunk.",
      "When the source records an amendment motion as carried and then returns to the amended motion and records that motion as carried, write two separate clauses or sentences, for example: 'The amendment removing the additional zone was carried. The amended motion, now limited to the remaining zone, was then carried.' Do not merge those two outcomes into one vote or describe the amendment as the final motion itself.",
      "Required distinction: do not write only that the third motion was amended and carried. State separately that the motion to amend the scope was carried, then that the amended motion with the narrower scope was carried. The first clause is the amendment motion outcome; the second clause is the amended motion outcome.",
      "If the source explicitly identifies a second motion, later calls its question, and says that it is carried, include that carried outcome with the second motion. Keep any later third motion and its amendment sequence separate; do not leave the second motion merely as 'moved' when its carried disposition is explicit.",
      "If the chunk also contains a different motion described as 'on the table' or a separate second or third motion, do not call it the initial motion in the amendment sequence or fold it into the later amendment. Omit that ambiguous earlier action if needed and report the two explicit carried amendment steps separately.",
      "Never write 'the first motion was placed on the table' unless the source explicitly numbers and pairs that first motion with the on-table statement. An unnumbered on-table phrase with unclear subject must be omitted.",
      "If the source explicitly says an amendment to remove a zone or other scope was carried, attach that outcome only to the amendment and the motion it directly follows. Do not attach insurance details, principal-residence terms, or other wording to a different ordinal motion unless the same source sentence does so.",
      "If this bounded source contains an explicit second motion but no explicit first-motion action, do not write that a first motion was moved or placed on the table. The phrase 'on the table' without a numbered subject is not a first-motion action; omit it and preserve the second motion, third motion, amendment, and amended-motion sequence separately.",
      "Do not describe the unnumbered on-the-table motion as unnumbered in the summary when that wording could invite the audit to infer a first motion. Omit that ambiguous action from the prose and retain the explicitly numbered second motion, third motion, carried amendment, and carried amended motion.",
      "If a later speaker explicitly clarifies that the motion on the floor is not about a previously discussed scope, do not attach that excluded scope to the later motion. If the source returns to an amended motion and then records that motion as carried, describe the amended motion as carried after the amendment; do not claim that the unamended motion was separately carried or that the amendment was the whole substantive motion.",
      "Do not infer a carried, defeated, or approved outcome for a motion that is only described, questioned, or clarified. Omit unsupported ordinal details rather than merging them.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      ordinalMotionEvidence
        ? `LITERAL MOTION-SEQUENCE EVIDENCE: ${JSON.stringify(ordinalMotionEvidence)}. Use it only to preserve source order and ownership; do not invent any fact not present in the grounded source.`
        : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      ordinalMotionEvidence
        ? `FINAL MOTION-SEQUENCE CHECK: verify the exact source and use this extracted sequence only as an ownership checklist: ${JSON.stringify(ordinalMotionEvidence)}. Keep each motion's own subject and scope; attach a disposition only to its matching motion. Because this chunk contains multiple motions, omit all vote counts and words such as 'unanimously' from the prose unless the source unmistakably pairs the count with one motion. Never add a different count. If later motions have no explicit disposition in this excerpt, say so neutrally or omit them.`
        : "FINAL MOTION-SEQUENCE CHECK: keep each motion's own subject and scope; attach a disposition only to the motion immediately under discussion. If the source explicitly says the current motion is defeated, do not replace that with an earlier carried result. If later motions have no explicit disposition in this excerpt, say so neutrally or omit them.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0,
    seed: seed + 9850 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeAbsenceListingRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one minimal source-grounded civic status for an agenda absence listing. Return strict JSON only.",
    prompt: [
      `Conservative absence-listing repair attempt ${attempt} of 3.`,
      "The prior output attributed the absence listing to an unspecified speaker. Start over from the first explicit current-item sentence in the grounded source.",
      "Use one neutral complete sentence stating only the explicit absence, such as 'No correspondence was reported for the item.' Do not write 'the speaker stated', name a speaker, mention transcript labels, or import any later report, minutes, recommendation, or procedural action from trailing source lines.",
      "An explicit current-item absence listing is a status statement, not a motion, receipt, approval, report, presentation, or outcome. Preserve the absence without adding a cause or disposition.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9900 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeDecisionSequenceRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves separate procedural decisions. Return strict JSON only.",
    prompt: [
      `Conservative decision-sequence repair attempt ${attempt} of 3.`,
      "The prior output merged distinct motions or generalized the named matter. Start over from the literal source excerpt.",
      PROCEDURAL_DECISION_SEQUENCE_RULE,
      DECISION_SEQUENCE_REPAIR_RULE,
      "Use the source's named matter and describe the carried motion to reconsider separately from the later carried motion accepting the recommendation. Preserve the recommendation as presented by staff only when that wording is supported; do not turn it into a generic staff recommendation or a broader program outcome.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9950 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeReportedActionRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that separates historical and current actions. Return strict JSON only.",
    prompt: [
      `Conservative historical-action repair attempt ${attempt} of 3.`,
      "The prior output transferred a historical approval to the current meeting. Start over from the literal source excerpt.",
      REPORTED_PAST_ACTION_RULE,
      REPORTED_ACTION_REPAIR_RULE,
      "Name the earlier approving body only for the historical approval, and describe the current meeting as receiving the verbal report. Do not let the current meeting's receipt motion approve, adopt, or authorize the reported agreement, funding, or program expansion.",
      "Do not call the same source speaker 'another speaker' or invent a second actor. If speaker identity is not needed for the historical/current distinction, omit it.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9975 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativePublicCommentRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic report summary that separates public comments from formal motions. Return strict JSON only.",
    prompt: [
      `Conservative public-comment report repair attempt ${attempt}.`,
      "The prior output turned public comments about an official-plan amendment into an unsupported defeated motion. Start over from the literal source excerpt.",
      REPORT_PROPOSAL_STATUS_RULE,
      REPORT_PROPOSAL_AUDIT_PRIORITY_RULE,
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
      "Describe the report's stated recommendation and any explicitly recorded current motion or carried outcome separately from the public-comment context.",
      "Hard constraint: when the source contains public comments about the need for an official plan amendment but no explicit motion and defeated disposition about that need, do not use defeated, defeat, rejected, or earlier motion for that public-comment subject. Say only that public comments addressed or mentioned the need.",
      "Do not treat 'I will move the recommendation' as an earlier defeated motion. If the source later records that recommendation's question and carried result, that is a separate current action.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9980 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeOptionMotionRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that separates options from procedural outcomes. Return strict JSON only.",
    prompt: [
      `Conservative option-motion scope repair attempt ${attempt} of 3.`,
      "The prior output attached a motion, vote, or carried outcome to an option or proposal without an explicit source pairing, or introduced unsupported report/document framing. Start over from the literal source excerpt.",
      OPTION_MOTION_SCOPE_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      EXPLICIT_MOTION_DISPOSITION_PRIORITY_RULE,
      "Treat an option, alternative, proposed change, or request for direction as discussion content unless the source explicitly moves that same subject and records its disposition in this bounded span. A historical motion that was previously passed, or a later motion and vote, cannot supply an outcome for an earlier option. If the source presents options and then asks for direction without a motion outcome, describe the options and request for direction neutrally and omit any vote or carried result.",
      "Do not use report, report description, document, report proposal, or presentation framing unless those words and that identity are explicitly supported by the literal source. Use a named speaker only when the same source block pairs the name with the statement; otherwise use impersonal wording.",
      "Treat each transcript display label as literal evidence only for the text under that label. Do not add a title to a displayed name because nearby dialogue addresses that person, and do not normalize a name or spelling variant into a different titled actor. If the label, dialogue, and title do not align, omit the personal name and title together and use a generic subject.",
      "If speaker or role alignment remains uncertain after the audit, do not substitute 'a speaker', 'another speaker', or another generic actor for the disputed action. Omit that actor-specific clause and retain only impersonal source-supported topic, feature, or procedural status.",
      "GENERIC-ACTOR AUDIT OVERRIDE: if the independent audit says the candidate used unsupported generic actors such as 'a speaker', 'another speaker', or 'a third speaker', those generic actor phrases are forbidden in the replacement. Do not preserve the disputed action by changing the name to a generic actor; omit the entire actor-specific clause and keep only impersonal source-supported content. Exact transcript labels may be used only when the same labeled source block directly supports the action.",
      "ACTOR-AUDIT FINAL OVERRIDE: if the audit identifies unsupported names or titles, output no disputed personal name, office, title, or generic actor at all. Omit every speaker-specific clause that depends on that attribution and retain only impersonal source-supported topics, features, procedural status, or outcomes.",
      "PROCEDURAL-HANDOFF ATTRIBUTION OVERRIDE: a phrase such as 'take questions after [item]', 'I'll continue with [item] narrative', or a call to the next participant is transition evidence, not by itself evidence that the speaker presented the named item's substantive budget or report details. If the audit rejects a presentation attribution, omit the actor-specific presentation clause unless the same speaker block contains the substantive lines; do not replace it with 'staff presented' or another generic subject.",
      "BOUNDED SPEECH-ACT OVERRIDE: if the independent audit says the supplied source window contains only qualified personal support or ends before a formal motion or deferral, do not write that the body considered a proposal or recommended/deferred it. Preserve only the qualified support or source-supported topic, and omit the later procedural outcome.",
      "INCOMPLETE-DEFERRAL OVERRIDE: when the source only raises the possibility of deferral or says a motion to defer would be needed, and no disposition is recorded, write 'a possible deferral was raised or discussed' or omit it; do not write 'a decision was deferred' or imply that a formal motion was made.",
      "In a mixed chunk, omit routine questions, answers, confirmations, and no-further-question transitions when their actors or pairings are unclear. Retain only source-supported declarative options, effects, decisions, and next steps.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION (UNTRUSTED REPAIR CONTEXT): ${rejectedClaims}` : "",
      rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED AND BLOCKLISTED): ${rejectedOutput}` : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL OPTION-MOTION CHECK: attach an outcome only to the exact motion subject that immediately precedes the explicit disposition; otherwise omit the outcome and keep the option as proposed or under consideration.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.15,
    seed: seed + 9970 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeReportProposalRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic report summary that preserves proposal scope. Return strict JSON only.",
    prompt: [
      `Conservative report-proposal repair attempt ${attempt} of 3.`,
      "The prior output invented process details or merged a report proposal with a separate defeated motion. Start over from the literal source excerpt.",
      REPORT_PROPOSAL_STATUS_RULE,
      REPORT_PROPOSAL_AUDIT_PRIORITY_RULE,
      PUBLIC_COMMENT_PLAN_AMENDMENT_RULE,
      REPORT_PROPOSAL_REPAIR_RULE,
      "Use only process steps, forms, criteria, timelines, organizations, and outcomes explicitly present in the source. Do not mention an RFP, evaluation criteria, lease terms, or a selection process unless the source explicitly contains them.",
      "Preserve the source's exact proposal framing. If the source says that a report provides a proposed process, use that form rather than saying that the report proposes the process, and do not present either wording as an adopted direction.",
      "When the source speaker is narrating what a report provides, preserve the content without assigning an acting speaker. Use neutral impersonal framing only when the literal source supports that exact report or item identity; otherwise describe the source-supported discussion or recommendation generically. Never copy a suggested report-description phrase from this instruction into the output unless the bounded source states that same framing.",
      "Required modality for a narrated report: use neutral impersonal document framing and preserve 'proposed' status. Do not use 'the speaker stated', a named presenter, 'the presentation described', or 'the report provides' as the main subject when that wording could be read as a completed current fact.",
      "For eligibility, partner, cost, or process details, use passive or impersonal wording such as 'eligibility was limited' and 'local partners were identified'; omit a secondary detail if it cannot be stated without assigning an unsupported actor. For an unfinished amendment discussion, say that the discussion included a proposed amendment or referred to an earlier defeated motion; do not call it a subsequent motion that was proposed or assign it a final disposition.",
      "Hard constraint: do not make any presenter, 'the speaker', 'the report', or the governing body the grammatical subject of recommended, limited, suggested, invited, sought, or approved. Use impersonal wording or omit the detail conservatively; never attach an action to an actor merely because that actor introduced the report.",
      "Keep any defeated or amended motion separate from the report's proposed process. If the source first describes an RFP or request-for-interest process and later records an amendment to stop seeking interest or use forms only for existing inquiries, preserve that sequence and do not present the original RFP as the final current direction.",
      "Required coverage: when this source contains both a report's proposed process and a later defeated, amended, or contrary motion about that process, write both layers in the summary, even if that requires two sentences. Do not return a proposal-only summary. If the source does not record the later motion's final outcome, describe only that it was proposed or discussed and omit an invented outcome.",
      "Do not say that a proposal or motion 'was amended', 'was changed', 'was limited', or 'was subsequently amended' unless the source explicitly records that amendment being adopted or carried. When the source says an amendment is needed or should reflect a direction, say that a speaker proposed or discussed an amendment and state its intended scope without claiming completion.",
      "Do not say that the report's proposed process itself was defeated or rejected merely because a motion concerning it was defeated or an amendment was proposed. Keep the document framing, the motion disposition, and any proposed amendment as separate layers.",
      "When the source only refers back to an earlier defeated motion and the current amendment discussion has no recorded final disposition, do not compress that into 'a motion concerning this process was defeated' and do not say the current amendment carried. Use 'the discussion referred to an earlier defeated motion' or omit the historical status, then describe the current amendment only as proposed or discussed.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `EXPLICIT_SOURCE_NAMED_SPEAKER_LABELS: ${sourceNamedSpeakerLabels.join(" | ") || "(none)"}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL REPORT-PROPOSAL CHECK: keep any earlier defeated motion as historical reference and keep the current amendment as proposed or discussed unless its adoption is explicitly recorded. Do not say the current motion was defeated or carried merely because the source mentions an earlier defeated motion.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9990 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeMultiBoundaryRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves complete spatial and relational evidence. Return strict JSON only.",
    prompt: [
      `Conservative multi-boundary repair attempt ${attempt} of 3.`,
      "The prior output narrowed or dropped one member of an explicitly listed location relationship. Start over from the literal source excerpt.",
      MULTI_BOUNDARY_REPAIR_RULE,
      "When mentioning a location, include every boundary or alternative explicitly attached to that location in the source. Do not turn an 'or' or 'and' relationship into a single boundary, and do not imply that one listed reference is exclusive.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9995 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeQuestionAnswerRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves question-and-answer speech acts. Return strict JSON only.",
    prompt: [
      `Conservative question-answer repair attempt ${attempt} of 3.`,
      "The prior output converted a question-and-answer exchange into a report finding or unsupported attribution. Start over from the literal source excerpt.",
      QUESTION_ANSWER_REPAIR_RULE,
      "Do not say that a report noted, found, or stated a fact when the source presents that detail as a speaker's question or a response to a question. Do not assign a title or role from agenda metadata. Do not infer a question from a declarative answer or a routine 'any questions' / 'not seeing any' transition. For a mixed substantive chunk, omit routine dialogue and write only the source-supported declarative content, using a named speaker only when the same source block pairs that name with the statement.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. Omit unsupported names and roles.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9997 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeRoleAttributionRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => {
    const repairEvidence = `${rejectedClaims} ${rejectedOutput}`;
    const handoffRoleDefect = /\b(?:incorrect(?:ly)?\s+attribut(?:e|es|ed)|attribut(?:e|es|ed)\s+the\s+presentation)\b/iu.test(repairEvidence)
      && /\b(?:handoff|over\s+to|delivered\s+by|presented\s+by|not\s+the\s+(?:manager|office|department|director)|agenda\s+(?:anchor|source))\b/iu.test(repairEvidence);
    const actingBodyAttributionDefect = /\b(?:acting\s+body|body\s+label|institutional\s+(?:actor|subject)|committee\s+itself|council\s+itself|rather\s+than\s+a\s+(?:generic\s+)?speaker|does\s+not\s+identify\s+the\s+speaker)\b/iu.test(repairEvidence)
      && /\b(?:call(?:ed)?|order|open(?:ed)?|announce(?:d)?|present(?:ed)?|ask(?:ed)?|said|speech)\b/iu.test(repairEvidence);
    const institutionalActorDefect = institutionalActorGroundingDefect(repairEvidence);
    const collectiveAttributionDefect = collectiveActorGroundingDefect(repairEvidence);
    const repaired = await callOllamaJson({
    ollamaUrl,
    llmModel,
    appendUniversalContract: false,
    system: [
      "Write one source-grounded civic summary with faithful speaker roles. Return strict JSON only.",
      handoffRoleDefect
        ? "HARD HANDOFF-ROLE OVERRIDE: when the agenda says an item is from an office or manager and then hands off with language such as 'over to [person]', the office or manager names the agenda source or provenance, not the substantive presenter. Attribute presentation or report content only to the named handoff recipient when the same source block explicitly pairs that person with the substantive content; otherwise omit the presenter clause. Never call the agenda office or manager the presenter merely because the item is listed under that office."
        : "",
      actingBodyAttributionDefect
        ? "HARD ACTING-BODY OVERRIDE: an acting-body label such as a committee, council, county, or meeting is not the speaker who performs a call-to-order announcement or other speech act. Do not use the body label as the actor for that announcement. Use impersonal source-supported wording or a generic speaker only when the bounded source supports it; omit the actor rather than assigning the body's action to itself."
        : "",
      institutionalActorDefect
        ? "HARD INSTITUTIONAL-ACTOR OVERRIDE: the audit says an institutional subject such as a committee, council, body, staff office, department, director, or manager was incorrectly assigned an action such as presenting, noting, directing, saying, recommending, reading, or approving. Do not repeat that institutional actor/action pairing. Use impersonal source-supported wording and omit the institutional actor when the bounded source does not explicitly pair it with the action."
        : "",
      collectiveAttributionDefect
        ? "HARD COLLECTIVE-ATTRIBUTION OVERRIDE: the audit distinguishes individually attributed remarks from an unsupported collective or generic actor. Do not merge those remarks into Directors, staff, a team, a group, a committee, or another aggregate subject. Do not use generic staff or another aggregate actor when the source does not pair it with the retained claim. Use impersonal source wording or omit the disputed actor/action clause."
        : "",
      "HARD UNSPECIFIED-EXPENDITURE OVERRIDE: never call an expenditure or expense 'specific' unless GROUNDED_SOURCE explicitly identifies its object. If the source only says 'this expenditure', 'the expense', or otherwise leaves the object unspecified, omit the word 'specific' and preserve only the generic expenditure or source-supported action.",
      "HARD EXPLICIT-MOTION-FIDELITY OVERRIDE: when GROUNDED_SOURCE explicitly records a motion being moved and seconded, retain that procedural act in impersonal wording such as 'a motion was moved and seconded' and preserve its literal source-supported object and outcome. If mover or seconder names conflict, omit the personal names but do not downgrade the motion to a proposal or generic discussion. If the source does not explicitly record the procedural act, omit it rather than inferring one.",
      handoffRoleDefect
        ? "HARD HANDOFF OUTPUT CONTRACT: for this unresolved handoff repair, do not use any office, department, manager, director, or named handoff recipient as the presenter or actor in either output field. Generate only an impersonal source-supported topic summary."
        : "",
    ].filter(Boolean).join(" "),
    prompt: [
      `Conservative role-attribution repair attempt ${attempt} of 3.`,
      "The prior output assigned an unsupported office or institutional role to a speaker. Start over from the literal source excerpt.",
      "The rejected candidate is untrusted repair context, not source evidence. Reconstruct the output from GROUNDED_SOURCE only and never copy or paraphrase its rejected role/name pairing.",
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
        SOURCE_TOPIC_RELATIONSHIP_RULE,
        SEPARATE_REMARKS_SCOPE_RULE,
        MOTION_CONTEXT_SEPARATION_RULE,
      attempt === 1
        ? "First repair pass: remove any role not explicitly paired with the speaker's own claim; preserve supported content with impersonal wording when needed, and do not invent a generic actor for an unclear exchange."
        : attempt === 2
          ? "Second repair pass: discard the prior wording and audit every actor, addressee, handoff, and role against the same source block before writing the replacement."
          : "Final repair pass: omit uncertain roles, names, and actor clauses entirely, retain only the source-supported topic or question, and use impersonal wording. Do not use a generic actor or the role words councillor, council member, mayor, chair, deputy mayor, or staff anywhere in either output field unless the same source line explicitly pairs that role with the actor's claim.",
      "A person being addressed, thanked, or named in a handoff is not automatically the speaker. Do not use 'council member', 'councillor', 'mayor', 'chair', or 'staff' merely because the source mentions Mayor and Council, Your Worship, a council agenda, or a staff question.",
      "ROLE-NEUTRAL OUTPUT CONTRACT: when the role pairing is unclear, use impersonal wording such as 'the source records a response' or retain only the supported topic; do not use 'a speaker', 'another speaker', 'a third speaker', or another generic actor to preserve a disputed action.",
      "ACTOR-CLAUSE OMISSION PRIORITY: if the audit rejects a generic speaker's actor pairing, do not satisfy the repair by substituting 'a speaker', 'another speaker', or another generic actor for that same disputed action. Omit the entire speaker-specific clause and retain only impersonal source-supported topic, feature, or procedural status.",
      "GENERIC-ACTOR AUDIT OVERRIDE: if INDEPENDENT_AUDIT_REJECTION says the candidate used unsupported generic actors, the replacement must not contain 'a speaker', 'another speaker', 'a third speaker', or equivalent generic actor wording. Omit each disputed actor/action clause entirely and retain only impersonal source-supported content. Do not use a generic actor to preserve an unsupported action.",
      "PROCEDURAL-HANDOFF ATTRIBUTION OVERRIDE: a phrase such as 'take questions after [item]', 'I'll continue with [item] narrative', or a call to the next participant is transition evidence, not by itself evidence that the speaker presented the named item's substantive budget or report details. If the audit rejects a presentation attribution, omit the actor-specific presentation clause unless the same speaker block contains the substantive lines; do not replace it with 'staff presented' or another generic subject.",
      handoffRoleDefect
        ? "HARD HANDOFF-ROLE PROMPT: the office or manager named before 'over to [person]' is not the presenter. Follow the literal handoff and use the named recipient for the substantive presentation only when the source immediately gives that person the report or recommendations; otherwise use impersonal wording. Do not repeat the rejected office-presenter pairing."
        : "",
      handoffRoleDefect
        ? "HANDOFF SAFE RESOLUTION: if the source does not make the recipient's substantive presentation explicit enough to resolve the role, omit both the office-presenter and named-presenter clauses. Keep only an impersonal source-supported topic; never preserve the rejected office role."
        : "",
      actingBodyAttributionDefect
        ? "ACTING-BODY SAFE RESOLUTION: for a call-to-order or similar procedural announcement, preserve only the source-supported meeting status and omit the committee/council/meeting as a speaking actor. Never repeat the rejected body-as-speaker pairing."
        : "",
      institutionalActorDefect
        ? "INSTITUTIONAL-ACTOR SAFE RESOLUTION: if the source records an institutional recommendation being read or a fact being stated by an unidentified speaker, write only impersonal wording such as 'the source records a recommendation' or 'the source states that ...'. Do not say that the committee presented it, that Council noted it, or that staff directed it unless the same bounded source line explicitly makes that pairing."
        : "",
      collectiveAttributionDefect
        ? "COLLECTIVE-ATTRIBUTION SAFE RESOLUTION: the source names separate individuals, not a collective speaker. Do not say that Directors discussed, staff noted, or a team/group/committee performed the disputed action. Use impersonal wording for supported topics and omit the collective actor/action clause when the pairing is not explicit."
        : "",
      handoffRoleDefect
        ? "Do not copy the rejected office-presenter pairing or any named actor into this repair; the required resolution is impersonal topic prose."
        : "",
      "BOUNDED SPEECH-ACT OVERRIDE: if the independent audit says the supplied source window contains only qualified personal support or ends before a formal motion or deferral, do not write that the body considered a proposal or recommended/deferred it. Preserve only the qualified support or source-supported topic, and omit the later procedural outcome.",
      "INCOMPLETE-DEFERRAL OVERRIDE: when the source only raises the possibility of deferral or says a motion to defer would be needed, and no disposition is recorded, write 'a possible deferral was raised or discussed' or omit it; do not write 'a decision was deferred' or imply that a formal motion was made.",
      "ABSOLUTE ROLE BLOCKLIST: treat every unsupported role, title, name-role pairing, and actor attribution named in INDEPENDENT_AUDIT_REJECTION or REJECTED_CANDIDATE as forbidden output. If a person's name appears without an explicit role pairing in the same source line, omit the name and role together; do not preserve the rejected name as a bare speaker.",
      "ACTOR-AUDIT FINAL OVERRIDE: because this is an actor or role repair, if the audit identifies unsupported names or titles, output no disputed personal name, office, title, or generic actor at all. Omit every speaker-specific clause that depends on that attribution and retain only impersonal source-supported topics, features, procedural status, or outcomes.",
      "Keep a question and its response separate. If the source explicitly identifies a staff response, staff may be named; otherwise omit the actor rather than assigning the response to another speaker. Preserve a source-recorded motion, vote, or amendment when it is explicitly supported, but do not attach it to an unsupported actor or infer a completed motion or vote.",
      "Omit every claim listed in INDEPENDENT_AUDIT_REJECTION unless it is directly supported by the supplied source. In particular, do not preserve rejected budget figures, revenue details, accounting treatment, or causal explanations merely because they appeared in the prior candidate.",
      "If the audit rejects a 'specific expenditure' claim because the source does not identify the expenditure object, omit the qualifier and retain only generic source-supported wording such as 'the expenditure' or the literal proposal/action.",
      "If the source explicitly records a moved-and-seconded motion but the audit rejects a personal mover or seconder name, retain the impersonal procedural fact and literal motion object; do not replace 'motion' with 'proposal', 'discussion', or 'question'. Omit any topic that the audit says is only surrounding dialogue rather than the motion's explicit subject.",
      parentOverviewGenerationContract,
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      "ACTOR-AUDIT FINAL OVERRIDE: because this is an actor or role repair, if the audit identifies unsupported names or titles, output no disputed personal name, office, title, or generic actor at all. Omit every speaker-specific clause that depends on that attribution and retain only impersonal source-supported topics, features, procedural status, or outcomes.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION: ${rejectedClaims}` : "",
      rejectedOutput && !handoffRoleDefect ? `REJECTED_CANDIDATE (UNTRUSTED AND BLOCKLISTED): ${rejectedOutput}` : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(parentLiteralSourceExcerpt || parentRepairSourceExcerpt || semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL ROLE OUTPUT CHECK: if the rejection identifies conflicting mover or seconder spellings, the summary and chapter text must contain no personal mover or seconder name at all; use impersonal motion wording or omit that actor clause. If the rejection concerns a chair-announced floor status, never output placing, placed, brought, put, or moved an item onto the floor for discussion; use impersonal status or omit it. Do not copy a disputed name from GROUNDED_SOURCE or REJECTED_CANDIDATE, and do not output audit labels, source speaker metadata, or a disputed actor-specific clause.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.1,
    seed: seed + 9520 + attempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    const repairedText = `${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`;
    const repeatedInstitutionalActor = institutionalActorDefect
      && /\b(?:committee|council|county|body|staff|office|department|director|manager)\b[\s\S]{0,100}\b(?:present(?:ed|s)?|not(?:e|es|ed|ing)?|direct(?:ed|s)?|said|recommend(?:ed|s)?|read(?:ing)?|introduc(?:ed|es)?|approv(?:ed|es)?|adopt(?:ed|s)?|carried)\b/iu.test(repairedText);
    const repeatedCollectiveAttribution = collectiveAttributionDefect
      && /\b(?:director(?:s)?|staff|team|group|committee|council|county|body)\b[\s\S]{0,100}\b(?:discuss(?:ed|ing)?|not(?:e|ed|ing)?|present(?:ed|s)?|said|describ(?:ed|es)?|review(?:ed|s)?|strateg(?:y|ies)|recommend(?:ed|s)?)\b/iu.test(repairedText);
    if (!repeatedInstitutionalActor && !repeatedCollectiveAttribution) return repaired;
    let refreshed = repaired;
    for (let refreshAttempt = 1; refreshAttempt <= 3; refreshAttempt += 1) {
      refreshed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      appendUniversalContract: false,
      system: "Write one impersonal source-grounded civic summary with no unsupported institutional actor. Return strict JSON only.",
      systemSuffix: "HARD INSTITUTIONAL-ACTOR OUTPUT BAN: omit unsupported institutional or aggregate actor labels such as committee, council, county, body, staff, office, department, director, manager, Directors, team, and group from both JSON text fields for this repair. Preserve only impersonal source-supported wording and the substantive topic; do not repeat any institutional or collective actor/action pairing.",
      prompt: [
        `Fresh institutional-actor repair attempt ${refreshAttempt} of 3.`,
        "The previous role repair repeated an unsupported institutional actor/action pairing. Discard it completely and rebuild from GROUNDED_SOURCE only.",
        "Use impersonal wording such as 'the source records a recommendation' or 'the source states that ...' when the speaker is not explicitly identified. Omit all institutional, collective, and actor-specific clauses for this repair.",
        `AGENDA_LABEL: ${promptLabel}`,
        `GROUNDED_SOURCE: ${String(parentLiteralSourceExcerpt || parentRepairSourceExcerpt || semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
        "Return one non-empty complete source-grounded summary and chapter text. Do not copy the rejected wording or audit fragments.",
      ].join("\n\n"),
      maxOutputTokens: 620,
      temperature: 0.1,
      seed: seed + 11520 + attempt + refreshAttempt,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const refreshedText = `${String(refreshed?.summary || "")} ${String(refreshed?.["chapter text"] || "")}`;
      if (!/\b(?:committee|council|county|body|staff|office|department|director|manager|directors|team|group)\b/iu.test(refreshedText)) return refreshed;
    }
    return refreshed;
  };
  const queryConservativeParentOverviewRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => {
    const parentActorRepair = institutionalActorGroundingDefect(`${rejectedClaims} ${rejectedOutput}`)
      || collectiveActorGroundingDefect(`${rejectedClaims} ${rejectedOutput}`);
    let repaired = await callOllamaJson({
    ollamaUrl,
    llmModel,
    appendUniversalContract: false,
    system: [
      "Write one source-grounded parent overview from authoritative literal source anchors. Return strict JSON only.",
      parentActorRepair
        ? "HARD PARENT ACTOR REPAIR: the audit rejected an institutional or collective actor/action pairing in the parent overview. Do not use committee, council, county, body, staff, office, department, director, manager, Directors, plural councillors, team, or group as the actor for any rejected claim. Rebuild from the child coverage and literal anchors with impersonal wording such as 'the source records' or omit the disputed actor/action clause. Preserve other source-supported topics and outcomes."
        : "",
      parentActorRepair ? PARENT_SPEECH_ACT_AND_ACTOR_RULE : "",
      /\b(?:question|answer|confirm|another speaker|reply|attribut|staff member)\b/iu.test(rejectedClaims)
        ? "SYSTEM-LEVEL REPAIR CONTRACT: the audit rejected dialogue or role attribution. Do not mention questions, answers, confirmations, no-further-question exchanges, another speakers, or generic staff responses in either output field. Omit that dialogue and summarize only other directly supported non-dialogue content."
        : "",
      /\b(?:speaker|actor|role|attribut|councillor|council\s+member|mayor|chair|manager|staff)\b/iu.test(rejectedClaims)
        ? "SYSTEM-LEVEL ROLE BLOCKLIST: the audit rejected a speaker title, office, name-role pairing, or actor attribution. Treat every such rejected pairing as forbidden output. Rebuild from literal source anchors only; a bare transcript speaker label or a name mentioned in quoted speech does not establish a title. Omit the actor-specific clause rather than substituting another named role."
        : "",
      collectiveActorGroundingDefect(rejectedClaims)
        ? "SYSTEM-LEVEL COLLECTIVE-ATTRIBUTION BLOCKLIST: the audit distinguishes separate individual remarks from an unsupported collective or generic actor. Do not say that Directors, staff, a team, a group, a committee, or another aggregate subject performed the rejected action. Use impersonal source wording or omit that actor/action clause."
        : "",
      /\breport\b/iu.test(rejectedClaims)
        ? "SYSTEM-LEVEL REPAIR CONTRACT: the audit rejected report/document framing. Do not use report or document wording unless an authoritative literal anchor explicitly supports it."
        : "",
      /\b(?:motion|vote|carried|approved|recorded vote|outcome)\b/iu.test(rejectedClaims)
        ? "SYSTEM-LEVEL REPAIR CONTRACT: the audit rejected a motion/vote relationship. Do not pair the disputed topic or option with a motion, vote, carried result, or approval."
        : "",
      /floor\s+for\s+discussion|placing\s+the\s+item/iu.test(rejectedClaims)
        ? "SYSTEM-LEVEL PROCEDURAL-FLOOR REPAIR: never write 'placing the item on the floor for discussion'. If the chair announces that status, use only 'the motion was on the floor for discussion' or omit it."
        : "",
    ].filter(Boolean).join(" "),
    prompt: [
      `Conservative parent-overview grounding repair attempt ${attempt} of 3.`,
      "The prior parent overview failed an independent source-grounding audit. Start over from the complete chapter coverage evidence and literal source anchors below.",
      PARENT_OVERVIEW_GROUNDING_RULE,
      PARENT_SPEECH_ACT_AND_ACTOR_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      QUESTION_ANSWER_REPAIR_RULE,
      "Do not preserve any rejected framing, including unsupported institutional subjects, generic meeting actions, or document/report labels. In particular, do not call transcript content a report description unless the literal source explicitly does so.",
      "When a named speaker or staff member is paired with a statement in a chapter's source anchor, retain that pairing or omit the actor-specific detail; never replace it with 'the meeting addressed', 'the county discussed', or another broader institutional subject.",
      "Use the child summaries for complete topic coverage and the paired literal anchors for actor, action, timing, outcome, and speech-act verification. Do not treat omitted text in an anchor as evidence that a claim is absent.",
      parentActorRepair
        ? "PARENT ACTOR OUTPUT CONTRACT: keep the complete supported topic coverage, but do not say that the committee, council, county, body, staff, office, department, director, manager, plural councillors, team, group, or another aggregate subject performed any action rejected by the audit. Use only impersonal source wording for those claims."
        : "",
      "BANNED REJECTED WORDING: do not repeat or closely paraphrase any unsupported dialogue, role, document label, or motion relationship identified by the independent audit. Reconstruct the overview from the source evidence below; do not use the audit's rejected wording as source material.",
      /\b(?:speaker|actor|role|attribut|councillor|council\s+member|mayor|chair|manager|staff)\b/iu.test(rejectedClaims)
        ? "AUDIT-TYPE ROLE REPAIR: do not output any rejected title, office, name-role pairing, or specific actor attribution. Use a generic source description or omit the disputed actor/action clause unless the same literal source anchor explicitly pairs that role with the claim."
        : "",
      collectiveActorGroundingDefect(rejectedClaims)
        ? "AUDIT-TYPE COLLECTIVE-ATTRIBUTION REPAIR: the source names separate individuals, not a collective speaker. Do not merge their remarks into 'Directors discussed', 'staff noted', or another group action. Keep supported topics in impersonal wording and omit the disputed collective actor/action clause."
        : "",
      /\breport\b/iu.test(rejectedClaims)
        ? "AUDIT-TYPE REPAIR: the audit rejected report/document framing. Do not use the word report or document in either output field unless an authoritative literal anchor explicitly identifies that exact source as a report or document; use a named speaker or 'the source' instead."
        : "",
      /\b(?:motion|vote|carried|approved|recorded vote|outcome)\b/iu.test(rejectedClaims)
        ? "AUDIT-TYPE REPAIR: the audit rejected a motion, vote, or outcome relationship. Do not pair the disputed option, topic, or figure with a motion, vote, carried result, or approval; omit that disposition and retain only the source-supported discussion or presentation unless the same literal anchor explicitly pairs them."
        : "",
      /floor\s+for\s+discussion|placing\s+the\s+item/iu.test(rejectedClaims)
        ? "AUDIT-TYPE PROCEDURAL-FLOOR REPAIR: replace any 'placing the item on the floor for discussion' wording with the impersonal status 'the motion was on the floor for discussion' or omit the status; do not attribute that act to the mover."
        : "",
      /\b(?:question|answer|confirm|another speaker|reply|attribut|staff member)\b/iu.test(rejectedClaims)
        ? "AUDIT-TYPE REPAIR: the audit rejected a question, answer, confirmation, or role pairing. Omit the entire disputed dialogue exchange from both output fields; do not mention a question, answer, confirmation, no-further-question exchange, 'another speaker', or a generic staff response. Do not invent dialogue from a general statement or assign a response to staff or a named role unless the same literal source line explicitly pairs that actor with the response. Use other source-supported substantive content instead."
        : "",
      attempt >= 2
        ? "Write materially fresh prose. Use only source-faithful subjects such as a named speaker, the source, or an explicitly identified report/document, and omit every disputed claim that cannot be directly verified while retaining other supported topics and outcomes."
        : "Preserve distinct source-supported topics across the complete meeting chronology. If a topic's actor or speech act is uncertain, omit that topic rather than broadening it to a meeting or institutional action.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${parentLiteralSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "FINAL PARENT CHECK: audit the candidate against the complete source evidence above. Omit any dialogue, role, report/document label, or motion relationship that is not directly supported; do not copy prior rejected prose.",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0.65 : attempt === 2 ? 0.35 : 0.15,
    seed: seed + 9530 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
    });
    const institutionalOutput = /\b(?:committee|council|county|body|staff|office|department|director|manager|directors|councillors|team|group)\b[\s\S]{0,100}\b(?:discuss(?:ed|es|ing)?|present(?:ed|s|ing)?|note(?:d|s|ing)?|direct(?:ed|s|ing)?|say(?:s|ing)?|recommend(?:ed|s|ing)?|read(?:s|ing)?|introduc(?:ed|es|ing)?|oppos(?:ed|es|ing)?|question(?:ed|s|ing)?|clarif(?:ied|y|ies|ying)|confirm(?:ed|s|ing)?)\b/iu.test(`${String(repaired?.summary || "")} ${String(repaired?.["chapter text"] || "")}`);
    if (!parentActorRepair || !institutionalOutput) return repaired;
    let refreshed = repaired;
    for (let refreshAttempt = 1; refreshAttempt <= 3; refreshAttempt += 1) {
      refreshed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        appendUniversalContract: false,
        system: "Write one impersonal source-grounded parent overview with no rejected institutional actor. Return strict JSON only.",
        systemSuffix: "HARD PARENT INSTITUTIONAL-ACTOR OUTPUT BAN: omit committee, council, county, body, staff, office, department, director, manager, Directors, plural councillors, team, and group as actors from both JSON fields. Preserve only impersonal source-supported topics, speech acts, and outcomes; do not repeat the rejected actor/action pairing.",
        prompt: [
          `Fresh parent institutional-actor repair attempt ${refreshAttempt} of 3.`,
          "Discard the prior parent overview and rebuild from the complete audited child coverage and literal source anchors.",
          PARENT_OVERVIEW_GROUNDING_RULE,
          PARENT_SPEECH_ACT_AND_ACTOR_RULE,
          "Use impersonal wording such as 'the source records' or omit the actor-specific clause. Preserve all other source-supported topics and outcomes, including later chronology.",
          `AGENDA_LABEL: ${promptLabel}`,
          `GROUNDED_SOURCE: ${parentLiteralSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
          "Return one non-empty complete summary and chapter text as JSON. Do not copy the rejected wording or audit fragments.",
        ].join("\n\n"),
        maxOutputTokens: 720,
        temperature: refreshAttempt >= 3 ? 0 : 0.1,
        seed: seed + 11530 + attempt * 10 + refreshAttempt,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      });
      const refreshedText = `${String(refreshed?.summary || "")} ${String(refreshed?.["chapter text"] || "")}`;
      if (!/\b(?:committee|council|county|body|staff|office|department|director|manager|directors|councillors|team|group)\b[\s\S]{0,100}\b(?:discuss(?:ed|es|ing)?|present(?:ed|s|ing)?|note(?:d|s|ing)?|direct(?:ed|s|ing)?|say(?:s|ing)?|recommend(?:ed|s|ing)?|read(?:s|ing)?|introduc(?:ed|es|ing)?|oppos(?:ed|es|ing)?|question(?:ed|s|ing)?|clarif(?:ied|y|ies|ying)|confirm(?:ed|s|ing)?)\b/iu.test(refreshedText)) return refreshed;
    }
    return refreshed;
  };
  const queryConservativeParentOverviewScopeRepair = async (attempt = 1) => callOllamaJson({
    ollamaUrl,
    llmModel,
    appendUniversalContract: false,
    system: "Write fresh source-grounded parent overview prose from literal source anchors only. Return strict JSON only.",
    systemSuffix: "HARD SOURCE-SCOPE OVERRIDE: agenda labels and generated coverage aids are metadata, not evidence. Include a topic, scope, actor, action, or outcome only when the literal source anchors explicitly support that claim. If a named scope is absent from the anchors, omit it rather than paraphrasing or broadening the source.",
    prompt: [
      `Source-only parent-overview repair attempt ${attempt} of 3.`,
      "Discard the rejected overview and audit wording. Rebuild from LITERAL_SOURCE_ANCHORS only.",
      PARENT_OVERVIEW_GROUNDING_RULE,
      "Use only vocabulary and relationships explicitly present in the literal anchors. Do not use the agenda heading or item label as evidence for a topic, scope, action, or outcome.",
      "Do not write that the committee, council, county, or meeting addressed a topic unless the literal anchors explicitly state that institutional action. Prefer impersonal source wording when the actor or action is not explicit.",
      "If a child summary or agenda identity names a broader category than the literal anchor supports, omit the broader category and retain only the narrower source-supported topic.",
      "Return one non-empty complete summary and chapter text covering only source-supported substantive content from the complete anchor set.",
      `LITERAL_SOURCE_ANCHORS: ${parentLiteralSourceExcerpt.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes. Do not copy audit fragments or rejected wording.",
    ].join("\n\n"),
    maxOutputTokens: 720,
    temperature: attempt >= 3 ? 0 : 0.1,
    seed: seed + 12530 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeSpeakerHandoffRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves speaker-block handoffs. Return strict JSON only.",
    prompt: [
      `Conservative speaker-handoff repair attempt ${attempt} of 3.`,
      "The prior output assigned a preceding speaker block's claim to a standalone name or title callout that introduces the next speaker. Start over from the literal source excerpt.",
      SPEAKER_HANDOFF_ATTRIBUTION_RULE,
      SPEAKER_HANDOFF_EVIDENCE_PRIORITY_RULE,
      ROLE_ATTRIBUTION_FIDELITY_RULE,
      MOTION_CONTEXT_SEPARATION_RULE,
      SOURCE_QUALIFIER_FIDELITY_RULE,
      speakerHandoffEvidence
        ? `STRUCTURED SPEAKER-HANDOFF EVIDENCE: ${JSON.stringify(speakerHandoffEvidence)}`
        : "A standalone callout pattern is present in this source. Treat it as a handoff and omit the callout person's name from preceding content unless a later source line explicitly pairs that person with a claim or action.",
      "Use a generic speaker, council, committee, or meeting subject when the preceding speaker's public name is not independently supported. Preserve the source's speech act: concern or opposition is not a question unless the source asks one.",
      "Hard repair constraint: do not put the standalone callout person's name or title in the summary or chapter headline. Use no personal names or titles for the preceding block; write generic, source-grounded civic prose instead.",
      "When the audit says the bounded source ends before a motion, vote, deferral, or conclusion, omit that later procedural outcome. An uncompleted suggestion to defer is only a possible deferral raised or discussed, not a decision or motion disposition.",
      "ACTOR-AUDIT FINAL OVERRIDE: if the audit identifies unsupported names or titles, output no disputed personal name, office, title, or generic actor. Omit every speaker-specific clause that depends on the disputed attribution and retain only impersonal source-supported topics, features, procedural status, or outcomes.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION (UNTRUSTED REPAIR CONTEXT): ${rejectedClaims}` : "",
      rejectedOutput ? `REJECTED_CANDIDATE (UNTRUSTED AND BLOCKLISTED): ${rejectedOutput}` : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9988 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeReportIntroductionRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves report-introduction attribution. Return strict JSON only.",
    prompt: [
      `Conservative report-introduction attribution repair attempt ${attempt} of 3.`,
      "The prior output assigned a report introduction or presentation to the named report subject even though another source speaker introduced or framed the report. Start over from the literal source excerpt.",
      REPORT_INTRODUCTION_ATTRIBUTION_RULE,
      REPORT_INTRODUCTION_AUDIT_PRIORITY_RULE,
      CURRENT_MEETING_MINUTES_ACTION_RULE,
      "Use a generic report or meeting subject when the named report subject is not explicitly paired with the report speech. Preserve historical committee receipt, report identity, and the report's substantive facts without claiming that the named person introduced or presented it.",
      "If the source first records a historical minutes report about one subject and later records a current report about another subject, write them as separate clauses or omit one; never say the committee received one combined report covering both subjects. Keep any later carried motion attached only to the motion it follows.",
      "When a minutes span lists multiple meeting dates but the explicit motion names only one date or one subset, attach the carried approval only to that named subset. A handoff to a second part or a later report does not approve the other listed minutes.",
      "Do not use the compressed phrases 'received reports' or 'approved minutes from meetings' for a mixed minutes-and-report span. Prefer two source-faithful clauses: the minutes describe the historical report or recommendation and the explicitly named minutes motion; a separate later clause describes the current report without assigning it to the historical receipt or motion. Omit the later clause if its presenter identity is unclear.",
      attempt >= 3
        ? "Final conservative source-only repair: if the mixed historical minutes and current report cannot be kept separate without uncertain dates, names, or actors, omit those historical identity and receipt details and summarize only the clearly supported substantive report topic and facts in generic wording. Do not use a date, personal name, 'received reports', or 'approved minutes from meetings' in this repair."
        : "",
      "Keep any separate minutes action, report introduction, substantive report content, and later motion as distinct source-supported facts. Do not copy transcript speaker labels or unsupported names or roles into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(semanticGroundingSourceExcerpt || unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      attempt >= 3
        ? "FINAL OUTPUT CONTRACT FOR THIS REPAIR: return only generic substantive report content from the later report portion. Do not mention minutes, meeting dates, personal names, report receipt, recommendations to Council, or any motion or vote. Use one or two complete sentences about the report's explicitly stated subject or findings, with no presenter attribution."
        : "",
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9987 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeAdditionalBusinessRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves additional-business remarks. Return strict JSON only.",
    prompt: [
      `Conservative additional-business repair attempt ${attempt} of 3.`,
      "The prior output upgraded informal additional-business remarks into formal proposed matters or motions. Start over from the literal source excerpt.",
      ADDITIONAL_BUSINESS_REMARKS_RULE,
      ADDITIONAL_BUSINESS_AUDIT_PRIORITY_RULE,
      "Use neutral reporting verbs such as discussed, recognized, congratulated, thanked, noted, or said only when the source supports them. Do not use proposed, proposal, motion, moved, approved, carried, or decided for these remarks unless the source explicitly records that procedural action.",
      "Hard constraint: never write that the speaker proposed, submitted, introduced for consideration, or moved the two matters merely because the source says 'I just have two matters'. A safe form is that the speaker discussed additional business, congratulated Mark Perry, thanked Allison Penner, and shared a quoted observation, using only the people and topics explicitly present in the source.",
      attempt >= 3
        ? "Final fresh-source repair: discard every prior summary and write only neutral additional-business remarks from GROUNDED_SOURCE. Do not mention a proposal, motion, vote, approval, or decision unless literal source wording explicitly records one."
        : "",
      "Preserve any literal question-and-response exchange as a question and response. Do not turn laughter or an implied 'no' into a formal vote or decision.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.2,
    seed: seed + 9984 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeProceduralSelfReportRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one source-grounded civic summary that preserves procedural self-reports and tense. Return strict JSON only.",
    prompt: [
      `Conservative procedural-self-report repair attempt ${attempt} of 3.`,
      "The prior output upgraded a first-person procedural statement, future statement, or transition into a completed action or an unsupported announcement. Start over from the literal source excerpt.",
      PROCEDURAL_SELF_REPORT_RULE,
      "Use neutral wording such as 'the speaker said', 'the speaker stated', or 'the transcript records' when the source is a self-report. Preserve future or intended wording as future or intended; do not write that the speaker passed, returned, appointed, approved, or announced something unless the source explicitly records that completed speech act.",
      "Hard repair constraint: do not use 'announced', 'passed', 'passing', 'returned', or 'before' to describe the self-report or transition. A safe form is a generic transcript-recording sentence that says the source speaker stated the supported future appointment and said they would pass the gavel back; preserve any named person only when the source explicitly pairs that person with the appointment.",
      "Do not infer the speaker's name or office from an internal transcript label. Never copy transcript speaker labels or unsupported names or roles into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9986 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeProceduralFragmentRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one minimal source-grounded civic description of a procedural transcript fragment. Return strict JSON only.",
    prompt: [
      `Conservative procedural-fragment repair attempt ${attempt} of 3.`,
      "The prior output converted fragmentary agenda wording into an attributed action or substantive outcome. Start over from the literal source excerpt.",
      PROCEDURAL_FRAGMENT_RULE,
      attempt === 1
        ? "First repair pass: preserve isolated replies as reported speech or omit them; do not infer an event from a single short utterance."
        : attempt === 2
          ? "Second repair pass: discard the prior wording and audit each verb and topic against an exact source phrase before writing the replacement."
          : "Final repair pass: use only a neutral listing or transcript-recording sentence; omit any fragmentary token whose actor, topic, or action is not explicit.",
      headingLikeProceduralFragment
        ? "This is a heading-like agenda listing, not an action record. The summary must begin 'The agenda listed' and may state only the listed subject; do not describe anything as moved, confirmed, received, approved, adopted, carried, addressed, or completed."
        : "",
      "Use one neutral complete sentence or two short neutral clauses that preserve only the literal announcement, question, answer, or response. Do not name a speaker or governing body when the source does not identify one.",
      "When the fragment does not explicitly identify an actor or completed action, use a literal-description form beginning 'The transcript records' and preserve the key source wording in quotation marks instead of converting a gerund, imperative, or short reply into a past-tense action.",
      "Do not turn 'Calling the meeting to order' or 'Call for additional business' into a claimed speaker action beyond the literal announcement, and do not expand a terse response such as 'Just me' into a statement about business, intent, or outcome.",
      "A heading-only source such as 'confirmation of council minutes' lists the agenda subject but does not record that anyone moved, confirmed, received, approved, adopted, or carried it. Do not promote heading wording into an action, mover, vote, or outcome.",
      "For a heading-only fragment, use a neutral listing form such as 'The agenda listed confirmation of the council minutes.' Preserve the listed subject without adding a motion, actor, vote, or disposition.",
      "Do not use words such as addressed, handled, completed, moved, confirmed, approved, adopted, carried, or substantive unless the source explicitly records that action or result.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 or Speaker_052 into either output field. If the source has only an internal label, omit the actor and retain the literal words.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION: ${rejectedClaims}` : "",
      rejectedOutput ? `REJECTED_CANDIDATE: ${rejectedOutput}` : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9500 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeCategoryFragmentRepair = async (attempt = 1, extraInstruction = "", rejectedClaims = "", rejectedOutput = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one minimal source-grounded civic description of a short agenda-category fragment. Return strict JSON only.",
    prompt: [
      `Conservative agenda-category-fragment repair attempt ${attempt} of 3.`,
      "The prior output promoted a parallel category list and a generic procedural follow-up into a named motion, mover, vote, or carried outcome. Start over from the literal source excerpt.",
      AGENDA_CATEGORY_FRAGMENT_RULE,
      attempt === 1
        ? "First repair pass: identify the current label's category as one listed entry and omit any collective disposition that is not explicitly paired with that entry."
        : attempt === 2
          ? "Second repair pass: discard the prior wording and check every actor, motion verb, vote, and outcome against an exact source phrase; omit the generic follow-up if its subject is unclear."
          : "Final repair pass: write only neutral listing prose for the current category; do not retain any inferred mover, motion, favorable vote, passed result, or carried result.",
      "Do not write that a member moved the listed categories, that the categories passed or were carried, or that all members were in favour unless the source explicitly records that exact action for the current category.",
      "The current agenda label may identify the category, but it is not evidence that the category was moved, received, approved, adopted, or carried. If the source lists several categories and then says only 'all in favour' or 'that is carried', describe the current category as listed and say that no specific disposition is recorded for it.",
      "Use one neutral complete sentence or two short neutral clauses. Do not name a speaker or governing body when the source does not identify one for the current category.",
      "Never copy transcript speaker labels or attribution metadata such as SPEAKER_052 into either output field.",
      rejectedClaims ? `INDEPENDENT_AUDIT_REJECTION: ${rejectedClaims}` : "",
      rejectedOutput ? `REJECTED_CANDIDATE: ${rejectedOutput}` : "",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9510 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const queryConservativeAgendaTransitionRepair = async (attempt = 1, extraInstruction = "") => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Write one minimal source-grounded civic description of an agenda transition. Return strict JSON only.",
    prompt: [
      `Conservative agenda-transition repair attempt ${attempt} of 3.`,
      "The prior output treated a terse agenda-position transition as a named motion, seconder, vote, or speaker-attributed action. Start over from the literal source excerpt.",
      "State only the explicit movement or agenda position recorded in the source. Do not infer a named speaker, a seconder, a motion, a vote, approval, acclamation, or any other completed outcome.",
      "In particular, wording such as 'seconds us through fourteen' is not evidence that a named speaker seconded a motion. Preserve it only as a generic transition, and keep 'we're at fifteen' as the explicit current agenda position.",
      "Use one complete neutral sentence, such as 'The transcript records the meeting moving through item fourteen and reaching item fifteen.' Do not add an item letter, date, actor, or procedural disposition that the bounded source does not state.",
      "Never copy transcript speaker labels or unsupported names or roles into either output field.",
      extraInstruction,
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `AGENDA_LABEL: ${promptLabel}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].filter(Boolean).join("\n\n"),
    maxOutputTokens: 420,
    temperature: 0.2,
    seed: seed + 9989 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });
  const querySpeakerMetadataRepair = async (phase = "", attempt = 1) => callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Rewrite grounded civic prose without transcript metadata. Return strict JSON only.",
    prompt: [
      `Speaker-metadata retry ${phase} ${attempt}: the candidate exposed an internal transcript speaker identifier.`,
      "Rewrite the candidate summary and chapter text without changing its supported facts, action, outcome, timing, amount, or relationship. Remove every token matching SPEAKER_ followed by an identifier or Speaker followed by an identifier, and remove any actor attribution that depends only on that internal label.",
      "Use a generic speaker, council, committee, staff, report, or meeting subject when the actor is not independently supported. Do not copy speaker labels from the source excerpt into either output field.",
      "Return exactly one JSON object with summary, chapter text, confidence, and notes.",
      `CANDIDATE_SUMMARY: ${normalizeText(summary)}`,
      `CANDIDATE_CHAPTER_TEXT: ${normalizeText(parsed?.["chapter text"] || "")}`,
      `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
    ].join("\n\n"),
    maxOutputTokens: 720,
    temperature: 0.1,
    seed: seed + 8000 + attempt,
    format: STAGE3_SUMMARY_RESPONSE_FORMAT,
  });

  let parsed = null;
  try {
    parsed = await queryParsed();
  } catch (err) {
    throw new Error(
      `stage3 retryable: configured text model unavailable at ${ollamaUrl} (${normalizeText(String(err?.message || err)).slice(0, 200)})`,
    );
  }
  let rawSummary = normalizeText(parsed?.summary || "");
  assertCleanStage3Text(rawSummary, "stage3 summary");
  let summary = enforceSummaryBudget(rawSummary, budget);
  if (!summary) {
    parsed = await queryParsed(
      "Retry requirement: summary must contain at least one complete, factual sentence grounded in the source excerpt and ending with sentence punctuation. Do not return a fragment or an empty summary.",
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 complete-sentence retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (!summary && rawSummary) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      system: "You rewrite generated civic-report fragments as complete factual sentences. Return strict JSON only.",
      prompt: [
        "Rewrite the generated fragment into one or two complete grammatical sentences ending with sentence punctuation.",
        "Use an explicit civic subject and finite reporting verb. Do not copy the fragment unchanged or return a list of noun phrases.",
        "Preserve its facts and numeric values, and do not add facts.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `GENERATED_FRAGMENT: ${rawSummary}`,
      ].join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 fragment rewrite");
    summary = enforceSummaryBudget(rawSummary, budget);
  }

  // Parent overviews and large bounded source chunks must carry enough of
  // their available context to avoid reducing a report to its opening line.
  const longTier = requiresExpandedOverview;
  for (let expansionAttempt = 1; longTier && splitSentences(summary).length < 2 && expansionAttempt <= 3; expansionAttempt += 1) {
    parsed = await queryParsed(
      `Long-tier retry ${expansionAttempt}: return 3 to 5 separate complete sentences covering item, substance, and outcome from this grounded span only. Use a period between sentences.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 summary retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (longTier && splitSentences(summary).length < 2 && summary) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      system: "Rewrite one grounded civic-report sentence as multiple complete sentences. Return strict JSON only.",
      prompt: [
        "Rewrite the generated summary as 2 or 3 separate complete sentences with periods between them.",
        "Preserve every supported fact and numeric value. Do not add facts, conclusions, or quantities.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `GENERATED_SUMMARY: ${summary}`,
        `GENERATED_CHAPTER_TEXT: ${normalizeText(parsed?.["chapter text"] || "")}`,
        `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000))}`,
      ].join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 multi-sentence rewrite");
    summary = enforceSummaryBudget(rawSummary, budget);
  }

  const transcriptSpeakerIdentifierAppears = () => /\bSPEAKER[_ ]?[0-9][0-9A-Z]*\b/iu.test(
    `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
  );
  const repairSpeakerMetadata = async (phase = "") => {
    for (let speakerRetry = 1; transcriptSpeakerIdentifierAppears() && speakerRetry <= 4; speakerRetry += 1) {
      parsed = await querySpeakerMetadataRepair(phase, speakerRetry);
      rawSummary = normalizeText(parsed?.summary || "");
      assertCleanStage3Text(rawSummary, `stage3 speaker-metadata ${phase} retry`);
      summary = enforceSummaryBudget(rawSummary, budget);
    }
  };
  const documentSpeakerAttributionAppears = () => documentSourceOnly
    && /\b(?:the|a|one)\s+speaker\b|\bspeaker\s+(?:reported|said|asked|answered)\b/iu.test(
      `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
    );
  const repairDocumentSpeechAct = async (phase = "") => {
    for (let documentRetry = 1; documentSpeakerAttributionAppears() && documentRetry <= 4; documentRetry += 1) {
      parsed = await queryParsed([
        `Document speech-act repair ${phase} attempt ${documentRetry}: the candidate uses generic meeting-speaker attribution for static document or correspondence content.`,
        "Regenerate both fields from the literal document source.",
        "Never use speaker, the speaker, a speaker, asked, answered, or live meeting dialogue for an email, notice, order, report, or attachment unless the document explicitly records that event.",
        "For email content, identify the explicit sender as the email, correspondence, party, organization, or Customer Service Team; use neutral wording such as 'The email reported' when the sender's role is not otherwise needed.",
        "Return a non-empty factual summary and a complete chapter headline. Do not add facts.",
      ].join(" "), { seed: seed + 6100 + documentRetry });
      rawSummary = normalizeText(parsed?.summary || "");
      assertCleanStage3Text(rawSummary, `stage3 document speech-act ${phase} retry`);
      summary = enforceSummaryBudget(rawSummary, budget);
      if (!summary) {
        throw new Error(`stage3 retryable: document speech-act repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
      }
    }
  };
  const repairStructuredDateIdentity = async (phase = "") => {
    for (let dateRetry = 1; dateRetry <= 3; dateRetry += 1) {
      const conflict = conflictingStructuredDateClaim(
        `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
        structuredIdentityLabel,
      );
      if (!conflict) return;
      parsed = consentAgendaScopeOnly
        ? await queryConservativeConsentAgendaScopeRepair(
          dateRetry,
          "Structured-date repair: preserve the literal consent-agenda ranges and exceptions; omit later pulled-item outcomes.",
        )
        : minutesMotionScopeOnly
        ? await queryConservativeMinutesMotionScopeRepair(
          dateRetry,
          `Structured-date repair: preserve the generic move-and-vote wording and omit any later committee's minutes action.`,
        )
        : minutesHandoffOnly
        ? await queryConservativeMinutesHandoffRepair(
          dateRetry,
          `Structured-date repair: omit the conflicting transcript or ASR date and all handoff qualifiers. Do not copy the rejected date or claim any completed minutes action.`,
        )
        : await queryFreshGroundedRepair(
          `Authoritative structured-identity date repair ${phase} ${dateRetry}: ${conflict} Remove the conflicting transcript or ASR date from summary and chapter text, then use the authoritative agenda date or omit the date. Do not copy the rejected date.`,
          dateRetry,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
      rawSummary = normalizeText(parsed?.summary || "");
      assertCleanStage3Text(rawSummary, `stage3 structured-date ${phase} retry`);
      summary = enforceSummaryBudget(rawSummary, budget);
      if (!summary) {
        throw new Error(`stage3 retryable: structured-date repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
      }
      await repairSpeakerMetadata(`structured-date ${phase} ${dateRetry}`);
    }
    const unresolved = conflictingStructuredDateClaim(
      `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
      structuredIdentityLabel,
    );
    if (unresolved) {
      throw new Error(`stage3 retryable: generated prose conflicts with authoritative structured date for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
    }
  };
  await repairSpeakerMetadata("initial");
  await repairDocumentSpeechAct("initial");
  await repairStructuredDateIdentity("initial");
  if (transcriptSpeakerIdentifierAppears()) {
    throw new Error(`stage3 retryable: configured text model exposed an internal transcript speaker identifier for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
  }

  if (semanticGroundingAudit && causalPurposeConstructionDefect(`${summary} ${normalizeText(parsed?.["chapter text"] || "")}`)) {
    let causalAudit = await auditCausalRelationshipLlm({
      label: promptLabel,
      summary: `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: semanticGroundingSourceExcerpt,
      llmModel,
      ollamaUrl,
    });
    for (let causalAttempt = 1; !causalAudit.grounded && causalAttempt <= 2; causalAttempt += 1) {
      const causalClaims = causalAudit.unsupportedClaims.length
        ? causalAudit.unsupportedClaims.join(" | ")
        : causalAudit.notes || "the candidate connects a proposal to a nearby benefit without an explicit source pairing";
      parsed = await queryConservativeCausalRelationshipRepair(
        causalAttempt,
        causalClaims,
        JSON.stringify({
          summary: normalizeText(summary),
          "chapter text": normalizeText(parsed?.["chapter text"] || ""),
        }),
      );
      rawSummary = normalizeText(parsed?.summary || "");
      assertCleanStage3Text(rawSummary, `stage3 causal relationship ${causalAttempt}`);
      summary = enforceSummaryBudget(rawSummary, budget);
      if (!summary) {
        throw new Error(`stage3 retryable: causal relationship repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
      }
      await repairSpeakerMetadata(`causal relationship ${causalAttempt}`);
      await repairDocumentSpeechAct(`causal relationship ${causalAttempt}`);
      causalAudit = await auditCausalRelationshipLlm({
        label: promptLabel,
        summary: `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`,
        sourceExcerpt: semanticGroundingSourceExcerpt,
        llmModel,
        ollamaUrl,
      });
    }
  }

  let numericConflictRepairActive = false;
  let numericSpecificityRepairActive = false;
  let deferralObjectRepairActive = false;
  if (semanticGroundingAudit) {
    let groundingAudit = await auditAndAdjudicateGroundedSummary({
      label: promptLabel,
      summary,
      sourceExcerpt: semanticGroundingSourceExcerpt,
      llmModel,
      ollamaUrl,
      governingBody,
      motionEvidence: ordinalMotionEvidence,
      amendmentEvidence,
      speakerHandoffEvidence,
      documentSourceOnly,
      numericConflictRepairActive,
      deferralObjectRepairActive,
    });
    for (let groundingAttempt = 1; !groundingAudit.grounded && groundingAttempt <= 3; groundingAttempt += 1) {
      const rejectedClaims = groundingAudit.unsupportedClaims.length
        ? groundingAudit.unsupportedClaims.join(" | ")
        : groundingAudit.notes || "the candidate contains a claim not supported by this source excerpt";
      const auditFeedback = [rejectedClaims, groundingAudit.notes].filter(Boolean).join(" | ");
      const rejectedOutput = JSON.stringify({
        summary: normalizeText(summary),
        "chapter text": normalizeText(parsed?.["chapter text"] || ""),
      });
      const actorAttributionConflict = /\b(?:candidate|summary|output)\b[\s\S]{0,220}\b(?:attribut(?:e|es|ed|ion)|assign(?:ed|s)?|named?)\b[\s\S]{0,400}\b(?:but|however|instead|unsupported|does\s+not|not\s+record|conflict|wrong|incorrect(?:ly)?|fails?\s+to\s+distinguish|delivered\s+by|presented\s+by|explicitly\s+identif(?:y|ies|ied))\b/iu.test(auditFeedback);
      const roleAttributionRepairOnly = !speakerHandoffCandidate
        && /\b(?:speaker|actor|role|attribution|addressee|council\s+member|councillor|mayor|staff)\b/iu.test(
        `${rejectedClaims} ${groundingAudit.notes || ""}`,
      ) && !proceduralFragmentOnly;
    const generatedProse = `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`;
      const sourceExplicitlyRecordsSeconding = /\b(?:seconded|seconder)\b/iu.test(semanticGroundingSourceExcerpt);
      const candidateClaimsSecondingWithoutSource = /\b(?:seconded|seconder)\b/iu.test(generatedProse)
        && !sourceExplicitlyRecordsSeconding;
      const proceduralFloorDefect = /\b(?:placing|placed|bringing|brought|putting|put)\s+(?:the\s+)?(?:item|motion)\b[\s\S]{0,100}\bfloor\s+for\s+discussion\b/iu.test(generatedProse)
        || /\b(?:moved)\s+(?:the\s+)?(?:item|motion)\b[\s\S]{0,100}\b(?:onto|on|to)\s+the\s+floor\s+for\s+discussion\b/iu.test(generatedProse)
        || /\b(?:mover|member|councillor|chair|participant|speaker)\b[\s\S]{0,80}\b(?:placed|brought|put|moved)\b[\s\S]{0,100}\bfloor\s+for\s+discussion\b/iu.test(generatedProse);
      const proceduralFloorSequenceDefect = /floor\s+(?:was|is)\s+(?:opened|put|placed)\s+for\s+consideration|discussion\s+(?:proceeded|occurred|took\s+place)\b|before\s+(?:concluding|the\s+call)\s+for\s+votes?|call\s+for\s+votes?\b[\s\S]{0,100}\b(?:discussion|debate)\b/iu.test(`${generatedProse} ${auditFeedback}`);
      const incompleteDeferralDefect = /\b(?:motion\s+to\s+defer|could\s+be\s+deferred|will\s+to\s+postpone|possible\s+deferral|defer(?:red|ral)?)\b/iu.test(`${summary} ${normalizeText(parsed?.["chapter text"] || "")} ${auditFeedback}`)
        && /\b(?:no\s+explicit|no\s+formal|would\s+need\s+a\s+motion|ends?\s+(?:abruptly|mid)|incomplete|not\s+(?:a\s+)?formal|not\s+(?:moved|seconded|carried)|no\s+disposition|conditional\s+suggestion|source\s+(?:text\s+)?ends?)\b/iu.test(auditFeedback);
      const incompleteProposalDefect = /\b(?:amend(?:ment)?|proposal|refer(?:ral|red)?|joint\s+committee)\b/iu.test(`${summary} ${normalizeText(parsed?.["chapter text"] || "")} ${auditFeedback}`)
        && /\b(?:cuts?\s+off|ends?\s+(?:abruptly|mid)|incomplete|not\s+explicitly\s+supported|not\s+(?:a\s+)?formal|does\s+not\s+record|source\s+(?:text\s+)?ends?|missing\s+(?:object|continuation)|truncated|suggest(?:ed|ing)|specific\s+content|proposed\s+amendment)\b/iu.test(auditFeedback);
      const auditNumericValues = [...auditFeedback.matchAll(/\b(?:19|20)\d{2}\b|\b\d[\d,]*(?:\.\d+)?\b/gu)]
        .map((match) => match[0])
        .filter((value, index, values) => values.indexOf(value) === index);
      const auditExplicitlyPairsCandidateAndSource = (
        /\b(?:candidate|generated|summary|prose|claim)\b[\s\S]{0,600}\b(?:source|transcript|excerpt)\b/iu.test(auditFeedback)
        || /\b(?:source|transcript|excerpt)\b[\s\S]{0,600}\b(?:candidate|generated|summary|prose|claim)\b/iu.test(auditFeedback)
        || (/\b(?:candidate|generated|summary|prose|claim)\b/iu.test(auditFeedback)
          && /\b(?:source|transcript|excerpt)\b/iu.test(auditFeedback))
      );
      const sourceNumericValues = [...stripTranscriptSpeakerIdentifiers(semanticGroundingSourceExcerpt).matchAll(/\b(?:19|20)\d{2}\b|\b\d[\d,]*(?:\.\d+)?\b/gu)]
        .map((match) => match[0])
        .filter((value, index, values) => values.indexOf(value) === index);
      const hasCompetingSourceNumericValues = auditNumericValues.some((value) => sourceNumericValues.includes(value))
        && sourceNumericValues.some((value) => !auditNumericValues.includes(value));
      const auditNumericDisagreement = auditNumericValues.length > 0
        && /\b(?:incorrect|wrong|mismatch|discrepanc(?:y|ies)|contradict(?:ed|s|ing|ory|ion)?|vague|less\s+precise|not\s+(?:the\s+)?(?:exact|correct)|explicit(?:ly)?|exact|specific)\b/iu.test(auditFeedback)
        && /\b(?:date|year|amount|number|numeric|figure|value|funding|budget|expenditure|financial|ordinal|meeting)\b/iu.test(auditFeedback);
      const numericConflictDefect = (
        /\b(?:contradict(?:ed|s|ing|ory|ion)?|conflict(?:ed|s|ing)?|ambig(?:uous|uity)|uncertain|mismatch|discrepanc(?:y|ies)?|ASR)\b/iu.test(auditFeedback)
        || (auditExplicitlyPairsCandidateAndSource && auditNumericValues.length >= 2)
        || (auditExplicitlyPairsCandidateAndSource && hasCompetingSourceNumericValues)
        || auditNumericDisagreement
      )
        && /\b(?:numeric|number|date|year|amount|budget|expenditure|financial|ordinal|202\d|19\d{2})\b/iu.test(`${auditFeedback} ${generatedProse}`);
      const numericSpecificityDefect = /\b(?:unspecified|unknown|unclear|not\s+(?:specified|given|provided))\b/iu.test(generatedProse)
        && ( /\d/iu.test(stripTranscriptSpeakerIdentifiers(semanticGroundingSourceExcerpt)) || auditNumericValues.length > 0 )
        && (
          numericSpecificityRepairActive
          || /\b(?:explicit(?:ly)?\s+(?:stated|provided|identified)|source\s+(?:provides|contains|explicitly)|exact\s+(?:figures|amounts|values)|specific\s+amounts?)\b/iu.test(auditFeedback)
          || (auditNumericValues.length > 0 && /\b(?:source|candidate|amount|number|figure|value|numeric|budget|financial)\b/iu.test(auditFeedback))
        );
      const parentScopeDefect = Boolean(parentOverviewGenerationContract)
        && /\b(?:not\s+supported|unsupported|no\s+(?:mention|record|statement)|does\s+not\s+(?:mention|record|state)|scope|broader|narrower)\b/iu.test(auditFeedback);
      const questionScopeDefect = Boolean(parentOverviewGenerationContract)
        && /\b(?:question|asked|inquir(?:y|ed))\b[\s\S]{0,520}\b(?:primary\s+subject|specific\s+(?:department|scope|matter)|context|broader|narrower|too\s+broad|too\s+narrow)\b/iu.test(auditFeedback);
      const deferralSubjectDefect = /\b(?:defer(?:red|ral|ring)?|postpon(?:e|ed|ement))\b/iu.test(auditFeedback)
        && /\b(?:discussion|main\s+motion|subject|underlying\s+action|procedural\s+meaning|incorrect(?:ly)?|changes?\s+the\s+meaning|scope)\b/iu.test(auditFeedback);
      const incompleteNarrativeHandoffDefect = /\b(?:handoff|continuation|begins?\s+mid[-\s]?sentence|mid[-\s]?phrase|not\s+fully\s+recorded|bounded\s+window)\b/iu.test(auditFeedback)
        && /\b(?:present(?:ed|ation)?|narrative|report|full\s+report)\b/iu.test(auditFeedback)
        && /\b(?:does\s+not\s+explicitly|not\s+explicitly|only|continuation|mid[-\s]?sentence)\b/iu.test(auditFeedback);
      const completedSpeechActDefect = (
        /\b(?:implies?|suggests?|contradicts?)\b[\s\S]{0,180}\b(?:completed|approval|approved|carried|decision|outcome|justification)\b/iu.test(auditFeedback)
          || /\b(?:not|does\s+not)\b[\s\S]{0,160}\b(?:completed|approval|approved|justification)\b/iu.test(auditFeedback)
          || /\b(?:not|does\s+not)\s+record(?:ed)?\b[\s\S]{0,160}\b(?:motion|outcome)\b/iu.test(auditFeedback)
      ) && /\b(?:proposal|proposed|question|discussion|not\s+(?:recorded|approved)|only)\b/iu.test(auditFeedback);
      const sourceConditionalRecommendation = conditionalDeferralRecommendationSource(semanticGroundingSourceExcerpt)
        || (/\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt)
          && /\b(?:deferr|postpon|refer|recommend|action|matter)\w*/iu.test(semanticGroundingSourceExcerpt));
      const candidateUpgradesRecommendation = /\b(?:recommendation\s+(?:to\s+[^.?!]{0,120}\s+)?(?:was\s+)?(?:raised|made|given)|made\s+a\s+recommendation|recommend(?:ed|ation)?\s+(?:was\s+)?(?:adopted|approved|carried)|recommend(?:ed|s)?\s+(?:a\s+)?(?:deferral|postponement|referral)|(?:motion|deferral)\s+(?:was\s+)?(?:made|carried|approved))\b/iu.test(`${generatedProse} ${auditFeedback}`);
      const candidateGenericRecommendation = /\b(?:a|the)\s+speaker\s+(?:recommended|would\s+recommend)\b/iu.test(generatedProse);
      const recommendationSpeechActDefect = (
        /\b(?:would|could)\s+recommend\b/iu.test(auditFeedback)
          && /\b(?:does\s+not\s+imply|not\s+(?:a\s+)?formal|not\s+(?:a\s+)?(?:motion|second|carried|approved)|conditional|first[-\s]?person|speech\s+act)\b/iu.test(auditFeedback)
      ) || (sourceConditionalRecommendation && (candidateUpgradesRecommendation || candidateGenericRecommendation))
        || (/\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt)
          && /\b(?:recommendation|recommend(?:ed|s)?)\b/iu.test(`${generatedProse} ${auditFeedback}`));
      const unsupportedSecondingDefect = (
        /\b(?:seconded|seconder)\b/iu.test(auditFeedback)
          && /\b(?:does\s+not\s+(?:record|state)|not\s+(?:record|state)|no\s+(?:explicit\s+)?(?:second|seconder)|unsupported)\b/iu.test(auditFeedback)
      ) || (candidateClaimsSecondingWithoutSource && !shortAgendaTransitionOnly);
      const futureExpectationDefect = /\b(?:expect(?:ed|s|ation)?|next\s+report|future\s+(?:content|action|step))\b/iu.test(auditFeedback)
        && /\b(?:rather\s+than|not|does\s+not|instead|unsupported)\b[\s\S]{0,220}\b(?:recommend(?:ation)?|motion|formally|propos(?:ed|al))\b/iu.test(auditFeedback);
      const conditionalRelationshipDefect = /\b(?:conditional|hypothetical|if[-\s]?clause|if\s+[^.?!]{0,180}\b(?:would|could|may|might)\b)\b/iu.test(auditFeedback)
        && /\b(?:ongoing|current|unconditional|present\s+fact|stated\s+as|misrepresent(?:ed|ation)?|incorrect(?:ly)?|not\s+(?:conditional|hypothetical)|without\s+(?:the\s+)?condition|already|occurred|proceed(?:ed|ing)?)\b/iu.test(auditFeedback);
      const tentativeMotionDefect = /\b(?:do\s+i\s+have\s+a\s+mover|asks?\s+for\s+a\s+mover|question(?:s|ed)?[\s\S]{0,40}\bmover\b|think(?:s)?\s+(?:she|he|they|i)\s+(?:will|might|may)\s+move|(?:will|might|may)\s+move|on\s+the\s+floor)\b/iu.test(auditFeedback)
        && /\b(?:does\s+not\s+(?:explicitly\s+)?record|does\s+not\s+(?:explicitly\s+)?state|only\s+records?|bounded\s+excerpt|truncat(?:ed|ion)|transcript\s+ends?|source\s+(?:text\s+)?ends?|ends?\s+(?:immediately|before)|before\s+(?:recording|an\s+explicit|a\s+formal)|end\s+of\s+(?:the\s+)?source\s+window|source\s+window)\b/iu.test(auditFeedback)
        && /\b(?:motion|moved|carried|seconded|disposition|mover)\b/iu.test(auditFeedback);
      const proceduralActorPairingDefect = /\b(?:mover|moved|seconded|seconder)\b/iu.test(auditFeedback)
        && /\b(?:misattribut(?:e|es|ed|ion)|misidentif(?:y|ies|ied|ication)|joint(?:ly)?|together|only\s+(?:one|a\s+single)|spelling|name\s+(?:mismatch|conflict|correction)|source\s+says)\b/iu.test(auditFeedback);
      const separateMotionOutcomeDefect = (
        /\b(?:separate|distinct|unrelated|different)\b[\s\S]{0,320}\b(?:motion|outcome|carried|disposition)\b/iu.test(auditFeedback)
        || /\b(?:motion|outcome|carried|disposition)\b[\s\S]{0,320}\b(?:separate|distinct|unrelated|different)\b/iu.test(auditFeedback)
      ) && /\b(?:no|not|does\s+not|incorrect(?:ly|)|wrong(?:ly)?|following|after|later|subsequent)\b/iu.test(auditFeedback);
      const causalRelationshipDefect = /\b(?:causal\s+(?:link|relationship|relationships)|causal(?:ity)?|cause(?:s|d|ing)?|reason|motivation|purpose|primary\s+(?:reason|motivation|case))\b/iu.test(auditFeedback)
        && /\b(?:not\s+(?:explicitly\s+)?state(?:d)?|does\s+not\s+(?:explicitly\s+)?state|unsupported|implies?|inferred|incorrect(?:ly)?|not\s+the|no\s+explicit)\b/iu.test(auditFeedback)
        && causalRelationshipConstructionDefect(generatedProse);
      const sourceTopicRelationshipDefect = sourceTopicRelationshipGroundingDefect(auditFeedback)
        && /\b(?:recommend(?:ation|ed|s)?|proposal|merit|explore|platform|topic|action|subject|object|qualifier|modifier|phrase)\b/iu.test(generatedProse);
      const actingBodyAttributionDefect = /\b(?:acting\s+body|body\s+label|institutional\s+(?:actor|subject)|committee\s+itself|council\s+itself|rather\s+than\s+a\s+(?:generic\s+)?speaker|does\s+not\s+identify\s+the\s+speaker)\b/iu.test(auditFeedback)
        && /\b(?:call(?:ed)?|order|open(?:ed)?|announce(?:d)?|present(?:ed)?|ask(?:ed)?|said|speech)\b/iu.test(auditFeedback);
      const institutionalActorDefect = institutionalActorGroundingDefect(auditFeedback);
      const referredAgendaScopeDefect = referredAgendaScopeGroundingDefect(auditFeedback);
      const genericPluralActorDefect = genericPluralActorGroundingDefect(auditFeedback);
      const unsupportedQualifierDefect = unsupportedQualifierGroundingDefect(auditFeedback)
        && !institutionalActorDefect;
      const fragmentedTranscriptDefect = fragmentedTranscriptGroundingDefect(auditFeedback)
        && !institutionalActorDefect;
      const separateDiscussionDefect = mergedDiscussionScopeGroundingDefect(auditFeedback)
        && /\b(?:discussion|discussed|conversation|remarks?|topics?)\b/iu.test(generatedProse);
      const collectiveActorDefect = collectiveActorGroundingDefect(auditFeedback)
        && !institutionalActorDefect;
      const unsupportedSpeechActDefect = /\b(?:does\s+not\s+explicitly\s+(?:record|state|contain)|not\s+explicitly\s+(?:recorded|stated)|not\s+in\s+the\s+(?:manner|form)|source\s+(?:does\s+not|never)\s+(?:record|state|contain)|not\s+(?:actually\s+)?present)\b/iu.test(auditFeedback)
        && /\b(?:support(?:ed|s|ing)?|propos(?:e|ed|es|ing|al)|share(?:d|ing)?\s+(?:a\s+)?conversation)\b/iu.test(generatedProse);
      const qualifiedSupportDefect = /\b(?:would|could)\s+support\b|\b(?:conditional|qualified|unconditional)\s+support\b/iu.test(auditFeedback)
        && /\b(?:support(?:ed|s)?|support)\b[\s\S]{0,240}\b(?:request(?:ed|s)?|question(?:ed|s)?|more\s+information|information\s+request)\b/iu.test(`${generatedProse} ${auditFeedback}`);
      const mixedQualifiedSpeechActSource = /\b(?:would|could)\s+support\b/iu.test(semanticGroundingSourceExcerpt)
        && /\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt);
      const mixedQualifiedSpeechActCandidate = /\b(?:support|supported|supporting)\b/iu.test(generatedProse)
        && /\b(?:recommendation|recommend(?:ed|s)?)\b/iu.test(generatedProse);
      const motionSubjectDefect = /\b(?:motion|deferral|moved|carried|seconded)\b/iu.test(auditFeedback)
        && /\b(?:motion\s+subject|subject|inaccurate|does\s+not\s+explicitly\s+identify|not\s+(?:the\s+)?subject|condition|refers\s+to\s+the\s+condition|related\s+topic|not\s+on\s+the\s+floor|procedural\s+(?:nature|discussion)|does\s+not\s+explicitly\s+state\s+that\s+(?:this|the)\s+(?:specific\s+)?motion|specific\s+motion)\b/iu.test(auditFeedback);
      const proceduralPairingDefect = /\b(?:does\s+not\s+record|no\s+(?:explicit\s+)?(?:second|vote|disposition)|only\s+(?:states?|says?)\b.{0,80}\bfloor\s+for\s+discussion|not\s+(?:a\s+)?formal|formal\s+(?:pairing|procedural)|put\s+to\s+a\s+vote)\b/iu.test(auditFeedback)
        && /\b(?:motion|moved|seconded|floor|procedural|vote|disposition)\b/iu.test(auditFeedback);
      if (numericConflictDefect) numericConflictRepairActive = true;
      if (numericSpecificityDefect) numericSpecificityRepairActive = true;
      if (deferralSubjectDefect) deferralObjectRepairActive = true;
      parsed = incompleteDeferralDefect
        ? await queryConservativeIncompleteDeferralRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : deferralSubjectDefect
        ? await queryUnsupportedDeferralSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : numericConflictDefect
        ? await queryConservativeNumericConflictRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : conditionalRelationshipDefect
        ? await queryConservativeConditionalRelationshipRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : causalRelationshipDefect
        ? await queryConservativeCausalRelationshipRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : sourceTopicRelationshipDefect
        ? await queryConservativeSourceTopicRelationshipRepair(groundingAttempt, auditFeedback)
        : numericSpecificityDefect
        ? await queryConservativeNumericSpecificityRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : referredAgendaScopeDefect
        ? await queryConservativeReferredAgendaScopeRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : unsupportedSpeechActDefect
        ? await queryConservativeUnsupportedSpeechActRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : separateDiscussionDefect
        ? await queryConservativeSeparateDiscussionRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : fragmentedTranscriptDefect
        ? await queryConservativeFragmentedSourceRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : unsupportedQualifierDefect
        ? await queryConservativeUnsupportedQualifierRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : genericPluralActorDefect
        ? await queryConservativeGenericPluralActorRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : qualifiedSupportDefect || ((mixedQualifiedSpeechActSource || mixedQualifiedSpeechActCandidate) && recommendationSpeechActDefect)
        ? await queryConservativeQualifiedSupportRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : tentativeMotionDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : recommendationSpeechActDefect && sourceConditionalRecommendation
        ? await queryConservativeIncompleteDeferralRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : recommendationSpeechActDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : proceduralActorPairingDefect
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the source explicitly separates the mover from the seconder, but the audit disputes a mover name, spelling, or joint-action attribution. Omit all personal mover and seconder names and do not say that the participants moved the motion together. Preserve only impersonal source-supported motion subject, action, and disposition; do not merge the mover and seconder roles.",
          auditFeedback,
          rejectedOutput,
        )
        : incompleteNarrativeHandoffDefect
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the bounded source is an incomplete narrative continuation or handoff, not evidence of a completed presentation or full report. Omit any presentation, report-delivery, or named-speaker claim that is not explicitly completed in the source. Retain only neutral source-supported continuation or topic wording.",
          auditFeedback,
          rejectedOutput,
        )
        : completedSpeechActDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : unsupportedSecondingDefect
        ? await queryUnsupportedSecondingRepair(groundingAttempt)
        : questionScopeDefect
        ? await queryConservativeParentOverviewScopeRepair(groundingAttempt)
        : collectiveActorDefect && parentOverviewGenerationContract
        ? await queryConservativeParentOverviewRepair(
          groundingAttempt,
          "Grounding repair: the audit distinguishes separate individual remarks from an unsupported collective or generic actor. Preserve complete parent topic coverage, but do not say that Directors, staff, a team, a group, a committee, or another aggregate subject performed the disputed action. Use impersonal source wording or omit only the unsupported actor/action clause.",
          auditFeedback,
          rejectedOutput,
        )
        : collectiveActorDefect
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the source names separate individual remarks, not a collective speaker. Do not merge them into 'Directors discussed', 'staff noted', or another group action. Preserve supported topics in impersonal wording and omit the unsupported collective actor/action clause.",
          auditFeedback,
          rejectedOutput,
        )
        : parentScopeDefect && !institutionalActorDefect
        ? await queryConservativeParentOverviewScopeRepair(groundingAttempt)
        : institutionalActorDefect && parentOverviewGenerationContract
        ? await queryConservativeParentOverviewRepair(
          groundingAttempt,
          "Grounding repair: preserve complete parent topic coverage from the audited child summaries and literal anchors, but remove unsupported institutional actor/action framing. Use impersonal source wording for any recommendation, report reading, or fact whose speaker or institutional actor is not explicitly paired in the literal anchor.",
          auditFeedback,
          rejectedOutput,
        )
        : institutionalActorDefect
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the audit says an institutional committee, council, body, office, or department was incorrectly assigned a presentation, noting, direction, statement, recommendation, reading, or approval action. Use impersonal source-supported wording and omit the unsupported institutional actor/action pairing. If the same audit also mentions floor status or a vote, preserve only the source-supported motion and disposition without inferring discussion.",
          auditFeedback,
          rejectedOutput,
        )
        : proceduralFloorDefect || proceduralFloorSequenceDefect
        ? await queryProceduralFloorRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : futureExpectationDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : separateMotionOutcomeDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : actingBodyAttributionDefect
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the audit says the acting body was incorrectly used as the speaker for a procedural announcement. Keep the source-supported meeting status, omit the body-as-speaker pairing, and do not invent a named or generic actor unless the source explicitly supports it.",
          auditFeedback,
          rejectedOutput,
        )
        : actorAttributionConflict
        ? await queryConservativeRoleAttributionRepair(
          groundingAttempt,
          "Grounding repair: the audit reports a conflicting or unsupported named actor. Omit every disputed personal name, title, role, and actor-specific clause; retain only impersonal source-supported content and preserve conditional or tentative speech acts without assigning them to another actor.",
          auditFeedback,
          rejectedOutput,
        )
        : incompleteProposalDefect
        ? await queryConservativeIncompleteProposalRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : motionSubjectDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : proceduralPairingDefect
        ? await queryConservativeMotionSubjectRepair(groundingAttempt, auditFeedback, rejectedOutput)
        : documentSourceOnly
        ? await queryParsed([
          `Document-only grounding repair ${groundingAttempt}: ${rejectedClaims}`,
          "Start over from the literal attachment, document, or correspondence source. Preserve every source-supported document actor and speech act, but do not use generic meeting-speaker wording.",
          "Keep separately listed requests separate and do not introduce causal wording such as due to or because unless the document explicitly states that relationship.",
        ].join(" "), { seed: seed + 6200 + groundingAttempt })
        : consentAgendaScopeOnly
        ? await queryConservativeConsentAgendaScopeRepair(
          groundingAttempt,
          `Grounding repair: preserve the literal receive range, approval range, and exceptions; do not repeat any narrowed, expanded, or later pulled-item outcome. REJECTED_CLAIMS: ${rejectedClaims}. REJECTED_CANDIDATE: ${rejectedOutput}`,
        )
        : minutesMotionScopeOnly
        ? await queryConservativeMinutesMotionScopeRepair(
          groundingAttempt,
          `Grounding repair: keep the current labeled minutes separate from any later named committee; do not repeat unsupported receipt, approval, or later-minutes claims. REJECTED_CLAIMS: ${rejectedClaims}. REJECTED_CANDIDATE: ${rejectedOutput}`,
        )
        : minutesHandoffOnly
        ? await queryConservativeMinutesHandoffRepair(groundingAttempt)
        : absenceListingOnly
          ? await queryConservativeAbsenceListingRepair(
            groundingAttempt,
            "Grounding repair: keep only the first current-item absence listing and omit all trailing next-item context.",
            )
        : decisionSequenceOnly
          ? await queryConservativeDecisionSequenceRepair(
            groundingAttempt,
            "Grounding repair: preserve the two distinct motions and the named matter identified by the source; do not repeat a generalized or merged outcome.",
            )
        : reportedActionSeparationOnly
          ? await queryConservativeReportedActionRepair(
            groundingAttempt,
            "Grounding repair: preserve separate historical approval and current report receipt; do not repeat any current-meeting approval claim.",
            )
        : publicCommentPlanAmendmentOnly
          ? await queryConservativePublicCommentRepair(
            groundingAttempt,
            "Grounding repair: preserve public comments as comments and keep any current recommendation outcome separate; do not repeat an unsupported defeated-motion claim.",
          )
        : proposalOptionScopeOnly
          ? await queryConservativeOptionMotionRepair(
            groundingAttempt,
            "Grounding repair: keep each option or proposed change separate from historical, later, or unrelated motions; omit any disposition not explicitly paired with that option in this source span.",
            rejectedClaims,
            rejectedOutput,
          )
        : reportProposalScopeOnly
          ? await queryConservativeReportProposalRepair(
            groundingAttempt,
            "Grounding repair: preserve the report's exact proposal framing, then state the later defeated, amended, or contrary motion as a separate source-supported layer; do not return a proposal-only summary or invent the later motion's outcome.",
            )
        : multiBoundaryRelationshipOnly
          ? await queryConservativeMultiBoundaryRepair(
            groundingAttempt,
            "Grounding repair: preserve every source-stated boundary or omit the narrowed location claim rather than repeating it.",
          )
        : ordinalMotionSequenceOnly
          ? await queryConservativeOrdinalMotionSequenceRepair(
            groundingAttempt,
            "Grounding repair: preserve each motion and its directly paired subject and outcome; an explicit 'that motion is defeated' controls even when a preceding count appears to suggest otherwise, and a later carried motion cannot be assigned backward. Do not merge the clarification question with later motion text.",
          )
        : parentOverviewGenerationContract
        ? await queryConservativeParentOverviewRepair(
            groundingAttempt,
            "Grounding repair: preserve complete chapter coverage while removing unsupported report/document framing and broader institutional subjects.",
            rejectedClaims,
            rejectedOutput,
          )
        : roleAttributionRepairOnly
          ? await queryConservativeRoleAttributionRepair(
            groundingAttempt,
            "Grounding repair: remove the unsupported office or role identified by the audit and preserve the correspondence topic, question, or response generically.",
            rejectedClaims,
            rejectedOutput,
          )
        : reportIntroductionAttributionCandidate
          ? await queryConservativeReportIntroductionRepair(
            groundingAttempt,
            `Grounding repair: keep the report's named subject separate from the speaker who introduced it; use neutral report wording if the later report speaker is not explicitly named. The independent audit identified these concrete defects; correct them from the source and do not repeat them: ${rejectedClaims}`,
            )
        : shortAgendaTransitionOnly
          ? await queryConservativeAgendaTransitionRepair(
            groundingAttempt,
            "Grounding repair: keep this as a generic agenda-position transition only; omit any claimed seconder, motion, vote, or named speaker.",
          )
        : questionAnswerOnly
          ? await queryConservativeQuestionAnswerRepair(
            groundingAttempt,
            "Grounding repair: preserve the question-and-answer form and do not turn the question into a report finding or completed outcome.",
          )
        : amendmentSequenceOnly
          ? await queryConservativeAmendmentSequenceRepair(
            groundingAttempt,
            `Grounding repair: preserve the literal distinction identified by the audit and do not repeat any rejected merged outcome. REJECTED_CLAIMS: ${rejectedClaims}. REJECTED_CANDIDATE: ${rejectedOutput}`,
          )
        : speakerHandoffCandidate
          ? await queryConservativeSpeakerHandoffRepair(
            groundingAttempt,
            "Grounding repair: remove the standalone callout person's name from the preceding concern and state the source's opposition or concern neutrally.",
            rejectedClaims,
            rejectedOutput,
          )
        : proceduralSelfReportOnly
          ? await queryConservativeProceduralSelfReportRepair(
            groundingAttempt,
            "Grounding repair: preserve the first-person future or transition wording and do not describe the gavel handoff or appointment as completed in this source span.",
          )
        : additionalBusinessRemarksOnly
          ? await queryConservativeAdditionalBusinessRepair(
            groundingAttempt,
            "Grounding repair: describe the two matters as remarks or topics, not proposed matters or motions, and preserve the question-and-response form around the speech question.",
          )
        : proceduralFragmentOnly
          ? await queryConservativeProceduralFragmentRepair(
            groundingAttempt,
            "Grounding repair: start from the literal fragment and do not repeat the rejected action, topic, or outcome.",
            rejectedClaims,
            rejectedOutput,
          )
        : shortCategoryFragment
          ? await queryConservativeCategoryFragmentRepair(
            groundingAttempt,
            "Grounding repair: keep the current category separate from the collective follow-up and do not repeat any inferred mover, vote, or carried result.",
            rejectedClaims,
            rejectedOutput,
          )
          : await queryFreshGroundedRepair(rejectedClaims, groundingAttempt, rejectedOutput);
      rawSummary = normalizeText(parsed?.summary || "");
      assertCleanStage3Text(rawSummary, `stage3 grounding repair ${groundingAttempt}`);
      summary = enforceSummaryBudget(rawSummary, budget);
      if (!summary) {
        throw new Error(`stage3 retryable: source-grounding repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
      }
      // A source-grounding repair is a fresh generation and can reintroduce
      // transcript metadata that the initial prose gate removed. Reapply that
      // contract before the repaired prose reaches the independent audit.
      await repairSpeakerMetadata(`grounding ${groundingAttempt}`);
      await repairDocumentSpeechAct(`grounding ${groundingAttempt}`);
      await repairStructuredDateIdentity(`grounding ${groundingAttempt}`);
      if (transcriptSpeakerIdentifierAppears()) {
        throw new Error(`stage3 retryable: grounding repair exposed an internal transcript speaker identifier for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
      }
      groundingAudit = await auditAndAdjudicateGroundedSummary({
        label: promptLabel,
        summary,
        sourceExcerpt: semanticGroundingSourceExcerpt,
        llmModel,
        ollamaUrl,
        governingBody,
        motionEvidence: ordinalMotionEvidence,
        amendmentEvidence,
        speakerHandoffEvidence,
        documentSourceOnly,
        numericConflictRepairActive,
        deferralObjectRepairActive,
      });
    }
    if (!groundingAudit.grounded) {
      const finalRejectedClaims = groundingAudit.unsupportedClaims.length
        ? groundingAudit.unsupportedClaims.join(" | ")
        : groundingAudit.notes || "the candidate contains a claim not supported by this source excerpt";
      const finalAuditFeedback = [finalRejectedClaims, groundingAudit.notes].filter(Boolean).join(" | ");
      const finalGeneratedProse = `${summary} ${normalizeText(parsed?.["chapter text"] || "")}`;
      const finalUnsupportedSpeechActDefect = /\b(?:does\s+not\s+explicitly\s+(?:record|state|contain)|not\s+explicitly\s+(?:recorded|stated)|not\s+in\s+the\s+(?:manner|form)|source\s+(?:does\s+not|never)\s+(?:record|state|contain)|not\s+(?:actually\s+)?present)\b/iu.test(finalAuditFeedback)
        && /\b(?:support(?:ed|s|ing)?|propos(?:e|ed|es|ing|al)|share(?:d|ing)?\s+(?:a\s+)?conversation)\b/iu.test(finalGeneratedProse);
      const finalGenericPluralActorDefect = genericPluralActorGroundingDefect(finalAuditFeedback)
        && /\b(?:speakers|participants|members|officials)\b/iu.test(finalGeneratedProse);
      const finalUnsupportedQualifierDefect = unsupportedQualifierGroundingDefect(finalAuditFeedback)
        && /\b(?:new|updated|current|redesigned|digital|expanded|improved)\b/iu.test(finalGeneratedProse);
      const finalConditionalRecommendationDefect = (conditionalDeferralRecommendationSource(semanticGroundingSourceExcerpt)
        || (/\b(?:would|could)\s+recommend\b/iu.test(semanticGroundingSourceExcerpt)
          && /\b(?:deferr|postpon|refer|recommend|action|matter)\w*/iu.test(semanticGroundingSourceExcerpt)))
        && /\b(?:recommend(?:ed|s)?\s+(?:a\s+)?(?:deferral|postponement|referral)|recommendation\s+(?:to\s+[^.?!]{0,120}\s+)?(?:was\s+)?(?:raised|made|given)|(?:speaker|member|councillor)\s+recommend(?:ed|s)?)\b/iu.test(finalGeneratedProse)
        && /\b(?:no\s+formal|would\s+need\s+a\s+motion|conditional|could\s+be\s+deferred|not\s+(?:a\s+)?(?:motion|recommendation)|implies?|completed|no\s+disposition|not\s+(?:moved|seconded|carried))\b/iu.test(finalAuditFeedback);
      const finalCausalRelationshipDefect = /\b(?:causal\s+(?:link|relationship|relationships)|causal(?:ity)?|cause(?:s|d|ing)?|reason|motivation|purpose|primary\s+(?:reason|motivation|case))\b/iu.test(finalAuditFeedback)
        && /\b(?:not\s+(?:explicitly\s+)?state(?:d)?|does\s+not\s+(?:explicitly\s+)?state|unsupported|implies?|inferred|incorrect(?:ly)?|not\s+the|no\s+explicit)\b/iu.test(finalAuditFeedback)
        && causalRelationshipConstructionDefect(finalGeneratedProse);
      const finalReferredAgendaScopeDefect = referredAgendaScopeGroundingDefect(finalAuditFeedback);
      const finalNumericConflictDefect = /\b(?:contradict(?:ed|s|ing|ory|ion)?|conflict(?:ed|s|ing)?|ambig(?:uous|uity)|uncertain|mismatch|discrepanc(?:y|ies)?|ASR)\b/iu.test(finalAuditFeedback)
        && /\b(?:numeric|number|date|year|amount|budget|expenditure|financial|ordinal|figure|value|requirement|cost)\b/iu.test(`${finalGeneratedProse} ${finalAuditFeedback}`)
        && /(?:\d[\d,]*(?:\.\d+)?|\b(?:19|20)\d{2}\b)/u.test(finalAuditFeedback);
      const finalNumericSpecificityDefect = /\b(?:unspecified|unknown|unclear|not\s+(?:specified|given|provided))\b/iu.test(finalGeneratedProse)
        && /\b(?:amount|budget|requirement|year|date|quantity|cost|figure|number|value|financial)\b/iu.test(finalGeneratedProse)
        && /\b(?:explicit(?:ly)?|exact|specific|source|provided|stated|figure|amount|number|value|numeric)\b/iu.test(finalAuditFeedback)
        && /(?:\d[\d,]*(?:\.\d+)?|\b(?:19|20)\d{2}\b)/u.test(finalAuditFeedback);
      const finalFragmentedTranscriptDefect = fragmentedTranscriptGroundingDefect(finalAuditFeedback);
      const finalSeparateDiscussionDefect = mergedDiscussionScopeGroundingDefect(finalAuditFeedback)
        && /\b(?:discussion|discussed|conversation|remarks?|topics?)\b/iu.test(finalGeneratedProse);
      if (finalReferredAgendaScopeDefect) {
        parsed = await queryConservativeReferredAgendaScopeRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final referred-agenda-scope repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final referred-agenda-scope repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final referred-agenda-scope");
        await repairDocumentSpeechAct("final referred-agenda-scope");
        await repairStructuredDateIdentity("final referred-agenda-scope");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (finalUnsupportedSpeechActDefect) {
        parsed = await queryConservativeUnsupportedSpeechActRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final unsupported-speech-act repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final unsupported-speech-act repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final unsupported-speech-act");
        await repairDocumentSpeechAct("final unsupported-speech-act");
        await repairStructuredDateIdentity("final unsupported-speech-act");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalGenericPluralActorDefect) {
        parsed = await queryConservativeGenericPluralActorRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final generic-plural-actor repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final generic-plural-actor repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final generic-plural-actor");
        await repairDocumentSpeechAct("final generic-plural-actor");
        await repairStructuredDateIdentity("final generic-plural-actor");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalUnsupportedQualifierDefect) {
        parsed = await queryConservativeUnsupportedQualifierRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final unsupported-qualifier repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final unsupported-qualifier repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final unsupported-qualifier");
        await repairDocumentSpeechAct("final unsupported-qualifier");
        await repairStructuredDateIdentity("final unsupported-qualifier");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalFragmentedTranscriptDefect) {
        parsed = await queryConservativeFragmentedSourceRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final fragmented-source repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final fragmented-source repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final fragmented-source");
        await repairDocumentSpeechAct("final fragmented-source");
        await repairStructuredDateIdentity("final fragmented-source");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalSeparateDiscussionDefect) {
        parsed = await queryConservativeSeparateDiscussionRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final separate-discussion repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final separate-discussion repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final separate-discussion");
        await repairDocumentSpeechAct("final separate-discussion");
        await repairStructuredDateIdentity("final separate-discussion");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalConditionalRecommendationDefect) {
        parsed = await queryConservativeIncompleteDeferralRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final conditional-deferral repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final conditional-deferral repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final conditional-deferral");
        await repairDocumentSpeechAct("final conditional-deferral");
        await repairStructuredDateIdentity("final conditional-deferral");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalCausalRelationshipDefect) {
        parsed = await queryConservativeCausalRelationshipRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final causal-relationship repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final causal-relationship repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final causal-relationship");
        await repairDocumentSpeechAct("final causal-relationship");
        await repairStructuredDateIdentity("final causal-relationship");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalNumericConflictDefect) {
        numericConflictRepairActive = true;
        parsed = await queryConservativeNumericConflictRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final numeric-conflict repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final numeric-conflict repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final numeric-conflict");
        await repairDocumentSpeechAct("final numeric-conflict");
        await repairStructuredDateIdentity("final numeric-conflict");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
      if (!groundingAudit.grounded && finalNumericSpecificityDefect) {
        numericSpecificityRepairActive = true;
        parsed = await queryConservativeNumericSpecificityRepair(
          4,
          finalAuditFeedback,
          JSON.stringify({
            summary: normalizeText(summary),
            "chapter text": normalizeText(parsed?.["chapter text"] || ""),
          }),
        );
        rawSummary = normalizeText(parsed?.summary || "");
        assertCleanStage3Text(rawSummary, "stage3 final numeric-specificity repair");
        summary = enforceSummaryBudget(rawSummary, budget);
        if (!summary) {
          throw new Error(`stage3 retryable: final numeric-specificity repair produced an empty summary for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
        }
        await repairSpeakerMetadata("final numeric-specificity");
        await repairDocumentSpeechAct("final numeric-specificity");
        await repairStructuredDateIdentity("final numeric-specificity");
        groundingAudit = await auditAndAdjudicateGroundedSummary({
          label: promptLabel,
          summary,
          sourceExcerpt: semanticGroundingSourceExcerpt,
          llmModel,
          ollamaUrl,
          governingBody,
          motionEvidence: ordinalMotionEvidence,
          amendmentEvidence,
          speakerHandoffEvidence,
          documentSourceOnly,
          numericConflictRepairActive,
          deferralObjectRepairActive,
        });
      }
    }
    if (!groundingAudit.grounded) {
      throw new Error(
        `stage3 retryable: source-grounding audit rejected unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${[...groundingAudit.unsupportedClaims, groundingAudit.notes].filter(Boolean).join(" | ")}`,
      );
    }
  }

  const financialAsk = async (messages, { numPredict = 260 } = {}) => {
    const system = messages
      .filter((message) => message?.role === "system")
      .map((message) => String(message?.content || "").trim())
      .filter(Boolean)
      .join("\n");
    const user = messages
      .filter((message) => message?.role !== "system")
      .map((message) => String(message?.content || "").trim())
      .filter(Boolean)
      .join("\n\n");
    const result = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: system || "You are a strict financial-claim verifier for civic reporting.",
      prompt: user,
      maxOutputTokens: numPredict,
      temperature: 0,
      seed: seed + 1000,
    });
    return JSON.stringify(result || {});
  };
  let financialAudit = await auditFinancialClaim({
    ask: financialAsk,
    sourceText: String(unit?.["source excerpt"] || ""),
    // Audit the generated prose that can publish.  Qwen occasionally echoes
    // the grounded source into the auxiliary chapter-text field; including
    // that raw field here can trigger a false financial audit on unrelated
    // source terms such as "financial" or "budget".
    candidateText: summary,
    context: `Agenda item ${String(unit?.["agenda item"] || "")}; preserve whether any financial amount is direct, combined, projected, or merely reported.`,
  });
  for (let financialAttempt = 1; financialAudit.verdict !== "PASS" && financialAttempt <= 5; financialAttempt += 1) {
    const financialRetryInstruction = [
      `Financial-claim retry ${financialAttempt}: ${financialAudit.feedback}`,
      "Rewrite the summary and chapter text so aggregate savings, new revenue, operational efficiencies, soft savings, and future cost avoidance are clearly qualified and attributed to the report or staff.",
      "Do not present a reported, projected, compounded, or combined amount as a direct or approved net saving.",
      "Preserve the direction of every amount: additional funding, a budget increase, a repair or project cost, an allowance, a contingency, an estimate, or a reserve draw must remain a requested cost or funding need, never a saving or reduction.",
      "Preserve conditional and hypothetical language exactly: if, would, could, may, proposed, or pending future decisions must remain conditional. When the audit describes a reserve-funded reduction as hypothetical, say only that it could or may reduce the levy/budget if the future decision occurs, or omit the financial claim; never call it a direct saving, approved reduction, or completed outcome.",
      "A separate statement that staff saved costs, that funds are available, or that the current budget is unaffected does not convert a requested amount into savings.",
      "When the rejected wording attached savings to a requested amount, start from the source and state the request, cost, estimate, or reserve source directly; do not reuse the rejected financial label.",
      "Use explicit wording such as the report says, the speaker reported, or combined benefits when the source supports those categories; do not silently collapse them into savings.",
      "Preserve exact source numbers and the item's decision status.",
    ].join(" ");
    if (financialAttempt < 3) {
      parsed = await queryParsed(financialRetryInstruction);
    } else {
      parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        maxOutputTokens: 720,
        format: STAGE3_SUMMARY_RESPONSE_FORMAT,
        system: "Write a fresh source-grounded civic summary. Return strict JSON only.",
        prompt: [
          "Start over from the grounded source excerpt; do not revise or repeat the prior draft.",
          "If the source combines savings, new revenue, efficiencies, soft savings, or future cost avoidance, describe that as a reported combined benefit and attribute it to the report or speaker.",
          "Never call a combined, projected, annualized, compounded, or merely reported amount a direct or approved net saving.",
          "If the source describes additional funding, a budget increase, a repair or project cost, an allowance, a contingency, an estimate, or a reserve draw, describe it as that request or cost. Never call it savings or a reduction, even if another source sentence mentions staff savings or available funds.",
          "Preserve conditional and hypothetical language exactly: if, would, could, may, proposed, or pending future decisions must remain conditional. When the source describes a possible reserve-funded reduction, say only that it could or may reduce the levy/budget if the future decision occurs, or omit the financial claim; never call it a direct saving, approved reduction, or completed outcome.",
          "Keep every amount attached to the source category that governs it; do not merge a separate efficiency benefit with a requested cost.",
          "Preserve exact source numbers and the item's decision status. Do not add facts.",
          "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
          `Label: ${promptLabel}`,
          `Agenda item: ${unit["agenda item"] || ""}`,
    "Grounded source excerpt:",
    documentOnlyGenerationContract,
    String(unit["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
        ].join("\n\n"),
        temperature: 0.25,
        seed: seed + 2000 + financialAttempt,
      });
    }
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 financial-claim retry");
    summary = enforceSummaryBudget(rawSummary, budget);
    financialAudit = await auditFinancialClaim({
      ask: financialAsk,
      sourceText: String(unit?.["source excerpt"] || ""),
      candidateText: summary,
      context: `Agenda item ${String(unit?.["agenda item"] || "")}; preserve whether any financial amount is direct, combined, projected, or merely reported.`,
    });
  }
  if (financialAudit.verdict !== "PASS") {
    throw new Error(`stage3 retryable: financial claim requires source-faithful qualification for unit ${String(unit?.["unit id"] || unit?.["agenda item"] || "unknown")}: ${financialAudit.feedback}`);
  }
  const attributionSource = String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || "");
  for (let attributionAttempt = 1; attributionAttempt <= 3; attributionAttempt += 1) {
    const defects = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    if (!defects.length) break;
    const rejectedJson = JSON.stringify({
      summary: normalizeText(parsed?.summary || ""),
      "chapter text": normalizeText(parsed?.["chapter text"] || ""),
    });
    const repairInstruction = attributionAttempt === 1
      ? "Regenerate without naming that actor; describe the motion or Council's action generically."
      : attributionAttempt === 2
        ? `Rejected JSON: ${rejectedJson}. Start both fields over and do not repeat any named mover or seconder from the rejected JSON.`
        : `Rejected JSON: ${rejectedJson}. Delete the unsupported actor name and the move/second role from both fields. Begin directly with the substantive recommendation, discussion, or Council action.`;
    parsed = await queryParsed(
      `Motion-attribution retry ${attributionAttempt}: ${defects.map((defect) => `"${defect.claim}"`).join(", ")} names a mover or seconder without an explicit same-line source attribution. ${repairInstruction}`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 motion-attribution retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  let repeatedAttributionDefects = unsupportedNamedMotionAttributions({
    text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
    sourceExcerpt: attributionSource,
  });
  const forbiddenMotionActors = new Set(repeatedAttributionDefects.map((defect) => defect.actor).filter(Boolean));
  for (let freshAttempt = 1; repeatedAttributionDefects.length && freshAttempt <= 3; freshAttempt += 1) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      system: "Write a fresh source-grounded civic summary with no personal names. Return strict JSON only.",
      prompt: [
        "Start over from the grounded source. Do not revise or repeat the rejected draft.",
        "Use only generic institutional subjects such as Council, the committee, staff, or the report.",
        "Do not write any personal name anywhere in summary or chapter text, even when the source contains names.",
        "Do not attribute moving or seconding to any person. State the substantive recommendation, discussion, and supported outcome generically.",
        forbiddenMotionActors.size ? `Forbidden actor names from prior failed generations: ${[...forbiddenMotionActors].join(", ")}.` : "",
        `Summary budget: at most ${budget.maxSentences} sentences and ${budget.maxWords} words.`,
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `Label: ${promptLabel}`,
        `Agenda item: ${unit["agenda item"] || ""}`,
        "Grounded source excerpt:",
        String(unit["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
      ].filter(Boolean).join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 fresh no-name motion-attribution retry");
    summary = enforceSummaryBudget(rawSummary, budget);
    repeatedAttributionDefects = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    for (const defect of repeatedAttributionDefects) {
      if (defect.actor) forbiddenMotionActors.add(defect.actor);
    }
  }
  for (let numericAttempt = 1; numericAttempt <= 2; numericAttempt += 1) {
    const defects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
    if (!defects.length) break;
    parsed = await queryParsed(
      `Numeric-fidelity retry: the prior response contained ${defects.map((value) => `"${value}"`).join(", ")}. Regenerate from the grounded source and use Arabic digits for every such quantity or street ordinal.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 numeric-fidelity retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  const remainingNumericDefects = [
    ...numericFidelityDefects(summary),
    ...numericFidelityDefects(parsed?.["chapter text"] || ""),
  ];
  const repaired = await repairNumericFidelityLlm({
    summary,
    chapterText: parsed?.["chapter text"] || "",
    sourceExcerpt: unit["source excerpt"] || "",
    llmModel,
    ollamaUrl,
  });
  if (repaired.summary) {
    rawSummary = repaired.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (repaired.chapterText) parsed["chapter text"] = repaired.chapterText;
  for (let groundingAttempt = 1; groundingAttempt <= 2; groundingAttempt += 1) {
    const unsupported = unsupportedNumericTokens(
      `${summary} ${String(parsed?.["chapter text"] || "")}`,
      numericGroundingSource,
    );
    if (!unsupported.length) break;
    parsed = await queryParsed(
      `Numeric-grounding retry: these numeric tokens are absent from the grounded source: ${unsupported.join(", ")}. Regenerate both fields using only exact numeric values present in the source.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  let unsupportedAfterRegeneration = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (unsupportedAfterRegeneration.length) {
    const groundedRepair = await repairUnsupportedNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: numericGroundingSource,
      unsupportedTokens: unsupportedAfterRegeneration,
      llmModel,
      ollamaUrl,
    });
    rawSummary = groundedRepair.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
    parsed["chapter text"] = groundedRepair.chapterText;
    unsupportedAfterRegeneration = groundedRepair.unsupportedTokens;
  }
  // Grounding regeneration can repair an unsupported Arabic token by spelling
  // it out again, while notation repair can turn an ambiguous spoken form into
  // a new unsupported Arabic token. Reapply both downstream contracts as one
  // bounded loop so neither repair can invalidate the other unnoticed.
  for (let contractAttempt = 1; contractAttempt <= 3; contractAttempt += 1) {
    const notationDefects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
    if (notationDefects.length) {
      const notationRepair = await repairNumericFidelityLlm({
        summary,
        chapterText: parsed?.["chapter text"] || "",
        sourceExcerpt: numericGroundingSource,
        llmModel,
        ollamaUrl,
      });
      rawSummary = notationRepair.summary;
      summary = enforceSummaryBudget(rawSummary, budget);
      parsed["chapter text"] = notationRepair.chapterText;
    }
    const unsupported = unsupportedNumericTokens(
      `${summary} ${String(parsed?.["chapter text"] || "")}`,
      numericGroundingSource,
    );
    if (unsupported.length) {
      const groundingRepair = await repairUnsupportedNumericClaimsLlm({
        summary,
        chapterText: parsed?.["chapter text"] || "",
        sourceExcerpt: numericGroundingSource,
        unsupportedTokens: unsupported,
        llmModel,
        ollamaUrl,
      });
      rawSummary = groundingRepair.summary;
      summary = enforceSummaryBudget(rawSummary, budget);
      parsed["chapter text"] = groundingRepair.chapterText;
      unsupportedAfterRegeneration = groundingRepair.unsupportedTokens;
    } else {
      unsupportedAfterRegeneration = [];
    }
    if (!numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`).length
      && !unsupportedAfterRegeneration.length) break;
  }
  let unrepairedNumericDefects = [
    ...numericFidelityDefects(summary),
    ...numericFidelityDefects(parsed?.["chapter text"] || ""),
  ];
  if (unrepairedNumericDefects.length) {
    const qualitativeRepair = await rewriteWithoutNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: numericGroundingSource,
      llmModel,
      ollamaUrl,
    });
    rawSummary = qualitativeRepair.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
    parsed["chapter text"] = qualitativeRepair.chapterText;
    unrepairedNumericDefects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
  }
  if (unrepairedNumericDefects.length) {
    throw new Error(`stage3 retryable: configured text model failed numeric fidelity for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unrepairedNumericDefects.join(", ")}`);
  }
  let unsupportedNumericClaims = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (unsupportedAfterRegeneration.length || unsupportedNumericClaims.length) {
    // A bounded source window can contain a dense map/table where Qwen keeps
    // reintroducing a nearby number that is not present in this exact child
    // window. Give the model one qualitative rewrite opportunity before the
    // strict gate rejects the item; this preserves the substantive action or
    // outcome without inventing a replacement quantity.
    const qualitativeRepair = await rewriteWithoutNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: numericGroundingSource,
      llmModel,
      ollamaUrl,
    });
    rawSummary = qualitativeRepair.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
    parsed["chapter text"] = qualitativeRepair.chapterText;
    unsupportedAfterRegeneration = [];
    unsupportedNumericClaims = unsupportedNumericTokens(
      `${summary} ${String(parsed?.["chapter text"] || "")}`,
      numericGroundingSource,
    );
    if (unsupportedNumericClaims.length || numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`).length) {
      const unsupported = [...new Set([...unsupportedAfterRegeneration, ...unsupportedNumericClaims])];
      throw new Error(`stage3 retryable: unsupported numeric claims for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unsupported.join(", ")}`);
    }
  }
  let unsupportedMotionAttributions = unsupportedNamedMotionAttributions({
    text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
    sourceExcerpt: attributionSource,
  });
  for (let finalAttributionAttempt = 1; unsupportedMotionAttributions.length && finalAttributionAttempt <= 3; finalAttributionAttempt += 1) {
    const forbiddenActors = [...new Set(unsupportedMotionAttributions.map((defect) => defect.actor).filter(Boolean))];
    const forbiddenNumericPhrases = [...new Set([
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ])];
    const qualitativeAttributionSource = forbiddenNumericPhrases.reduce(
      (source, phrase) => source.replaceAll(phrase, ""),
      String(unit["source excerpt"] || ""),
    );
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      system: "Write fresh qualitative civic prose with no personal names or numeric claims. Return strict JSON only.",
      prompt: [
        "A downstream repair reintroduced unsupported named movers or seconders. Start over from the grounded source; do not revise the contaminated draft.",
        "Use only generic institutional subjects such as Council, the committee, staff, or the report.",
        "Do not write any personal name, mover, seconder, digit, date, time, amount, address, percentage, or spelled-out number phrase.",
        forbiddenNumericPhrases.length
          ? `Do not repeat these exact rejected numeric or address phrases: ${JSON.stringify(forbiddenNumericPhrases)}.`
          : "",
        "Preserve the supported civic recommendation, discussion, decision, and outcome qualitatively. Do not add facts.",
        forbiddenActors.length ? `Forbidden actor names: ${forbiddenActors.join(", ")}.` : "",
        `Summary budget: at most ${budget.maxSentences} sentences and ${budget.maxWords} words.`,
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `Label: ${promptLabel}`,
        `Agenda item: ${unit["agenda item"] || ""}`,
        "Grounded source excerpt:",
        qualitativeAttributionSource.slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
      ].filter(Boolean).join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 final no-name qualitative retry");
    summary = enforceSummaryBudget(rawSummary, budget);
    unsupportedMotionAttributions = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    if (!unsupportedMotionAttributions.length
      && !numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`).length
      && !unsupportedNumericTokens(`${summary} ${String(parsed?.["chapter text"] || "")}`, numericGroundingSource).length) {
      break;
    }
  }
  let finalNumericDefects = numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`);
  if (finalNumericDefects.length) {
    const freshQualitativeSource = finalNumericDefects.reduce(
      (source, phrase) => source.replaceAll(phrase, ""),
      attributionSource,
    );
    const freshQualitative = await rewriteWithoutNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: freshQualitativeSource,
      llmModel,
      ollamaUrl,
    });
    summary = enforceSummaryBudget(freshQualitative.summary, budget);
    parsed["chapter text"] = freshQualitative.chapterText;
    finalNumericDefects = numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`);
  }
  const finalUnsupportedNumericClaims = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (finalNumericDefects.length || finalUnsupportedNumericClaims.length) {
    throw new Error(`stage3 retryable: final attribution repair violated numeric grounding for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${[...new Set([...finalNumericDefects, ...finalUnsupportedNumericClaims])].join(", ")}`);
  }
  if (unsupportedMotionAttributions.length) {
    throw new Error(
      `stage3 retryable: unsupported named motion attribution for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unsupportedMotionAttributions.map((defect) => defect.claim).join(", ")}`,
    );
  }
  summary = cleanupTranscriptScrapText(summary);
  assertCleanStage3Text(summary, "stage3 final summary");
  assertCleanStage3Text(parsed?.["chapter text"] || "", "stage3 chapter text");
  let finalFinancialAudit = await auditFinancialClaim({
    ask: financialAsk,
    sourceText: String(unit?.["source excerpt"] || ""),
    candidateText: summary,
    context: `Agenda item ${String(unit?.["agenda item"] || "")}; final downstream output must preserve direct versus combined, projected, or reported financial claims.`,
  });
  for (let finalFinancialAttempt = 1; finalFinancialAudit.verdict !== "PASS" && finalFinancialAttempt <= 3; finalFinancialAttempt += 1) {
    const rejectedJson = JSON.stringify({
      summary: normalizeText(summary),
      "chapter text": normalizeText(parsed?.["chapter text"] || ""),
    });
    const finalFinancialRetry = [
      `Final financial-claim retry ${finalFinancialAttempt}: ${finalFinancialAudit.feedback}`,
      "Adjudicate the rejection against the literal grounded source before writing anything.",
      "Start both fields over from the grounded source; do not revise or repeat the rejected draft.",
      "First identify the concrete proposal, amount, resource, or action that the source explicitly supports. Report those facts and the decision status rather than inferring a net financial direction.",
      "When the source mixes reductions, increased hours, new allocations, revenue, efficiencies, or future cost avoidance, name the distinct categories and attribute them to the report or speaker.",
      "Do not use an unqualified claim of direct savings, reduced funding, net savings, or a net reduction. If the source does not calculate a net effect, omit that directional characterization and state the concrete proposal terms instead.",
      "Never mention internal transcript speaker identifiers or labels matching SPEAKER_ followed by an identifier; use a generic source-supported subject instead.",
      finalFinancialAttempt === 1
        ? "Prefer a precise proposal description with the supported amount or resource detail over an evaluative financial label."
        : finalFinancialAttempt === 2
          ? "Use a conservative institutional subject such as the report, staff, or the agreement, and preserve the source's uncertainty and attribution."
          : "This is the final bounded repair: omit financial claims, amounts, and financial terminology from both fields entirely, and retain only the grounded non-financial topic, action, and decision status. Do not repeat the rejected financial framing.",
      "Preserve exact source numbers and the item's decision status. Do not add facts.",
      `REJECTION_REASON: ${finalFinancialAudit.feedback}`,
      finalFinancialAttempt < 3
        ? `PRIOR_REJECTED_OUTPUT: ${rejectedJson}`
        : "Do not include or imitate any prior rejected output; write from the grounded source excerpt only.",
      "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
      `Label: ${promptLabel}`,
      `Agenda item: ${unit["agenda item"] || ""}`,
      "Grounded source excerpt:",
      String(unit["source excerpt"] || "").slice(0, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000)),
    ].join("\n\n");
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      maxOutputTokens: 720,
      format: STAGE3_SUMMARY_RESPONSE_FORMAT,
      system: finalFinancialAttempt >= 3
        ? "Write a fresh source-grounded civic summary with no financial claims, amounts, or financial terminology. Retain only the grounded non-financial topic, action, and decision status. Return strict JSON only."
        : "Write a fresh source-grounded civic summary after a financial-claim rejection. Return strict JSON only.",
      prompt: finalFinancialRetry,
      temperature: 0.25,
      seed: seed + 3000 + finalFinancialAttempt,
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 final financial-claim retry");
    summary = cleanupTranscriptScrapText(enforceSummaryBudget(rawSummary, budget));
    parsed["chapter text"] = normalizeText(parsed?.["chapter text"] || "");
    if (!summary) {
      throw new Error(`stage3 retryable: final financial repair produced an empty summary for unit ${String(unit?.["unit id"] || unit?.["agenda item"] || "unknown")}`);
    }
    finalFinancialAudit = await auditFinancialClaim({
      ask: financialAsk,
      sourceText: String(unit?.["source excerpt"] || ""),
      candidateText: summary,
      context: `Agenda item ${String(unit?.["agenda item"] || "")}; final downstream output must preserve direct versus combined, projected, or reported financial claims.`,
    });
  }
  if (finalFinancialAudit.verdict !== "PASS") {
    throw new Error(`stage3 retryable: final financial claim requires source-faithful qualification for unit ${String(unit?.["unit id"] || unit?.["agenda item"] || "unknown")}: ${finalFinancialAudit.feedback}`);
  }

  await repairSpeakerMetadata("final");
  if (transcriptSpeakerIdentifierAppears()) {
    throw new Error(`stage3 retryable: final stage3 output exposed an internal transcript speaker identifier for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}`);
  }

  return {
    summary,
    chapterText: normalizeText(parsed?.["chapter text"] || ""),
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
    notes: normalizeText(parsed?.notes || ""),
    budget,
    clampChanged: summary !== rawSummary,
    rawSummary,
  };
}

export function agendaSummaryToMarkdown(summaryArtifact = {}) {
  const lines = [];
  lines.push(`# Agenda Section Summaries`);
  lines.push("");
  const sections = Array.isArray(summaryArtifact?.sections) ? summaryArtifact.sections : [];
  for (const s of sections) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(s.summary || "(no summary)");
    lines.push("");
    const chapters = Array.isArray(s.chapters) ? s.chapters : [];
    if (chapters.length) {
      lines.push("Chapters");
      lines.push("");
      for (const ch of chapters) {
        const since = Number(ch.since || 0);
        const hh = String(Math.floor(since / 3600)).padStart(2, "0");
        const mm = String(Math.floor((since % 3600) / 60)).padStart(2, "0");
        const ss = String(Math.floor(since % 60)).padStart(2, "0");
        lines.push(`- [${hh}:${mm}:${ss}] ${ch.title}`);
        if (String(ch.text || "").trim()) lines.push(`  ${ch.text}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function stage3ChapterTitleFromGenerated({
  llmText = "",
  summary = "",
  heading = "",
} = {}) {
  return pickSplitChapterText({
    llmText,
    summary,
    heading,
    seenLeadPhrases: new Set(),
  });
}

function exactDuplicateChapterIndices(chapters = []) {
  const seenTitles = new Set();
  const seenSummaries = new Set();
  const duplicates = [];
  for (let index = 0; index < chapters.length; index += 1) {
    const title = wordsKey(chapters[index]?.title || "");
    const summary = wordsKey(chapters[index]?.text || "");
    if ((title && seenTitles.has(title)) || (summary && seenSummaries.has(summary))) {
      duplicates.push(index);
    }
    if (title) seenTitles.add(title);
    if (summary) seenSummaries.add(summary);
  }
  return duplicates;
}

function chapterSiblingContext(chapters = [], excludedIndex = -1, includeSummaries = false) {
  return chapters
    .filter((_, index) => index !== excludedIndex)
    .map((chapter) => {
      const title = normalizeText(chapter?.title || "");
      if (!title) return "";
      if (includeSummaries) return `${title}: ${normalizeText(chapter?.text || "")}`;
      return /\d/u.test(title) ? "" : title;
    })
    .filter(Boolean);
}

async function auditChapterOrthogonality({
  heading,
  chapters,
  llmModel,
  ollamaUrl,
}) {
  if (!Array.isArray(chapters) || chapters.length < 2) {
    return { orthogonal: true, duplicateIndices: [], notes: "" };
  }
  const rendered = chapters
    .map((chapter, index) => [
      `CHAPTER ${index + 1}`,
      `TITLE: ${normalizeText(chapter?.title || "")}`,
      `SUMMARY: ${abridgeUtf8(normalizeText(chapter?.text || ""), ORTHOGONALITY_SUMMARY_WINDOW_CHARS)}`,
      // Keep enough of each bounded source window for the audit to see facts
      // that may sit just beyond the head/tail split (for example a finding
      // in the middle of a long attachment). The audit must judge the literal
      // source, not an abridgement that silently hides the supporting line.
      `SOURCE WINDOW: ${abridgeUtf8(String(chapter?.["source excerpt"] || ""), ORTHOGONALITY_SOURCE_WINDOW_CHARS)}`,
    ].join("\n"))
    .join("\n\n");
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Audit civic agenda child summaries for semantic duplication and headline accuracy. Return strict JSON only.",
    prompt: [
      "Determine whether these character-bounded child summaries are meaningfully distinct and each title accurately describes its own summary.",
      "Shared subject names and necessary repetition of the same overall report outcome or approval conditions are allowed. Flag a chapter only when it substantially repeats another chapter's claim without adding any distinct source-supported detail from its own window, or when it omits that window's unique material.",
      "Compare the unique evidence in each source window before deciding. Do not call chapters duplicates merely because both must mention the same recommendation, approval, legal framework, or conditions to remain accurate.",
      "Treat different source facets as distinct coverage even when they concern the same application: property description, policy analysis, approval conditions, agency comments, correspondence, implementation requirements, and fees are not duplicates when the chapter reports details unique to its own window.",
      "Only flag a chapter as redundant when its summary contains no meaningful source-supported detail beyond another chapter's summary. If its title is wrong but its summary has distinct evidence, flag the title defect for title repair without classifying the chapter as semantically duplicate.",
      "Character-bounded windows from the same report may share an announcement or document heading. For appendices and tables, different names, regions, rows, memberships, or other details in disjoint source windows are distinct coverage, not duplication; do not reject them merely because the parent announcement is the same.",
      PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE,
      "Also flag a chapter when its title claims a topic absent from its own summary, omits the summary's actual main point, or ends as a truncated/dangling phrase.",
      "Return exactly: {\"orthogonal\":true,\"duplicate chapter indices\":[],\"notes\":\"\"}.",
      "When duplication or a title-summary defect exists, orthogonal must be false and duplicate chapter indices must contain the 1-based indices that should be regenerated.",
      `PARENT: ${normalizeText(heading)}`,
      rendered,
    ].join("\n\n"),
    maxOutputTokens: 384,
    format: STAGE3_ORTHOGONALITY_RESPONSE_FORMAT,
  });
  const duplicateIndices = [...new Set(
    (Array.isArray(parsed?.["duplicate chapter indices"]) ? parsed["duplicate chapter indices"] : [])
      .map((value) => Number(value) - 1)
      .filter((value) => Number.isInteger(value) && value >= 0 && value < chapters.length),
  )];
  return {
    orthogonal: parsed?.orthogonal === true && duplicateIndices.length === 0,
    duplicateIndices,
    notes: normalizeText(parsed?.notes || ""),
  };
}

export async function adjudicateChapterOrthogonality({ heading, chapters, audit, llmModel, ollamaUrl }) {
  const alleged = Array.isArray(audit?.duplicateIndices) ? audit.duplicateIndices : [];
  if (!alleged.length) return audit;
  const rendered = chapters.map((chapter, index) => [
    `CHAPTER ${index + 1}`,
    `TITLE: ${normalizeText(chapter?.title || "")}`,
    `SUMMARY: ${abridgeUtf8(normalizeText(chapter?.text || ""), ORTHOGONALITY_SUMMARY_WINDOW_CHARS)}`,
    `SOURCE WINDOW: ${abridgeUtf8(String(chapter?.["source excerpt"] || ""), ORTHOGONALITY_SOURCE_WINDOW_CHARS)}`,
  ].join("\n")).join("\n\n");
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Adjudicate a semantic duplication allegation in grounded civic summaries. Return strict JSON only.",
    prompt: [
      "The first audit alleged duplication. Recheck that allegation against the literal source windows.",
      "Different source-supported facets of the same proceeding are distinct coverage, including different findings, requests, incidents, locations, parties, conditions, or outcomes.",
      "Accept the chapters when every alleged duplicate adds any meaningful source-supported detail absent from its sibling. Do not reject merely because both describe the same proceeding or decision.",
      PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE,
      "Return exactly: {\"distinct\":true} or {\"distinct\":false}.",
      `PARENT: ${normalizeText(heading)}`,
      `ALLEGED_DUPLICATE_INDICES: ${JSON.stringify(alleged.map((index) => index + 1))}`,
      `FIRST_AUDIT_NOTE: ${normalizeText(audit?.notes || "")}`,
      rendered,
    ].join("\n\n"),
    maxOutputTokens: 256,
    format: STAGE3_ORTHOGONALITY_ADJUDICATION_RESPONSE_FORMAT,
  });
  if (parsed?.distinct === true) return { orthogonal: true, duplicateIndices: [], notes: "" };
  return audit;
}

async function synthesizeParentFromChapters({
  unit,
  heading,
  chapters,
  focus,
  llmModel,
  ollamaUrl,
  semanticGroundingAudit = false,
  governingBody = "",
}) {
  const canonicalSourceEvidence = chapters
    .map((chapter) => String(chapter?.["source excerpt"] || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const parentSourceLimit = Math.max(2000, Number(process.env.AGENDA_STAGE3_SOURCE_CHARS || 16000));
  let sourceParts = chapters.map((chapter, index) => (
    [
      `Chunk ${index + 1}: ${normalizeText(chapter?.title || "")}`,
      `Generated child summary: ${normalizeText(chapter?.text || "")}`,
      `Canonical source evidence:\n${String(chapter?.["source excerpt"] || "").trim()}`,
    ].join("\n")
  ));
  // When the complete child evidence fits one bounded model request, retain
  // that verbatim chronology for parent generation instead of reducing away
  // the source and asking the parent to trust a lossy child-only synopsis.
  if (canonicalSourceEvidence && canonicalSourceEvidence.length <= parentSourceLimit) {
    sourceParts = [canonicalSourceEvidence];
  }
  let reductionPass = 0;
  while (sourceParts.join("\n\n").length > 9000) {
    reductionPass += 1;
    const batches = [];
    let batch = "";
    for (const part of sourceParts) {
      const combined = batch ? `${batch}\n\n${part}` : part;
      if (batch && combined.length > 9000) {
        batches.push(batch);
        batch = part;
      } else {
        batch = combined;
      }
    }
    if (batch) batches.push(batch);
    const reduced = [];
    for (let index = 0; index < batches.length; index += 1) {
      const excerpt = batches[index];
      const reduction = await summarizeGroundedUnit({
        unit: {
          ...unit,
          "attribution source excerpt": String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || ""),
          "unit id": `${String(unit?.["unit id"] || "unit")}_overview_${reductionPass}_${index + 1}`,
          label: heading,
          "source excerpt": excerpt,
          "source rows": Math.max(1, excerpt.split(/\n{2,}/u).filter(Boolean).length),
          "duration seconds": Math.min(780, Math.max(90, excerpt.length / 8)),
          "child chapters": [],
          "parent overview": true,
        },
        focus: `${focus || "newsworthy factual civic reporting"}; condense all supplied chunk summaries without dropping later chunks; preserve named speakers and source speech acts rather than recasting speaker-specific remarks as institutional meeting actions`,
        llmModel,
        ollamaUrl,
        isChild: true,
        // Each reduction prompt includes canonical source evidence and is
        // consumed by the final parent audit. The reduction itself is a
        // bounded context-preserving step; applying the full semantic gate to
        // mixed alternative-design source windows creates false rejections.
        semanticGroundingAudit: false,
        governingBody,
      });
      reduced.push(`Reduction ${index + 1}: ${reduction.summary}`);
    }
    if (reduced.length > sourceParts.length
      || (reduced.length === sourceParts.length
        && reduced.join("\n\n").length >= sourceParts.join("\n\n").length)) {
      throw new Error(`stage3 retryable: parent overview reduction did not shrink unit ${String(unit?.["unit id"] || "")}`);
    }
    sourceParts = reduced;
  }
  const auditEvidenceLimit = Math.max(4000, parentSourceLimit);
  const perChapterAuditBudget = Math.max(
    320,
    Math.floor((auditEvidenceLimit - (chapters.length * 96)) / Math.max(1, chapters.length)),
  );
  const sourceAnchorAuditBudget = Math.max(120, perChapterAuditBudget);
  const compactParentCoverage = sourceParts
    .map((part, index) => `COMPACT COVERAGE ${index + 1}: ${String(part || "").trim()}`)
    .filter((part) => !part.endsWith(":"));
  const parentAuditEvidence = [
    "PARENT SOURCE EVIDENCE: compact coverage below was produced from child summaries that were independently generated and semantically audited against their complete paired source windows. The compact coverage is source-derived evidence for retained claims; literal anchors remain authoritative for corrections, actor pairing, speech act, and scope.",
    "COMPACT AUDITED CHILD COVERAGE:",
    ...compactParentCoverage,
    "LITERAL SOURCE ANCHORS (AUTHORITATIVE; abbreviated only for this parent audit):",
    ...chapters.map((chapter, index) =>
      `CHAPTER ${index + 1} LITERAL SOURCE ANCHOR: ${abridgeUtf8(String(chapter?.["source excerpt"] || ""), sourceAnchorAuditBudget)}`),
  ].join("\n\n");
  const parentLiteralSourceExcerpt = [
    "COMPACT AUDITED CHILD COVERAGE (source-derived and independently audited):",
    ...compactParentCoverage,
    "LITERAL SOURCE ANCHORS (AUTHORITATIVE; abbreviated only for this repair source):",
    ...chapters.map((chapter, index) =>
      `CHAPTER ${index + 1} LITERAL SOURCE ANCHOR: ${abridgeUtf8(String(chapter?.["source excerpt"] || ""), sourceAnchorAuditBudget)}`),
  ].join("\n\n");
  const parentGenerationEvidence = [
    "COMPACT AUDITED CHILD COVERAGE: this complete chronological coverage was reduced from independently generated and semantically audited child summaries. Compose the parent overview from every compact coverage segment without dropping later segments or inventing dialogue, actors, or outcomes.",
    ...compactParentCoverage,
  ].join("\n\n");
  const parentRepairSourceExcerpt = [
    "COMPACT AUDITED CHILD COVERAGE: use these independently generated, source-audited coverage segments for complete topic coverage.",
    ...compactParentCoverage,
    "LITERAL SOURCE ANCHORS FOR ATTRIBUTION AND SPEECH-ACT CHECKS:",
    ...chapters.map((chapter, index) =>
      `CHAPTER ${index + 1} LITERAL SOURCE ANCHOR: ${abridgeUtf8(String(chapter?.["source excerpt"] || ""), sourceAnchorAuditBudget)}`),
  ].join("\n\n");
  return summarizeGroundedUnit({
    unit: {
      ...unit,
      "attribution source excerpt": String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || ""),
      "semantic grounding source excerpt": parentAuditEvidence,
      "parent literal source excerpt": parentLiteralSourceExcerpt,
      "parent repair source excerpt": parentRepairSourceExcerpt,
      label: heading,
      // Give the final parent generator the same balanced chapter coverage
      // that the independent audit receives. Reduced prose alone can erase
      // the actor and speech-act pairing from a later chapter.
      "source excerpt": parentGenerationEvidence,
      "child chapters": [],
      "parent overview": true,
    },
    focus: `${focus || "newsworthy factual civic reporting"}; synthesize a balanced parent overview from every supplied chunk summary; preserve named speakers only when the paired literal source anchor explicitly supports the name-role pairing, and preserve source speech acts without recasting speaker-specific remarks as institutional meeting actions`,
    llmModel,
    ollamaUrl,
    semanticGroundingAudit,
    governingBody,
  });
}

export function stage3GenerationOrder(units = []) {
  return units.map((unit, index) => ({
    index,
    sourceChars: Number(unit["source chars"] || String(unit["source excerpt"] || "").length || 0),
  })).sort((a, b) => a.sourceChars - b.sourceChars || a.index - b.index);
}

export async function runAgendaStage3SummaryRenderer({
  transcriptDir,
  prefix,
  sectionGroundingPyaPath,
  outSummaryPyaPath,
  outSummaryMdPath,
  focus = "",
  llmModel = "",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
}) {
  const maxChapterSourceChars = Math.max(2000, Number(process.env.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 8000));
  assertExactGroundingRoot(sectionGroundingPyaPath);
  const grounding = await readPyaMapArtifact(sectionGroundingPyaPath, STAGE2_GROUNDING_ROOT);
  assertExactGroundingSchema(grounding);
  const units = Array.isArray(grounding?.["grounded units"]) ? grounding["grounded units"] : [];
  if (!units.length) throw new Error("stage3 defective: no grounded units in section-grounding artifact");
  const governingBody = resolveMeetingBodyLabel(transcriptDir);

  const sections = [];
  let longDiagnosticCount = 0;
  // A failed semantic audit must be retryable with a genuinely different
  // generation.  Keep the audit gate strict, but vary repair seeds between
  // runs so one unlucky Qwen response cannot repeat the same duplicated pair
  // forever.
  const stage3RetryNonce = Number.parseInt(
    String(process.env.AGENDA_STAGE3_RETRY_NONCE || ""),
    10,
  ) || (Date.now() % 100000);
  // Independent summaries need not be generated chronologically. Process
  // compact contexts first so a sequence of very-long prompts cannot starve
  // the short meeting tail; restore canonical order before validation/write.
  const generationOrder = stage3GenerationOrder(units);
  for (const generationEntry of generationOrder) {
    const i = generationEntry.index;
    const unit = units[i];
    const unitId = String(unit["unit id"] || "");
    const heading = unit.label || `${unit["agenda item"] || ""}`;
    const scopedSource = scopeSourceAtStructuredHandoff(unit, units[i + 1]);
    const summaryUnit = scopedSource.changed
      ? { ...unit, "source excerpt": scopedSource.source }
      : unit;
    if (scopedSource.changed) {
      log(`[agenda-stage3] scoped unit=${unitId} before structured handoff phrase="${scopedSource.phrase}"`);
    }

    const childChapterInputs = Array.isArray(unit["child chapters"]) ? unit["child chapters"] : [];
    let sourceChapters = childChapterInputs
      .flatMap((chapter) => {
        const sourceExcerpt = String(chapter?.["source excerpt"] || "").trim();
        const sourceChars = Number(chapter?.["source chars"] || sourceExcerpt.length || 0);
        if (!sourceExcerpt || sourceChars <= maxChapterSourceChars) return [chapter];
        const spans = buildAgendaPreviewChunkSpans(sourceExcerpt, {
          rowStart: Number(chapter?.["row start"] || 0),
          sourceRows: Number(chapter?.["source rows"] || 1),
          since: Number(chapter?.since || 0),
          durationSeconds: Number(chapter?.until || 0) - Number(chapter?.since || 0),
          maxChars: maxChapterSourceChars,
          targetChars: Math.max(2000, maxChapterSourceChars - 400),
        });
        const reassembled = spans.map((span) => span.text).join("\n\n").replace(/\s+/gu, " ").trim();
        const normalizedSource = sourceExcerpt.replace(/\s+/gu, " ").trim();
        if (!spans.length || reassembled !== normalizedSource) {
          throw new Error(`stage3 defective: oversized child chapter could not be losslessly chunked unit=${unitId} chapter=${String(chapter?.["chapter id"] || "")}`);
        }
        log(`[agenda-stage3] chunk oversized child unit=${unitId} chapter=${String(chapter?.["chapter id"] || "")} parts=${spans.length} source_chars=${sourceChars}`);
        return spans.map((span, partIndex) => ({
          ...chapter,
          "chapter id": `${String(chapter?.["chapter id"] || "chapter")}_part_${partIndex + 1}`,
          "source excerpt": span.text,
          "source chars": span.text.length,
          "row start": span.rowStart,
          "row end": span.rowEnd,
          "source rows": span.sourceRows,
          since: span.since,
          until: span.until,
          "part index": partIndex + 1,
          "part total": spans.length,
        }));
      });
    if (!childChapterInputs.length) {
      const sourceExcerpt = String(summaryUnit["source excerpt"] || "").trim();
      const sourceChars = sourceExcerpt.length;
      if (sourceChars > maxChapterSourceChars) {
        const spans = buildAgendaPreviewChunkSpans(sourceExcerpt, {
          rowStart: Number(summaryUnit["row start"] || 0),
          sourceRows: Number(summaryUnit["source rows"] || 1),
          since: Number(summaryUnit.since || 0),
          durationSeconds: Number(summaryUnit["duration seconds"] || 0),
          maxChars: maxChapterSourceChars,
          targetChars: Math.max(2000, maxChapterSourceChars - 400),
        });
        const reassembled = spans.map((span) => span.text).join("\n\n").replace(/\s+/gu, " ").trim();
        const normalizedSource = sourceExcerpt.replace(/\s+/gu, " ").trim();
        if (!spans.length || reassembled !== normalizedSource) {
          throw new Error(`stage3 defective: oversized childless grounded unit could not be losslessly chunked unit=${unitId}`);
        }
        log(`[agenda-stage3] split oversized childless unit=${unitId} parts=${spans.length} source_chars=${sourceChars}`);
        sourceChapters = spans.map((span, partIndex) => ({
          "chapter id": `${unitId}_chapter_${String(partIndex + 1).padStart(2, "0")}`,
          "parent unit id": unitId,
          "ordering index": partIndex + 1,
          "source excerpt": span.text,
          "source chars": span.text.length,
          "row start": span.rowStart,
          "row end": span.rowEnd,
          "source rows": span.sourceRows,
          since: span.since,
          until: span.until,
          "part index": partIndex + 1,
          "part total": spans.length,
        }));
      }
    }
    const chapters = [];
    const seenLeadPhrases = new Set();
    const generateChapter = async (
      ci,
      existingChapters = [],
      auditNote = "",
      retrySeed = 0,
      { freshSourceOnly = false } = {},
    ) => {
      const rawChapterUnit = sourceChapters[ci] || {};
      const chapterScope = scopeSourceAtStructuredHandoff(
        {
          ...summaryUnit,
          ...rawChapterUnit,
          label: heading,
        },
        units[i + 1],
      );
      const chapterUnit = chapterScope.changed
        ? {
          ...rawChapterUnit,
          "source excerpt": chapterScope.source,
          "source chars": chapterScope.source.length,
        }
        : rawChapterUnit;
      if (chapterScope.changed) {
        log(`[agenda-stage3] scoped child unit=${unitId} chapter=${String(rawChapterUnit?.["chapter id"] || ci + 1)} before structured handoff phrase="${chapterScope.phrase}"`);
      }
      const chapterSourceChars = Number(chapterUnit["source chars"] || String(chapterUnit["source excerpt"] || "").length || 0);
      if (chapterSourceChars > maxChapterSourceChars) {
        throw new Error(
          `stage3 defective: oversized child chapter source text unit=${unitId} chapter=${ci + 1} source_chars=${chapterSourceChars} max_allowed=${maxChapterSourceChars}`,
        );
      }
      let chapterLlm = await summarizeGroundedUnit({
        unit: {
          ...summaryUnit,
          ...chapterUnit,
          label: heading,
          "part total": Number(chapterUnit?.["part total"] || 1),
          "part index": Number(chapterUnit?.["part index"] || ci + 1),
        },
        focus: auditNote
          ? `${focus}; duplication audit feedback: ${auditNote}${freshSourceOnly ? "; write fresh prose from this source chunk only; do not use sibling drafts as content" : ""}`
          : focus,
        llmModel,
        ollamaUrl,
        isChild: true,
        semanticGroundingAudit: true,
        governingBody,
        siblingSummaries: chapterSiblingContext(existingChapters, ci, Boolean(auditNote)),
        temperature: auditNote
          ? (/\b(?:duplicate|redundan|overlap|same claim)/iu.test(auditNote) ? 0.65 : 0.25)
          : 0,
        seed: retrySeed,
      });
      if (!normalizeText(chapterLlm.summary || "")) {
        chapterLlm = await summarizeGroundedUnit({
          unit: {
            ...summaryUnit,
            ...chapterUnit,
            label: heading,
            "part total": Number(chapterUnit?.["part total"] || 1),
            "part index": Number(chapterUnit?.["part index"] || ci + 1),
          },
          focus: auditNote
          ? `${focus}; duplication audit feedback: ${auditNote}${freshSourceOnly ? "; write fresh prose from this source chunk only; use sibling summaries only to avoid repeating their facts, never as source evidence" : ""}`
            : focus,
          llmModel,
          ollamaUrl,
          isChild: true,
          semanticGroundingAudit: true,
          governingBody,
          siblingSummaries: chapterSiblingContext(existingChapters, ci, Boolean(auditNote)),
          temperature: auditNote
            ? (/\b(?:duplicate|redundan|overlap|same claim)/iu.test(auditNote) ? 0.75 : 0.35)
            : 0,
          seed: retrySeed + 1,
        });
      }
      if (!normalizeText(chapterLlm.summary || "")) {
        throw new Error(`stage3 retryable: empty LLM child summary for unit ${unitId} chapter ${ci + 1}`);
      }

      let title = pickSplitChapterText({
        llmText: chapterLlm.chapterText,
        summary: chapterLlm.summary,
        heading,
        seenLeadPhrases,
      });
      const titleAudit = /\b(?:title|headline|truncated|dangling|unfinished)\b/iu.test(auditNote);
      if (!title || titleAudit) {
        title = await repairChapterTitleLlm({
          heading,
          summary: chapterLlm.summary,
          sourceExcerpt: String(chapterUnit["source excerpt"] || unit["source excerpt"] || ""),
          auditNote: auditNote || "The generated chapter headline was not structurally complete.",
          llmModel,
          ollamaUrl,
          seed: retrySeed + 2,
        });
      }
      if (!title) title = normalizeSplitChapterCandidate(chapterFromSummary(chapterLlm.summary), heading);
      if (!title) title = normalizeSplitChapterCandidate(chapterFromSummary(String(chapterUnit["source excerpt"] || "")), heading);
      if (!title) {
        throw new Error(`stage3 defective: empty nested chapter title for unit ${unitId} chapter ${ci + 1}`);
      }
      assertCleanStage3Text(title, `stage3 chapter title unit=${unitId} chapter=${ci + 1}`);
      assertCleanStage3Text(chapterLlm.summary, `stage3 chapter summary unit=${unitId} chapter=${ci + 1}`);
      const lead = leadingPhraseKey(title);
      if (lead) seenLeadPhrases.add(lead);

      return {
        "chapter id": String(chapterUnit["chapter id"] || `${unitId}_chapter_${String(ci + 1).padStart(2, "0")}`),
        "parent unit id": unitId,
        "ordering index": Number(chapterUnit["ordering index"] || ci + 1),
        "row start": Number(chapterUnit["row start"] || 0),
        "row end": Number(chapterUnit["row end"] || 0),
        since: Number(chapterUnit.since || 0),
        until: Number(chapterUnit.until || Number(chapterUnit.since || 0)),
        title,
        text: chapterLlm.summary,
        "source excerpt": String(chapterUnit["source excerpt"] || ""),
      };
    };
    for (let ci = 0; ci < sourceChapters.length; ci += 1) {
      chapters.push(await generateChapter(ci, chapters));
    }

    if (chapters.length >= 2) {
      // Keep semantic audit prompts within the configured model context even
      // when a report was losslessly split into many child windows. Two
      // chapters at the bounded source window preserve distinct evidence
      // while preventing truncated JSON audit responses.
      const auditBatchSize = chapters.length > 2 ? 2 : chapters.length;
      for (let batchStart = 0; batchStart < chapters.length; batchStart += auditBatchSize) {
        const batchEnd = Math.min(chapters.length, batchStart + auditBatchSize);
        let audit = await auditChapterOrthogonality({
          heading,
          chapters: chapters.slice(batchStart, batchEnd),
          llmModel,
          ollamaUrl,
        });
        audit = await adjudicateChapterOrthogonality({
          heading,
          chapters: chapters.slice(batchStart, batchEnd),
          audit,
          llmModel,
          ollamaUrl,
        });
        for (let auditAttempt = 1; !audit.orthogonal && auditAttempt <= 5; auditAttempt += 1) {
          const repairIndices = audit.duplicateIndices.length
            ? audit.duplicateIndices.map((index) => batchStart + index)
            : Array.from({ length: batchEnd - batchStart }, (_, index) => batchStart + index);
          for (const ci of repairIndices) {
            const rejected = chapters[ci] || {};
            chapters[ci] = await generateChapter(
              ci,
              chapters,
                  [
                    `Orthogonality repair ${auditAttempt}: regenerate this chapter from its own source chunk only.`,
                    PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE,
                    audit.notes || "Report distinct facts from this chunk and do not repeat a sibling's main claim.",
                "The prior chapter draft was rejected by the semantic audit; do not preserve its title or wording when it omits this chunk's main point.",
                "Prefer a distinct named decision, request, number, agency, location, or implementation detail that appears in this source chunk. Do not restate a sibling's broad debate framing unless this chunk adds a different fact.",
                `REJECTED_CHAPTER_TITLE: ${normalizeText(rejected.title || "")}`,
                `REJECTED_CHAPTER_SUMMARY: ${normalizeText(rejected.text || "")}`,
              ].join(" "),
              4100 + stage3RetryNonce + auditAttempt * 100 + ci,
            );
          }
          audit = await auditChapterOrthogonality({
            heading,
            chapters: chapters.slice(batchStart, batchEnd),
            llmModel,
            ollamaUrl,
          });
          audit = await adjudicateChapterOrthogonality({
            heading,
            chapters: chapters.slice(batchStart, batchEnd),
            audit,
            llmModel,
            ollamaUrl,
          });
        }
        if (!audit.orthogonal) {
          // A repeated semantic rejection can become self-reinforcing when the
          // rejected sibling drafts are repeatedly shown as context. Give the
          // affected chapters one bounded, source-only regeneration pass before
          // leaving the item retryable. This preserves the audit gate while
          // allowing Qwen to escape contaminated sibling wording.
          const freshIndices = audit.duplicateIndices.length
            ? audit.duplicateIndices.map((index) => batchStart + index)
            : Array.from({ length: batchEnd - batchStart }, (_, index) => batchStart + index);
          for (const ci of freshIndices) {
            const rejected = chapters[ci] || {};
            chapters[ci] = await generateChapter(
              ci,
              [],
                  [
                    "Fresh source-only orthogonality repair after repeated semantic rejection.",
                    PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE,
                    audit.notes || "The prior draft repeated a sibling's main claim.",
                "Use only this chapter's source excerpt. Do not preserve the rejected wording, title, or framing, and do not infer facts from other chapters.",
              ].join(" "),
              5100 + stage3RetryNonce + batchStart + ci,
              { freshSourceOnly: true },
            );
          }
          audit = await auditChapterOrthogonality({
            heading,
            chapters: chapters.slice(batchStart, batchEnd),
            llmModel,
            ollamaUrl,
          });
          audit = await adjudicateChapterOrthogonality({
            heading,
            chapters: chapters.slice(batchStart, batchEnd),
            audit,
            llmModel,
            ollamaUrl,
          });
        }
        if (!audit.orthogonal) {
          throw new Error(
            `stage3 retryable: child summaries remain semantically duplicative for unit ${unitId} batch ${batchStart + 1}-${batchEnd}${audit.notes ? ` (${audit.notes})` : ""}`,
          );
        }
      }
      for (let duplicateAttempt = 1; duplicateAttempt <= 3; duplicateAttempt += 1) {
        const duplicateIndices = exactDuplicateChapterIndices(chapters);
        if (!duplicateIndices.length) break;
        for (const ci of duplicateIndices) {
          const rejected = chapters[ci] || {};
          chapters[ci] = await generateChapter(
            ci,
            chapters,
            [
              "This output exactly duplicated another source window.",
              "Start the chapter again from this chapter's grounded source excerpt and report only evidence, table ranges, findings, requests, or outcomes that are present in that excerpt.",
              "Do not repeat the rejected chapter's wording or main claim; the replacement must contain a distinct source-grounded fact.",
              `REJECTED_CHAPTER_TITLE: ${normalizeText(rejected.title || "")}`,
              `REJECTED_CHAPTER_SUMMARY: ${normalizeText(rejected.text || "")}`,
            ].join(" "),
            4200 + duplicateAttempt * 10 + ci,
          );
        }
      }
      if (exactDuplicateChapterIndices(chapters).length) {
        throw new Error(`stage3 retryable: exact duplicate child summaries remain for unit ${unitId}`);
      }
    }

    let llm = chapters.length
      ? await synthesizeParentFromChapters({ unit: summaryUnit, heading, chapters, focus, llmModel, ollamaUrl, semanticGroundingAudit: true, governingBody })
      : await summarizeGroundedUnit({ unit: summaryUnit, focus, llmModel, ollamaUrl, semanticGroundingAudit: true, governingBody });
    if (!normalizeText(llm.summary || "") && Boolean(unit.substantive)) {
      llm = chapters.length
        ? await synthesizeParentFromChapters({ unit: summaryUnit, heading, chapters, focus, llmModel, ollamaUrl, semanticGroundingAudit: true, governingBody })
        : await summarizeGroundedUnit({ unit: summaryUnit, focus, llmModel, ollamaUrl, semanticGroundingAudit: true, governingBody });
    }
    let unitSummary = normalizeText(llm.summary || "");
    if (!unitSummary && Boolean(unit.substantive)) {
      throw new Error(`stage3 retryable: empty LLM summary for substantive unit ${unitId}`);
    }
    if (!unitSummary) throw new Error(`stage3 retryable: empty LLM summary for non-substantive unit ${unitId}`);

    sections.push({
      index: i + 1,
      "unit id": unitId,
      "parent unit id": "",
      "part index": 0,
      "part total": 1,
      heading,
      summary: unitSummary,
      "chapter text": chapters.length ? String(chapters[0].title || "") : normalizeText(llm.chapterText || chapterFromSummary(llm.summary)),
      chapters,
      score: Number(llm.confidence || 0),
      mode: "llm-stage3",
      "source rows": Number(unit["source rows"] || 0),
      "start row": Number(unit["row start"] || 0),
      "end row": Number(unit["row end"] || 0),
      "max section seconds": Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 100000),
      "grounding status": unit["grounding status"] || "",
      "budget tier": llm.budget?.tier || "",
      "budget max sentences": Number(llm.budget?.maxSentences || 0),
      "budget max words": Number(llm.budget?.maxWords || 0),
      "budget paragraph cap": Number(llm.budget?.paragraphCap || 1),
      "clamp changed": llm.clampChanged ? "yes" : "no",
      "summary pre clamp": llm.clampChanged ? llm.rawSummary : "",
    });
    assertCleanStage3Text(unitSummary, `stage3 section summary unit=${unitId}`);

    if (llm.clampChanged) {
      log(
        `[agenda-stage3][clamp] unit=${unitId} tier=${llm.budget?.tier || "na"} before="${llm.rawSummary.slice(0, 160)}" after="${llm.summary.slice(0, 160)}"`,
      );
    }
    if (Number(unit["duration seconds"] || 0) > 900 && longDiagnosticCount < 5) {
      longDiagnosticCount += 1;
      log(
        `[agenda-stage3][long-diagnostic] unit=${unitId} duration=${Number(unit["duration seconds"] || 0).toFixed(1)}s rows=${Number(unit["source rows"] || 0)} tier=${llm.budget?.tier || "na"} max_sent=${Number(llm.budget?.maxSentences || 0)} max_words=${Number(llm.budget?.maxWords || 0)} raw="${llm.rawSummary.slice(0, 220)}" final="${llm.summary.slice(0, 220)}"`,
      );
    }
    log(
      `[agenda-stage3] section ${i + 1}/${units.length} heading ${heading} budget=${llm.budget?.tier || "na"} max_words=${llm.budget?.maxWords || 0} max_sent=${llm.budget?.maxSentences || 0} chapters=${chapters.length}`,
    );
  }

  sections.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));

  const summaryArtifact = {
    "schema version": "agenda_summary_v1",
    "source section grounding": sectionGroundingPyaPath,
    "transcript dir": transcriptDir,
    prefix,
    focus,
    "generated time": new Date().toISOString(),
    sections,
  };

  validateAgendaSummaryStrict(grounding, summaryArtifact);
  writePyaMapArtifact(outSummaryPyaPath, STAGE3_SUMMARY_ROOT, summaryArtifact);
  fs.writeFileSync(outSummaryMdPath, agendaSummaryToMarkdown(summaryArtifact), "utf8");

  log(`[agenda-stage3] sections: ${sections.length}`);
  log(`[agenda-stage3] wrote: ${outSummaryPyaPath}`);
  log(`[agenda-stage3] wrote: ${outSummaryMdPath}`);
  return summaryArtifact;
}
