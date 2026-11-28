import fs from "node:fs";
import path from "node:path";

function normalizeItem(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/gu, "");
}

function readIndex(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function indexPaths(transcriptDir = "") {
  const transcriptPath = path.resolve(String(transcriptDir || "."));
  const meetingDir = path.dirname(transcriptPath);
  return [
    path.join(meetingDir, "subreports.index.json"),
    path.join(meetingDir, "converted", "subreports.index.json"),
  ];
}

function addRows(byItem, rows = [], { attachments = false } = {}) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = normalizeItem(row?.item);
    if (!item) continue;
    const entry = byItem.get(item) || { titles: new Set(), attachmentTitles: new Set() };
    const title = String(row?.title || row?.label || "").trim();
    if (!attachments && title) entry.titles.add(title);
    const attachmentRows = Array.isArray(row?.attachments) ? row.attachments : [];
    for (const attachment of attachmentRows) {
      const attachmentTitle = String(attachment?.label || attachment?.title || "").trim();
      if (attachmentTitle) entry.attachmentTitles.add(attachmentTitle);
    }
    byItem.set(item, entry);
  }
}

export function createAuthoritativeAgendaItemSourceLookup(transcriptDir = "") {
  const byItem = new Map();
  for (const filePath of indexPaths(transcriptDir)) {
    if (!fs.existsSync(filePath)) continue;
    const index = readIndex(filePath);
    if (!index) continue;
    addRows(byItem, index.sections);
    addRows(byItem, index.items);
    addRows(byItem, index.attachments_from_html, { attachments: true });
  }

  const attachmentTitlesForItem = (item = "") => {
    const entry = byItem.get(normalizeItem(item));
    return entry ? [...entry.attachmentTitles] : [];
  };

  const sourceForItem = (item = "") => {
    const requestedItem = String(item || "").trim();
    const entry = byItem.get(normalizeItem(requestedItem));
    if (!requestedItem || !entry) return "";
    const titleLines = [...entry.titles].map((title) => `Structured agenda title: ${title}`);
    const attachmentLines = [...entry.attachmentTitles]
      .map((title) => `Structured attachment title: ${title}`);
    return [
      `Authoritative structured eScribe agenda item: ${requestedItem}`,
      ...titleLines,
      ...attachmentLines,
    ].join("\n");
  };

  sourceForItem.attachmentTitlesForItem = attachmentTitlesForItem;
  return sourceForItem;
}
