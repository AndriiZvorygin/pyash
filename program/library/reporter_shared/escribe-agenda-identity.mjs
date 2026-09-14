export function selectCanonicalAgendaItemKeys(structuredItems, inferredItems = []) {
  if (structuredItems instanceof Map && structuredItems.size > 0) {
    return Array.from(structuredItems.keys());
  }
  return Array.from(new Set(inferredItems.map((entry) => String(entry?.item || "").trim().toLowerCase()).filter(Boolean)));
}

export function buildCanonicalAgendaEvidence(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const byItem = new Map(
    rows
      .map((row) => [String(row?.item || "").trim().toLowerCase(), row])
      .filter(([item]) => item),
  );
  const evidence = new Map();
  for (const [item, row] of byItem.entries()) {
    const sources = [];
    const parts = item.split(".");
    for (let length = 1; length < parts.length; length += 1) {
      const parent = byItem.get(parts.slice(0, length).join("."));
      if (parent?.title) sources.push(String(parent.title).trim());
      if (parent?.description) sources.push(String(parent.description).trim());
    }
    if (row?.title) sources.push(String(row.title).trim());
    if (row?.description) sources.push(String(row.description).trim());
    for (const attachment of (Array.isArray(row?.attachments) ? row.attachments : [])) {
      if (attachment?.label) sources.push(String(attachment.label).trim());
    }
    evidence.set(item, [...new Set(sources.filter(Boolean))]);
  }
  return evidence;
}
