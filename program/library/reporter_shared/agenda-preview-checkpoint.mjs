import fs from "node:fs";
import path from "node:path";

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
  return required.every(
    (filePath) => fs.existsSync(filePath) && String(fs.readFileSync(filePath, "utf8") || "").trim(),
  );
}
