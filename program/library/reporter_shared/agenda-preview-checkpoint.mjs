import fs from "node:fs";
import path from "node:path";

function readNonEmptyFile(filePath) {
  try {
    return fs.existsSync(filePath) && String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function hasCompleteAgendaPayload(payloadPath, transcriptDir) {
  const raw = readNonEmptyFile(payloadPath);
  if (!raw) return false;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }
  if (String(payload?.content_type || "").trim().toLowerCase() !== "agenda") return false;
  for (const field of ["title", "body_markdown", "agenda_url"]) {
    if (!String(payload?.[field] || "").trim()) return false;
  }
  const htmlPath = String(payload?.local_agenda_html || "").trim();
  if (!htmlPath) return false;
  const resolvedHtml = path.isAbsolute(htmlPath)
    ? htmlPath
    : path.resolve(transcriptDir, htmlPath);
  return Boolean(readNonEmptyFile(resolvedHtml));
}

export function hasAgendaPreviewArtifactsCheckpoint(transcriptDir, agendaPrefix) {
  const canonicalPrefix = String(agendaPrefix || "").replace(/\.agenda$/u, "");
  const hasSummaryArtifact = [...new Set([agendaPrefix, canonicalPrefix])]
    .flatMap((prefix) => [
      path.join(transcriptDir, `${prefix}.agenda-summary.json`),
      path.join(transcriptDir, `${prefix}.agenda-summary.pya`),
      path.join(transcriptDir, `${prefix}.agenda-summary.md`),
    ])
    .some((filePath) => fs.existsSync(filePath) && String(fs.readFileSync(filePath, "utf8") || "").trim());
  if (!hasSummaryArtifact) return false;

  const required = [
    path.join(transcriptDir, `${agendaPrefix}.meeting-summary.md`),
    path.join(transcriptDir, `${agendaPrefix}.meeting-hook.txt`),
    path.join(transcriptDir, `${agendaPrefix}.lemmy-post.json`),
  ];
  if (!required
    .filter((filePath) => !filePath.endsWith(".lemmy-post.json"))
    .every((filePath) => Boolean(readNonEmptyFile(filePath)))) return false;
  return hasCompleteAgendaPayload(
    path.join(transcriptDir, `${agendaPrefix}.lemmy-post.json`),
    transcriptDir,
  );
}

export function hasWholeAgendaSummaryCheckpoint(summaryPath, agendaSections = []) {
  const summary = readNonEmptyFile(summaryPath);
  if (!summary) return false;
  if (!Array.isArray(agendaSections) || !agendaSections.length) return false;
  if (!agendaSections.every((section) => String(section?.summary || "").trim())) return false;
  return [
    "# Whole Meeting Summary",
    "## Top Newsworthy Developments",
    "## Why It Matters",
    "## Watch Next",
  ].every((heading) => summary.includes(heading));
}
