export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function blockMarkers(blockName) {
  return {
    start: `# managed by pyash configure ${blockName}:start`,
    end: `# managed by pyash configure ${blockName}:end`
  };
}

export function renderManagedBlock({ blockName, content }) {
  const markers = blockMarkers(blockName);
  return `${markers.start}\n${content.trim()}\n${markers.end}\n`;
}

export function planManagedUpsert({ existing, blockName, content }) {
  const markers = blockMarkers(blockName);
  const block = renderManagedBlock({ blockName, content });
  const pattern = new RegExp(`${escapeRegex(markers.start)}[\\s\\S]*?${escapeRegex(markers.end)}\\n?`, "m");

  let nextText;
  let action;
  if (pattern.test(existing)) {
    nextText = existing.replace(pattern, block);
    action = "replace";
  } else if (existing.trim()) {
    nextText = `${existing.trimEnd()}\n\n${block}`;
    action = "append";
  } else {
    nextText = block;
    action = "create";
  }
  return {
    action,
    changed: nextText !== existing,
    nextText
  };
}

export function extractManagedBlock(text, blockName) {
  const markers = blockMarkers(blockName);
  const pattern = new RegExp(`${escapeRegex(markers.start)}([\\s\\S]*?)${escapeRegex(markers.end)}`, "m");
  const match = text.match(pattern);
  return match ? match[1] : "";
}
