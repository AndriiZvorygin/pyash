function slugPart(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function sanitizeBasePrefix(raw, fallback = "meeting-qwen-auto") {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (value.startsWith("-")) return fallback;
  const clean = slugPart(value);
  if (!clean) return fallback;
  // Prevent passing normalized prefix as base_prefix.
  return clean.replace(/-normalized$/iu, "") || fallback;
}

export function deriveNormalizedPrefix(basePrefix, fallback = "meeting-qwen-auto") {
  const base = sanitizeBasePrefix(basePrefix, fallback);
  return `${base}-normalized`;
}

