import fs from "node:fs";

import { readPyaTextValues } from "../../../command/pya_lookup.mjs";

const NAMED_CIVIC_ACTOR = "(?:Councillor|Councilor|Mayor|Deputy\\s+Mayor)\\s+[\\p{Lu}][\\p{L}'’-]+(?:\\s+[\\p{Lu}][\\p{L}'’-]+){0,2}";
const MOTION_ROLE = "(?:move(?:d|s)?|second(?:ed|s)?|introduc(?:ed|es)\\s+(?:the|a)\\s+motion|propos(?:ed|es)\\s+(?:the|a)\\s+motion)";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function namedMotionClaims(text = "") {
  const source = String(text || "");
  const patterns = [
    new RegExp(`\\b(?<actor>${NAMED_CIVIC_ACTOR})\\b[^.?!\\n]{0,80}?\\b(?<role>${MOTION_ROLE})\\b`, "giu"),
    new RegExp(`\\b(?<role>${MOTION_ROLE})\\s+by\\s+(?<actor>${NAMED_CIVIC_ACTOR})\\b`, "giu"),
  ];
  const claims = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      claims.push({
        actor: normalizeText(match.groups?.actor || ""),
        role: normalizeText(match.groups?.role || ""),
        claim: normalizeText(match[0] || ""),
      });
    }
  }
  return claims.filter((claim, index, all) => (
    claim.actor && all.findIndex((other) => other.actor.toLowerCase() === claim.actor.toLowerCase()
      && other.role.toLowerCase() === claim.role.toLowerCase()) === index
  ));
}

function sameLineExplicitlySupportsMotionActor(line = "", actor = "") {
  const escapedActor = String(actor || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (!escapedActor) return false;
  const actorThenRole = new RegExp(
    `\\b${escapedActor}\\b[^\\n]{0,100}?\\b(?:I\\s+)?${MOTION_ROLE}\\b`,
    "iu",
  );
  const roleThenActor = new RegExp(
    `\\b${MOTION_ROLE}\\s+by\\s+${escapedActor}\\b`,
    "iu",
  );
  return actorThenRole.test(line) || roleThenActor.test(line);
}

export function unsupportedNamedMotionAttributions({ text = "", sourceExcerpt = "" } = {}) {
  const sourceLines = String(sourceExcerpt || "").split(/\r?\n/u);
  return namedMotionClaims(text).filter((claim) => (
    !sourceLines.some((line) => sameLineExplicitlySupportsMotionActor(line, claim.actor))
  ));
}

function readJsonField(filePath, fieldName) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = String(readPyaTextValues(filePath, [fieldName])?.[fieldName] || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function verifyAgendaMotionAttributions({ agendaSummaryPyaPath = "", sectionGroundingPyaPath = "" } = {}) {
  const sections = readJsonField(agendaSummaryPyaPath, "sections");
  const units = readJsonField(sectionGroundingPyaPath, "grounded units");
  const unitsById = new Map(units.map((unit) => [String(unit?.["unit id"] || ""), unit]));
  const defects = [];
  for (const section of sections) {
    const unitId = String(section?.["unit id"] || "");
    const unit = unitsById.get(unitId) || {};
    const sourceExcerpt = String(unit?.["source excerpt"] || "");
    const fields = [
      ["summary", section?.summary],
      ["chapter text", section?.["chapter text"]],
      ...(Array.isArray(section?.chapters) ? section.chapters.flatMap((chapter, index) => [
        [`chapter ${index + 1} title`, chapter?.title],
        [`chapter ${index + 1} text`, chapter?.text],
      ]) : []),
    ];
    for (const [field, text] of fields) {
      for (const claim of unsupportedNamedMotionAttributions({ text, sourceExcerpt })) {
        defects.push({ unit_id: unitId, field, ...claim });
      }
    }
  }
  return { ok: defects.length === 0, defects, sections_checked: sections.length };
}
