export function normalizeSessionName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function displaySessionName(value) {
  return String(value ?? "").replace(/[-_]+/g, " ").trim();
}
