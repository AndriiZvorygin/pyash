export const FRIENDLY_AMENDMENT_SEQUENCE_RULE = "AMENDMENT SEQUENCE: keep a change to an underlying by-law, policy, or other document separate from a proposed change to the wording of a motion. Preserve each step in source order and attach its own mover, seconder, and disposition only when the source states them. A failed or unaccepted motion amendment does not erase a separate document amendment or a later disposition of the original motion.";

export const ATTACHMENT_OWNERSHIP_AND_BOUNDARIES_RULE = "ATTACHMENT OWNERSHIP AND BOUNDARIES: use structured agenda metadata to identify the exact item and attachment owner. Keep factual claims within the supplied bounded transcript or document excerpt. Do not transfer a title, actor, condition, amount, action, or outcome between neighboring agenda items or attachments. An attachment title establishes provenance and ownership, not an action taken at the meeting.";

export const DELEGATED_APPROVAL_REPORT_RULE = "DELEGATED APPROVAL AND REPORT RULE: distinguish a staff or delegated approval recorded in a report from an action by the current meeting. Keep staff recommendations, reported past actions, receipt of a report, and a current motion or vote as separate claims; assign each action only to the actor and time stated in the source.";

export const MINUTES_DOCUMENT_CHRONOLOGY_RULE = "MINUTES DOCUMENT CHRONOLOGY: when an attachment contains minutes, keep the earlier body's recorded questions, remarks, motions, and outcomes separate from the current meeting's actions on those minutes. Match each disposition to the motion immediately preceding it and preserve the order of events. Do not infer that the current body adopted an action merely because it appears in the attached minutes.";

export const PROCEDURAL_FLOOR_REPAIR_RULE = "PROCEDURAL FLOOR REPAIR: report a motion's source-supported subject, introduction, interim floor status, and final disposition as distinct facts. A chair's or clerk's announcement that a motion is on the floor does not mean that the mover placed or brought it there. Do not invent discussion or a final outcome when the bounded source records only an interim procedural status.";

export const PROPOSAL_STATUS_AND_PARTICIPANT_RULE = "PROPOSAL STATUS AND PARTICIPANT: preserve whether a statement is tentative, conditional, proposed, recommended, or a completed motion. A willingness, question, suggestion, or possible future action is not a motion or decision. Keep each speaker's remarks and named role tied to the source block that supports them; a callout, addressee, agenda label, or repeated speaker identifier alone does not prove who made a later statement.";

export const REPORT_RECEIPT_MOTION_RULE = "REPORT RECEIPT AND MOTION: receiving or considering a report is distinct from approving its recommendations or directing staff. Attribute each recommendation to the report or its stated author, and attribute a carried, defeated, or approved outcome only to the motion the source records.";

export const SOURCE_STATUS_AND_DOCUMENT_TITLE_FIDELITY_RULE = "SOURCE STATUS AND DOCUMENT TITLE: retain the source's document type and exact named title when supported. A report, minutes, letter, agenda label, and transcript have different evidentiary roles. Preserve stated planned, proposed, in-progress, completed, or future status, and do not turn an identity label into evidence that an event occurred.";

export const STRUCTURED_TRANSCRIPT_ENTITY_IDENTITY_RULE = "STRUCTURED AND TRANSCRIPT IDENTITY: structured agenda labels are authoritative for item identity, report title, meeting date, and attachment ownership. They do not identify a transcript speaker, presenter, recipient, or acting body unless the bounded spoken source explicitly makes that pairing. Do not copy a conflicting transcript date over the authoritative agenda date.";

export const STATIC_LEGAL_DOCUMENT_CONTENT_RULE = "STATIC LEGAL DOCUMENT CONTENT: wording inside a draft by-law, agreement, notice, or other legal document describes that document's terms. It does not by itself establish that the current meeting moved, passed, enacted, approved, or adopted it. Report document content as document content and reserve meeting actions for explicit transcript evidence.";

export function shouldUseExplicitMotionDispositionRepair(audit = "", candidate = "", source = "") {
  const auditText = String(audit || "");
  const candidateText = String(candidate || "");
  const sourceText = String(source || "");
  const auditReportsOmission = /\b(?:omit\w*|missing|miss\w*|lacks?|absence|not\s+(?:state|include|preserve|report))\b[\s\S]{0,180}\b(?:motion|recommendation|vote|disposition|outcome)\b|\b(?:motion|recommendation|vote|disposition|outcome)\b[\s\S]{0,180}\b(?:omit\w*|missing|miss\w*|lacks?|absence|not\s+(?:state|include|preserve|report))\b/iu.test(auditText);
  const sourceHasMotion = /\b(?:motion|moved|seconded|recommendation)\b/iu.test(sourceText);
  const sourceHasDisposition = /\b(?:carried|defeated|passed|approved|adopted|withdrawn)\b/iu.test(sourceText);
  const candidateHasDisposition = /\b(?:carried|defeated|passed|approved|adopted|withdrawn)\b/iu.test(candidateText);
  return auditReportsOmission && sourceHasMotion && sourceHasDisposition && !candidateHasDisposition;
}

export function shouldUseProcedureOnlyGroundingRepair(audit = "", candidate = "", source = "") {
  const auditText = String(audit || "");
  const candidateText = String(candidate || "");
  const sourceText = String(source || "");
  const auditDisputesOutcome = /\b(?:unsupported|not\s+(?:recorded|stated|supported)|no\s+(?:final\s+)?(?:disposition|outcome)|without\s+(?:a\s+)?(?:disposition|outcome))\b[\s\S]{0,160}\b(?:motion|vote|carried|passed|approved|defeated|outcome|disposition)\b|\b(?:motion|vote|carried|passed|approved|defeated|outcome|disposition)\b[\s\S]{0,160}\b(?:unsupported|not\s+(?:recorded|stated|supported)|no\s+(?:final\s+)?(?:disposition|outcome)|without\s+(?:a\s+)?(?:disposition|outcome))\b/iu.test(auditText);
  const sourceHasDisposition = /\b(?:carried|defeated|passed|approved|adopted|withdrawn)\b/iu.test(sourceText);
  const candidateHasOutcome = /\b(?:carried|defeated|passed|approved|adopted|withdrawn)\b/iu.test(candidateText);
  return auditDisputesOutcome && !sourceHasDisposition && candidateHasOutcome;
}
